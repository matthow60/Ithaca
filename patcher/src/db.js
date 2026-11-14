import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectDb() {
  if (db) return db;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGO_DB || 'autofix');
  await incidents().createIndex({ incidentId: 1 }, { unique: true });
  return db;
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  db = undefined;
}

export function incidents() {
  if (!db) throw new Error('Database not connected — call connectDb() first');
  return db.collection('incidents');
}

/**
 * Atomically move an incident from "open" to "patching".
 * Returns the claimed document, or null if it doesn't exist / was already claimed.
 */
export async function claimIncident(incidentId) {
  return incidents().findOneAndUpdate(
    { incidentId, status: 'open' },
    { $set: { status: 'patching', claimedAt: new Date() } },
    { returnDocument: 'after' },
  );
}

/** $set the given fields (dot paths allowed, e.g. { 'fix.error': '...' }). */
export async function updateIncident(incidentId, set) {
  return incidents().updateOne({ incidentId }, { $set: { ...set, updatedAt: new Date() } });
}

/** Put an incident back to "open" with no fix, for demo re-runs. Returns true if found. */
export async function resetIncident(incidentId) {
  const res = await incidents().updateOne(
    { incidentId },
    { $set: { status: 'open', updatedAt: new Date() }, $unset: { fix: '', claimedAt: '' } },
  );
  return res.matchedCount > 0;
}
