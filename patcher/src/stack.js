// Find the crashing file + line in a cloned repo from a stack trace.
//
// Stack frames contain paths from wherever the app was running, e.g.
//   at handler (/app/server/src/routes/cart.js:17:51)
//   at file:///C:/Users/dev/BuggyWebsite/server/src/routes/cart.js:17:51
//   at C:\srv\BuggyWebsite\server\index.js:9:3
// We take the first frame that isn't Node internals or node_modules and strip
// leading path segments until what's left exists inside the clone.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const FRAME = /(?:\(|\s|^)((?:file:\/\/)?(?:\/?[A-Za-z]:)?[^\s():]*[\\/][^\s():]+?):(\d+)(?::(\d+))?\)?\s*$/;

/** All user-code frames in a stack, top first: [{ rawPath, line, column }] */
export function parseStack(stack) {
  const frames = [];
  for (const raw of String(stack ?? '').split(/\r?\n/)) {
    const lineText = raw.trim();
    if (!lineText.startsWith('at ')) continue;
    const m = lineText.match(FRAME);
    if (!m) continue;
    let p = m[1];
    if (p.startsWith('file://')) {
      p = decodeURIComponent(p.replace(/^file:\/\//, ''));
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // file:///C:/x → C:/x
    }
    if (p.startsWith('node:') || p.startsWith('internal/') || /[\\/]node_modules[\\/]/.test(p)) continue;
    frames.push({ rawPath: p, line: Number(m[2]), column: m[3] ? Number(m[3]) : null });
  }
  return frames;
}

/** Map an absolute path from another machine onto a repo-relative path that exists in dir. */
export function toRepoPath(dir, rawPath) {
  const parts = rawPath.replace(/^[A-Za-z]:/, '').split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const rel = parts.slice(i).join('/');
    const full = path.join(dir, rel);
    if (existsSync(full) && statSync(full).isFile()) return rel;
  }
  return null;
}

/**
 * Decide which file/line to patch. Prefers the stack trace; falls back to
 * error.file / error.line if the stack doesn't resolve to a file in the repo.
 * @returns {{ filePath: string, line: number|null, from: 'stack'|'error.file' }}
 */
export function resolveCrashLocation(dir, error = {}) {
  for (const frame of parseStack(error.stack)) {
    const rel = toRepoPath(dir, frame.rawPath);
    if (rel) return { filePath: rel, line: frame.line, from: 'stack' };
  }
  if (error.file) {
    const rel = toRepoPath(dir, error.file);
    if (rel) return { filePath: rel, line: Number(error.line) || null, from: 'error.file' };
  }
  throw new Error(
    `Could not find the crashing file in the repo (stack top: ${parseStack(error.stack)[0]?.rawPath ?? 'none'}, error.file: ${error.file ?? 'none'})`,
  );
}
