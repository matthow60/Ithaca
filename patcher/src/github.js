// Branch, commit (fix + evidence), push, and open (or reuse) a PR against the target repo.
import { Octokit } from '@octokit/rest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { redact } from './log.js';

let octokit;
function gh() {
  octokit ??= new Octokit({ auth: process.env.GH_TOKEN, userAgent: 'autofix-patcher' });
  return octokit;
}

function repo() {
  return { owner: process.env.TARGET_OWNER, repo: process.env.TARGET_REPO };
}

/**
 * Create the fix branch, commit the patched file, then (separately) the evidence screenshots,
 * and push. Two commits so reviewers can drop the evidence before merging if they want.
 * @returns {{ evidenceSha: string|null }} commit holding the screenshots (for stable image URLs)
 */
export async function commitAndPush(git, { branch, filePath, message, evidenceDir, dir }) {
  await git.checkoutLocalBranch(branch);
  await git.add(filePath);
  await git.commit(message);

  let evidenceSha = null;
  if (evidenceDir && existsSync(evidenceDir)) {
    const rel = path.relative(dir, evidenceDir).split(path.sep).join('/');
    await git.raw(['add', '--force', rel]); // --force in case the repo ignores *.png
    const status = await git.status();
    if (status.staged.length) {
      await git.commit(`chore: autofix evidence (before/after screenshots)\n\nSafe to delete before merging.`);
      evidenceSha = (await git.revparse(['HEAD'])).trim();
    }
  }

  try {
    // --force: /demo/run re-runs reuse the same branch name.
    await git.push('origin', branch, ['--force', '--set-upstream']);
  } catch (err) {
    throw new Error(`git push failed: ${redact(err.message)}`);
  }
  return { evidenceSha };
}

/** Open a PR to the default branch, or update the existing open one for this branch. */
export async function openPullRequest({ branch, title, body }) {
  const { owner, repo: name } = repo();
  const { data: repoInfo } = await gh().repos.get({ owner, repo: name });
  const base = repoInfo.default_branch;

  const { data: existing } = await gh().pulls.list({ owner, repo: name, head: `${owner}:${branch}`, state: 'open' });
  if (existing.length) {
    const { data: pr } = await gh().pulls.update({ owner, repo: name, pull_number: existing[0].number, title, body });
    return pr.html_url;
  }

  const { data: pr } = await gh().pulls.create({ owner, repo: name, head: branch, base, title, body });
  return pr.html_url;
}

/** URL GitHub will render as an image for anyone with access to the repo (pinned to a commit). */
export function evidenceUrl(evidenceSha, evidenceRelDir, file) {
  const { owner, repo: name } = repo();
  return `https://github.com/${owner}/${name}/blob/${evidenceSha}/${evidenceRelDir}/${file}?raw=true`;
}

export function describeAction(a) {
  const parts = [
    a.type,
    a.target && `\`${a.target}\``,
    a.value !== undefined && a.value !== null && a.value !== '' && `"${a.value}"`,
  ];
  return parts.filter(Boolean).join(' ');
}

export function buildPrBody({ incident, codeDiff, patchSource, attempts, reproduction, proof, evidence }) {
  const req = incident.request || {};
  const fence = codeDiff.includes('```') ? '````' : '```'; // diffs can contain ``` themselves

  const lines = [
    `## 🤖 AutoFix: ${incident.incidentId}`,
    '',
    '### Error',
    '```',
    incident.error?.message || '(no message)',
    '```',
    `at \`${evidence.filePath}:${evidence.line ?? '?'}\`${incident.route ? ` (route \`${incident.route}\`)` : ''}`,
    '',
  ];

  // Reproduction + proof
  lines.push('### Reproduced from the user\'s recorded steps');
  if (reproduction.by === 'browser') {
    const e = reproduction.browser.serverErrors[0];
    lines.push(`Replayed the user's ${reproduction.browser.steps.length} recorded steps in a headless browser against the **original** code: ` +
      `step ${e.step} triggered **${e.status}** on \`${e.method} ${e.url}\`.`);
  } else {
    lines.push(`Replaying the recorded request \`${req.method || 'GET'} ${req.path}\` against the **original** code returned **${reproduction.http?.status}**.` +
      (reproduction.browser ? ' (The browser replay of the user\'s steps did not hit the error on its own.)' : ''));
  }
  lines.push('');
  lines.push('### Fix verified');
  const afterSteps = proof.browser?.steps;
  if (afterSteps) {
    const okCount = afterSteps.filter((s) => s.ok).length;
    lines.push(`Replayed the same steps against the **patched** code: **no 5xx responses**, ${okCount}/${afterSteps.length} steps completed` +
      `${proof.http ? `, request replay returned **${proof.http.status}**` : ''} (attempt ${attempts}).`);
  } else {
    lines.push(`Replayed \`${req.method || 'GET'} ${req.path}\` against the patched code: **${proof.http?.status}** (attempt ${attempts}).`);
  }
  lines.push('');

  // Step-by-step before/after table
  const before = reproduction.browser?.steps || [];
  const after = proof.browser?.steps || [];
  const count = Math.max(before.length, after.length);
  if (count) {
    lines.push('### Step-by-step replay');
    const img = (s) => {
      if (!s) return '—';
      const mark = s.serverErrors ? `❌ ${s.serverErrors}× 5xx` : s.ok ? '✅' : `⚠️ ${s.error}`;
      const pic = evidence.sha ? `<br><img src="${evidenceUrl(evidence.sha, evidence.relDir, s.screenshot)}" width="360">` : '';
      return `${mark}${pic}`;
    };
    lines.push('| # | User action | Before fix | After fix |');
    lines.push('|---|---|---|---|');
    for (let i = 0; i < count; i++) {
      const s = before[i] || after[i];
      lines.push(`| ${i + 1} | ${describeAction(s).replace(/\|/g, '\\|')} | ${img(before[i])} | ${img(after[i])} |`);
    }
    lines.push('');
  } else if ((incident.actions || []).length) {
    lines.push('### User steps');
    incident.actions.forEach((a, i) => lines.push(`${i + 1}. ${describeAction(a)}`));
    lines.push('');
  }

  lines.push(
    '### Diff',
    `${fence}diff`,
    codeDiff.trimEnd(),
    fence,
    '',
    '---',
    `Patch source: **${patchSource}**${patchSource === 'mock' ? ' (hand-written mock patch, not AI-generated)' : ' (AI-generated)'}`,
  );
  if (evidence.sha) {
    lines.push(`Screenshots are in \`${evidence.relDir}/\` (separate commit — safe to drop before merging).`);
  }
  return lines.join('\n');
}
