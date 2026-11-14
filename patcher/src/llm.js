/*
 * Patch generation.
 *
 *   LLM_MODE=mock  serve hand-written patches from patcher/patches/<filePath>
 *   LLM_MODE=llm   ask an AI model for the fixed file:
 *     1. buildPrompt() → system + user messages (file, stack, user steps, request,
 *        and on retries why the previous attempt failed)
 *     2. POST to an OpenAI-compatible /chat/completions endpoint (Gemini's
 *        OpenAI-compatible API, Groq, …): LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
 *     3. On 429 / 5xx / network error, retry once on the fallback provider:
 *        LLM_FALLBACK_BASE_URL, LLM_FALLBACK_API_KEY, LLM_FALLBACK_MODEL
 *     4. extractCodeBlock() pulls the full corrected file out of the reply.
 *
 * Contract with pipeline.js:
 *   generatePatch({ filePath, fileContent, crashLine, stack, actions,
 *                   request, previousAttemptError })
 *     → Promise<{ patchedContent: string, source: "mock" | "llm" }>
 *
 * Errors marked `fatal: true` (bad config, missing mock patch) end the run;
 * anything else (bad reply, provider down) counts as a failed attempt and is retried.
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
    const providers = configuredProviders();
    if (!providers.length) {
      throw fatal('LLM_MODE=llm needs LLM_BASE_URL, LLM_API_KEY and LLM_MODEL in .env');
    }
    const messages = buildPrompt({ filePath, fileContent, crashLine, stack, actions, request, previousAttemptError });

    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i];
      try {
        console.log(`[llm] asking ${provider.label} for a patch to ${filePath}`);
        const text = await chatCompletion(provider, messages);
        return { patchedContent: extractCodeBlock(text), source: 'llm' };
      } catch (err) {
        const next = providers[i + 1];
        if (!err.retryable || !next) throw err;
        console.warn(`[llm] ${provider.label} failed (${err.message.split('\n')[0]}) — falling back to ${next.label}`);
      }
    }
  }

  throw fatal(`Unknown LLM_MODE "${mode}" (expected "mock" or "llm")`);
}

const LLM_TIMEOUT_MS = 60_000; // an overloaded model can hang; fail over instead of waiting

function configuredProviders() {
  const env = process.env;
  return [
    { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL },
    { baseUrl: env.LLM_FALLBACK_BASE_URL, apiKey: env.LLM_FALLBACK_API_KEY, model: env.LLM_FALLBACK_MODEL },
  ]
    .filter((p) => p.baseUrl && p.apiKey && p.model)
    .map((p) => ({ ...p, baseUrl: p.baseUrl.replace(/\/+$/, ''), label: `${p.model} @ ${new URL(p.baseUrl).host}` }));
}

const BUSY_RETRY_DELAYS_MS = [3000, 8000]; // on 429/503 from a provider, wait and try it again

/** Chat completion with short backoff retries when the provider is busy. */
async function chatCompletion(provider, messages) {
  for (let i = 0; ; i++) {
    try {
      return await chatCompletionOnce(provider, messages);
    } catch (err) {
      const busy = err.status === 429 || err.status === 503;
      if (!busy || i >= BUSY_RETRY_DELAYS_MS.length) throw err;
      const wait = err.retryAfterMs ?? BUSY_RETRY_DELAYS_MS[i];
      console.warn(`[llm] ${provider.label} busy (HTTP ${err.status}), retrying in ${Math.round(wait / 1000)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** POST an OpenAI-style chat completion and return the reply text. */
async function chatCompletionOnce({ baseUrl, apiKey, model }, messages) {
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    throw retryable(`LLM request failed: ${err.name === 'TimeoutError' ? `timed out after ${LLM_TIMEOUT_MS / 1000}s` : err.message}`);
  }

  const raw = await res.text();
  if (!res.ok) {
    // Any HTTP error is worth trying on the fallback (429/5xx = busy; 400/401/404 = bad key/model here).
    const err = retryable(`LLM HTTP ${res.status}: ${raw.slice(0, 500)}`);
    err.status = res.status;
    const retryAfter = Number(res.headers.get('retry-after'));
    if (retryAfter > 0 && retryAfter <= 30) err.retryAfterMs = retryAfter * 1000;
    throw err;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw retryable(`LLM returned non-JSON: ${raw.slice(0, 200)}`);
  }
  const content = json.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : content;
  if (!text) {
    throw retryable(`LLM returned no content (finish_reason: ${json.choices?.[0]?.finish_reason ?? 'unknown'})`);
  }
  return text;
}

function fatal(message) {
  const err = new Error(message);
  err.fatal = true;
  return err;
}

function retryable(message) {
  const err = new Error(message);
  err.retryable = true;
  return err;
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
      throw fatal(`No mock patch for ${filePath} — add patches/${filePath} or set LLM_MODE=llm`);
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
