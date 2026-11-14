import { GoogleGenAI } from '@google/genai';
import { idFilter, incidentsCollection } from '../../../lib/mongodb';
import { buildIncidentPrompt } from '../../../lib/geminiPrompt';

export const dynamic = 'force-dynamic';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// POST /api/summarize { incidentId } → { whatBroke, whyTriggered, howFixed }
// The summary is cached on the incident document so Gemini runs once per incident.
export async function POST(req) {
  try {
    const { incidentId } = await req.json();
    if (!incidentId) return Response.json({ error: 'incidentId is required' }, { status: 400 });

    const col = await incidentsCollection();
    const incident = await col.findOne(idFilter(incidentId));
    if (!incident) return Response.json({ error: 'Incident not found' }, { status: 404 });
    if (incident.summary) return Response.json(incident.summary);

    if (!process.env.GEMINI_API_KEY) {
      return Response.json({ error: 'GEMINI_API_KEY is not set in .env' }, { status: 503 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: buildIncidentPrompt({
        stackTrace: incident.stackTrace ?? '',
        actions: incident.actions ?? [],
        codeDiff: incident.codeDiff,
      }),
      config: { responseMimeType: 'application/json' },
    });

    const parsed = JSON.parse(res.text);
    const summary = {
      whatBroke: parsed.whatBroke ?? '',
      whyTriggered: parsed.whyTriggered ?? '',
      howFixed: parsed.howFixed ?? '',
    };
    await col.updateOne({ _id: incident._id }, { $set: { summary } });
    return Response.json(summary);
  } catch (err) {
    console.error('[api/summarize]', err);
    return Response.json({ error: `Summary failed: ${err.message}` }, { status: 500 });
  }
}
