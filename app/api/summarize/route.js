import { GoogleGenAI } from '@google/genai';
import { idFilter, incidentsCollection, normalizeIncident } from '../../../lib/mongodb';
import { buildIncidentPrompt } from '../../../lib/geminiPrompt';

export const dynamic = 'force-dynamic';

// Primary + fallback Gemini configs. Accepts either GEMINI_* or the team's LLM_* names.
function geminiConfigs() {
  const env = process.env;
  const primaryKey = env.GEMINI_API_KEY || env.LLM_API_KEY;
  // Defaults match patcher/.env.example. gemini-2.5-flash is retired for new keys, and
  // gemini-flash-latest points at the newest model, which is often overloaded.
  return [
    { apiKey: primaryKey, model: env.GEMINI_MODEL || env.LLM_MODEL || 'gemini-3.5-flash' },
    // Fallback reuses the primary key unless it has its own (another Gemini model, same account).
    { apiKey: env.LLM_FALLBACK_API_KEY || primaryKey, model: env.LLM_FALLBACK_MODEL || 'gemini-3.1-flash-lite' },
  ].filter((c) => c.apiKey);
}

async function askGemini(prompt) {
  const configs = geminiConfigs();
  if (configs.length === 0) throw new Error('No Gemini API key set (LLM_API_KEY or GEMINI_API_KEY in .env)');

  let lastError;
  for (const { apiKey, model } of configs) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      return JSON.parse(res.text);
    } catch (err) {
      console.error(`[api/summarize] ${model} failed:`, err.message);
      lastError = err;
    }
  }
  throw lastError;
}

// POST /api/summarize { incidentId } → { whatBroke, whyTriggered, howFixed }
// The summary is cached on the incident document so Gemini runs once per incident.
export async function POST(req) {
  try {
    const { incidentId } = await req.json();
    if (!incidentId) return Response.json({ error: 'incidentId is required' }, { status: 400 });

    const col = await incidentsCollection();
    const doc = await col.findOne(idFilter(incidentId));
    if (!doc) return Response.json({ error: 'Incident not found' }, { status: 404 });
    if (doc.summary) return Response.json(doc.summary);

    const incident = normalizeIncident(doc);
    const parsed = await askGemini(
      buildIncidentPrompt({
        stackTrace: incident.stackTrace,
        actions: incident.actions,
        codeDiff: incident.codeDiff,
      })
    );
    const summary = {
      whatBroke: parsed.whatBroke ?? '',
      whyTriggered: parsed.whyTriggered ?? '',
      howFixed: parsed.howFixed ?? '',
    };
    await col.updateOne({ _id: doc._id }, { $set: { summary } });
    return Response.json(summary);
  } catch (err) {
    console.error('[api/summarize]', err);
    return Response.json({ error: `Summary failed: ${err.message}` }, { status: 500 });
  }
}
