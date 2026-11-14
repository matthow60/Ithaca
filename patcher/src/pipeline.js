// runIncident(id):
//   claim → clone → install → locate crash (stack trace)
//   → REPRODUCE (replay user steps on original code, screenshot each step)
//   → patch ⇄ PROVE (replay same steps on patched code) ×3
//   → commit fix + evidence → PR → update Mongo.
import path from 'node:path';
import { claimIncident, updateIncident } from './db.js';
import { makeLogger, redact } from './log.js';
import { cloneRepo, installDeps, readRepoFile, writeRepoFile, gitDiff, cleanup, safeId } from './sandbox.js';
import { generatePatch } from './llm.js';
import { resolveCrashLocation } from './stack.js';
import { reproduce, prove } from './verify.js';
import { commitAndPush, openPullRequest, buildPrBody } from './github.js';

export const MAX_ATTEMPTS = 3;

export async function runIncident(incidentId) {
  const log = makeLogger(incidentId);
  const started = Date.now();

  // 1. Atomic claim — anyone else racing for this incident gets null.
  const incident = await claimIncident(incidentId);
  if (!incident) {
    log('not open (missing or already claimed) — skipping');
    return { skipped: true };
  }
  log('claimed, status → patching');

  let dir;
  let attempts = 0;
  try {
    // 2. Clone + install
    const sandbox = await log.step('clone repo', () => cloneRepo(incidentId));
    dir = sandbox.dir;
    const { git } = sandbox;
    await log.step('install deps', () => installDeps(dir));

    // 3. Locate (from the stack trace) and read the crashing file
    const { filePath, line, from } = resolveCrashLocation(dir, incident.error);
    log(`crash location: ${filePath}:${line ?? '?'} (from ${from})`);
    const original = await log.step(`read ${filePath}`, () => readRepoFile(dir, filePath));
    const crashLine = line > 0 ? original.split(/\r?\n/)[line - 1] ?? null : null;

    const actions = incident.actions || [];
    const evidenceRelDir = `.autofix/${safeId(incidentId)}`;
    const evidenceDir = path.join(dir, evidenceRelDir);

    // 4. Reproduce on the original code before touching anything
    await updateIncident(incidentId, { status: 'reproducing' });
    const reproduction = await log.step(`reproduce (replay ${actions.length} user steps on original code)`, () =>
      reproduce({ dir, actions, request: incident.request, evidenceDir }),
    );
    if (reproduction.browserError) log(`⚠ ${reproduction.browserError}`);
    logSteps(log, 'before', reproduction.browser);

    if (!reproduction.reproduced) {
      const why = `Could not reproduce: replaying the user's steps${incident.request?.path ? ' and the recorded request' : ''} ` +
        `against the original code produced no 5xx (request status: ${reproduction.http?.status ?? 'n/a'}).`;
      log(`⚠ ${why}`);
      await updateIncident(incidentId, {
        status: 'not_reproducible',
        'fix.error': why,
        'fix.reproduction': summarize(reproduction),
      });
      return { fixed: false, reproduced: false };
    }
    log(`reproduced via ${reproduction.by}`);
    await updateIncident(incidentId, { status: 'patching', 'fix.reproduction': summarize(reproduction) });

    // 5–6. Patch, prove, retry with feedback
    let previousAttemptError = null;
    let patchSource = null;
    let proof = null;

    for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts++) {
      if (attempts > 1) await updateIncident(incidentId, { status: 'patching', 'fix.attempts': attempts });

      const patch = await log.step(`generate patch (attempt ${attempts}/${MAX_ATTEMPTS})`, () =>
        generatePatch({
          filePath,
          fileContent: original, // always patch from the original, not the last failed attempt
          crashLine,
          stack: incident.error?.stack,
          actions,
          request: incident.request,
          previousAttemptError,
        }),
      );
      patchSource = patch.source;
      await writeRepoFile(dir, filePath, patch.patchedContent);

      await updateIncident(incidentId, { status: 'verifying', 'fix.attempts': attempts });
      const result = await log.step(`prove fix (replay user steps on patched code, attempt ${attempts}/${MAX_ATTEMPTS})`, () =>
        prove({ dir, actions, request: incident.request, evidenceDir }),
      );
      if (result.browserError) log(`⚠ ${result.browserError}`);

      if (result.passed) {
        logSteps(log, 'after', result.browser);
        proof = result;
        break;
      }
      previousAttemptError = result.error;
      log(`verification failed: ${firstLine(result.error)}`);
    }

    if (!proof) {
      attempts = MAX_ATTEMPTS;
      throw new Error(`Verification failed after ${MAX_ATTEMPTS} attempts. Last error:\n${previousAttemptError}`);
    }

    // 7. Diff, branch, commit (fix + evidence), push, PR
    const codeDiff = await log.step('git diff', () => gitDiff(git)); // tracked files only → screenshots excluded
    if (!codeDiff.trim()) throw new Error('Patch produced no changes');

    const branch = `fix/${safeId(incidentId)}`;
    const { evidenceSha } = await log.step(`commit + push ${branch}`, () =>
      commitAndPush(git, { branch, filePath, message: `fix: auto-patch ${incidentId}`, evidenceDir, dir }),
    );

    const prUrl = await log.step('open PR', () =>
      openPullRequest({
        branch,
        title: `fix: auto-patch ${incidentId} — ${truncate(incident.error?.message, 60)}`,
        body: buildPrBody({
          incident,
          codeDiff,
          patchSource,
          attempts,
          reproduction,
          proof,
          evidence: { sha: evidenceSha, relDir: evidenceRelDir, filePath, line },
        }),
      }),
    );

    await updateIncident(incidentId, {
      status: 'fixed',
      fix: {
        branch,
        prUrl,
        codeDiff,
        verified: true,
        attempts,
        patchSource,
        file: filePath,
        line,
        reproduction: summarize(reproduction),
        proof: summarize(proof),
        evidence: evidenceSha ? { commit: evidenceSha, path: evidenceRelDir } : null,
      },
    });
    log(`✅ fixed in ${Date.now() - started}ms → ${prUrl}`);
    return { fixed: true, prUrl };
  } catch (err) {
    const message = redact(err?.stack || err?.message || err);
    log.error(`❌ failed after ${Date.now() - started}ms: ${firstLine(message)}`);
    try {
      await updateIncident(incidentId, {
        status: 'failed',
        'fix.error': message.slice(0, 8000),
        'fix.attempts': attempts,
        'fix.verified': false,
      });
    } catch (dbErr) {
      log.error(`could not record failure in Mongo: ${dbErr.message}`);
    }
    return { fixed: false, error: message };
  } finally {
    // 8. Always clean up
    await cleanup(dir).catch((e) => log.error(`cleanup failed: ${e.message}`));
  }
}

/** Compact, Mongo-friendly record of a replay. */
function summarize(r) {
  if (!r) return null;
  return {
    reproduced: r.reproduced,
    by: r.by,
    passed: r.passed,
    requestStatus: r.http?.status ?? null,
    browserError: r.browserError ?? null,
    serverErrors: r.browser?.serverErrors ?? [],
    steps: (r.browser?.steps ?? []).map(({ step, type, target, ok, error, serverErrors, screenshot }) =>
      ({ step, type, target, ok, error, serverErrors, screenshot })),
  };
}

function logSteps(log, label, browser) {
  for (const s of browser?.steps ?? []) {
    const mark = s.serverErrors ? `❌ ${s.serverErrors}× 5xx` : s.ok ? '✔' : `⚠ ${s.error}`;
    log(`  ${label} step ${s.step}: ${s.type} ${s.target ?? ''} → ${mark}`);
  }
}

const firstLine = (s) => String(s ?? '').split('\n')[0];
const truncate = (s, n) => {
  const str = String(s ?? 'crash');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};
