/*
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                         🚧  UNDER CONSTRUCTION  🚧                         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * AI patch generation is NOT implemented yet. Right now this module only
 * serves hand-written mock patches from patcher/patches/<filePath>.
 *
 * The real version will:
 *   1. Build a prompt with buildPrompt() (done — see below).
 *   2. POST it to an OpenAI-compatible /chat/completions endpoint
 *      (Gemini's OpenAI-compatible API or Groq), configured by:
 *        LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
 *   3. Ask for the FULL corrected file in ONE fenced code block, and pull it
 *      out with extractCodeBlock() (done — see below).
 *   4. On HTTP 429 or 5xx from the primary provider, retry once against the
 *      fallback provider:
 *        LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL
 *
 * The exported interface below is the contract with pipeline.js. Keep it
 * stable so the real implementation is a drop-in replacement:
 *
 *   generatePatch({ filePath, fileContent, crashLine, stack, actions,
 *                   request, previousAttemptError })
 *     → Promise<{ patchedContent: string, source: "mock" | "llm" }>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATCHES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'patches');

export async function generatePatch({
  filePath,
  fileContent,
  crashLine,
  stack,
  actions,
  request,
  previousAttemptError,
}) {
  const mode = (process.env.LLM_MODE || 'mock').toLowerCase();

  if (mode === 'mock') {
    return { patchedContent: await readMockPatch(filePath), source: 'mock' };
  }

  if (mode === 'llm') {
    // ─── TODO: real API call goes here ─────────────────────────────────────
    // const messages = buildPrompt({ filePath, fileContent, crashLine, stack,
    //                                actions, request, previousAttemptError });
    // const text = await chatCompletion(primaryProvider(), messages)
    //   .catch((err) => isRetryable(err)            // 429 or 5xx
    //     ? chatCompletion(fallbackProvider(), messages)
    //     : Promise.reject(err));
    // return { patchedContent: extractCodeBlock(text), source: 'llm' };
    //
    // chatCompletion({ baseUrl, apiKey, model }, messages):
    //   POST `${baseUrl}/chat/completions`
    //   headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    //   body:    { model, messages, temperature: 0.1 }
    //   → json.choices[0].message.content
    // ───────────────────────────────────────────────────────────────────────
    throw new Error('LLM mode not implemented yet');
  }

  throw new Error(`Unknown LLM_MODE "${mode}" (expected "mock" or "llm")`);
}

async function readMockPatch(filePath) {
  const full = path.resolve(PATCHES_DIR, filePath);
  if (path.relative(PATCHES_DIR, full).startsWith('..')) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  try {
    return await fs.readFile(full, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`No mock patch for ${filePath} — AI patching not implemented yet`);
    }
    throw err;
  }
}

/**
 * Build chat messages asking for a full corrected file.
 * Returns [{ role: 'system', content }, { role: 'user', content }].
 */
export function buildPrompt({
  filePath,
  fileContent,
  crashLine,
  stack,
  actions = [],
  request,
  previousAttemptError,
}) {
  const system = [
    'You are an expert Node.js engineer fixing a production crash.',
    'You will be given one source file, the stack trace, the HTTP request that returned 500, and the user actions leading up to it.',
    'Fix the root cause with the smallest correct change. Do not refactor, rename, reformat, or change unrelated behavior.',
    'Keep the module system, exports, and imports exactly as they are. Do not add dependencies.',
    'Respond with the COMPLETE corrected file in exactly ONE fenced code block and nothing else.',
  ].join('\n');

  const steps = actions.length
    ? actions
        .map((a, i) => {
          const parts = [a.type, a.target, a.value !== undefined && a.value !== '' ? `"${a.value}"` : null, a.url ? `@ ${a.url}` : null];
          return `${i + 1}. ${parts.filter(Boolean).join(' ')}`;
        })
        .join('\n')
    : '(none recorded)';

  const lang = path.extname(filePath).replace('.', '') || 'js';
  const sections = [
    `File: ${filePath}`,
    `Crashing line: ${crashLine ?? '(unknown)'}`,
    `Stack trace:\n${stack || '(none)'}`,
    `Request that returned 500:\n${JSON.stringify(request ?? {}, null, 2)}`,
    `User actions before the crash:\n${steps}`,
  ];
  if (previousAttemptError) {
    sections.push(
      `A previous fix attempt FAILED verification when the request was replayed:\n${previousAttemptError}\nTry a different fix.`,
    );
  }
  sections.push(`Current contents of ${filePath}:\n\`\`\`${lang}\n${fileContent}\n\`\`\``);
  sections.push('Return the full corrected file in one fenced code block.');

  return [
    { role: 'system', content: system },
    { role: 'user', content: sections.join('\n\n') },
  ];
}

/**
 * Pull the code out of a model response. Takes the longest fenced block
 * (models sometimes add a tiny example block too). Throws if there is none.
 */
export function extractCodeBlock(text) {
  const fence = /```[^\n`]*\n([\s\S]*?)```/g;
  let best = null;
  for (const match of String(text ?? '').matchAll(fence)) {
    if (best === null || match[1].length > best.length) best = match[1];
  }
  if (best === null || !best.trim()) {
    throw new Error('LLM response did not contain a fenced code block');
  }
  return best.endsWith('\n') ? best : `${best}\n`;
}
