// Checks the Gemini keys in .env without printing them.
// Run with: npm run llm:test
import { GoogleGenAI } from '@google/genai';

const env = process.env;
const configs = [
  ['primary', env.GEMINI_API_KEY || env.LLM_API_KEY, env.GEMINI_MODEL || env.LLM_MODEL || 'gemini-flash-latest'],
  ['fallback', env.LLM_FALLBACK_API_KEY, env.LLM_FALLBACK_MODEL || 'gemini-2.5-flash'],
];

let anyOk = false;
for (const [label, key, model] of configs) {
  if (!key) {
    console.log(`– ${label}: no key set, skipped`);
    continue;
  }
  const bad = [...key].map((c, i) => [c, i]).filter(([c]) => c.charCodeAt(0) > 126);
  if (bad.length) {
    console.log(`❌ ${label}: key has ${bad.length} non-ASCII look-alike character(s) at position(s) ${bad.map(([, i]) => i).join(', ')}. Re-copy it from Google AI Studio.`);
    continue;
  }
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({ model, contents: 'Reply with just the word: ok' });
    console.log(`✅ ${label} (${model}): replied "${res.text.trim()}"`);
    anyOk = true;
  } catch (e) {
    console.log(`❌ ${label} (${model}): ${e.message.slice(0, 200)}`);
  }
}
process.exitCode = anyOk ? 0 : 1;
