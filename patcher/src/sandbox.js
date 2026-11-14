// Per-incident working copy of the target repo: clone, install, read/write, diff, cleanup.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { redact } from './log.js';

/** Incident ids end up in paths and branch names, so keep them boring. */
export function safeId(incidentId) {
  return String(incidentId).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** /tmp/<incidentId> on Linux/macOS, %TEMP%\<incidentId> on Windows. */
export function sandboxDir(incidentId) {
  return path.join(os.tmpdir(), safeId(incidentId));
}

export async function cloneRepo(incidentId) {
  const { GH_TOKEN, TARGET_OWNER, TARGET_REPO } = process.env;
  if (!GH_TOKEN || !TARGET_OWNER || !TARGET_REPO) {
    throw new Error('GH_TOKEN, TARGET_OWNER and TARGET_REPO must be set');
  }
  const dir = sandboxDir(incidentId);
  await fs.rm(dir, { recursive: true, force: true }); // leftover from a crashed run

  const url = `https://x-access-token:${GH_TOKEN}@github.com/${TARGET_OWNER}/${TARGET_REPO}.git`;
  try {
    await simpleGit().clone(url, dir, ['--depth', '1']);
  } catch (err) {
    throw new Error(`git clone failed: ${redact(err.message)}`);
  }

  const git = simpleGit(dir);
  await git.addConfig('user.name', 'AutoFix Bot');
  await git.addConfig('user.email', 'autofix-bot@users.noreply.github.com');
  return { dir, git };
}

/** npm ci in TARGET_SERVER_DIR (or repo root); falls back to npm install without a lockfile. */
export async function installDeps(dir) {
  const installDir = path.resolve(dir, process.env.TARGET_SERVER_DIR || '.');
  if (!existsSync(path.join(installDir, 'package.json'))) {
    throw new Error(`No package.json in ${path.relative(dir, installDir) || '.'}`);
  }
  const hasLock = existsSync(path.join(installDir, 'package-lock.json'));
  const args = hasLock
    ? ['ci', '--no-audit', '--no-fund']
    : ['install', '--no-audit', '--no-fund'];
  await run('npm', args, installDir);
}

/** Resolve a repo-relative path, refusing anything that escapes the sandbox. */
function resolveInRepo(dir, relPath) {
  if (!relPath) throw new Error('Incident has no error.file');
  const full = path.resolve(dir, relPath);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing path outside the repo: ${relPath}`);
  }
  return full;
}

export async function readRepoFile(dir, relPath) {
  const full = resolveInRepo(dir, relPath);
  try {
    return await fs.readFile(full, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`File not found in repo: ${relPath}`);
    throw err;
  }
}

export async function writeRepoFile(dir, relPath, content) {
  await fs.writeFile(resolveInRepo(dir, relPath), content, 'utf8');
}

export async function gitDiff(git) {
  return git.diff();
}

export async function cleanup(dir) {
  if (dir) await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    // shell: true so `npm` resolves to npm.cmd on Windows. args are fixed constants, never user input.
    const child = spawn([cmd, ...args].join(' '), { cwd, shell: true, env: process.env });
    let tail = '';
    const keep = (chunk) => { tail = (tail + chunk).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${redact(tail)}`));
    });
  });
}
