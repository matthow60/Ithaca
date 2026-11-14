import { incidentsCollection, normalizeIncident } from '../../../lib/mongodb';

export const dynamic = 'force-dynamic'; // always read fresh data, never cache

// GET /api/incidents → newest 50 incidents from MongoDB
export async function GET() {
  try {
    const col = await incidentsCollection();
    // createdAt is the schema field; timestamp covers older flat documents.
    const docs = await col.find().sort({ createdAt: -1, timestamp: -1 }).limit(50).toArray();
    return Response.json(docs.map(normalizeIncident));
  } catch (err) {
    console.error('[api/incidents]', err);
    return Response.json({ error: `Database error: ${err.message}` }, { status: 500 });
  }
}
