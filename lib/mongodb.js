// Server-only MongoDB helper. Import this from app/api/** routes, never from client components.
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'hackuta';
export const INCIDENTS_COLLECTION = process.env.MONGODB_COLLECTION || 'incidents';

// Reuse one client across hot reloads in dev (each reload would otherwise open a new pool).
function getClientPromise() {
  if (!uri) throw new Error('MONGODB_URI is not set in .env');
  if (!globalThis._mongoClientPromise) {
    globalThis._mongoClientPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
      .connect()
      .catch((err) => {
        globalThis._mongoClientPromise = null; // allow a retry on the next request
        throw err;
      });
  }
  return globalThis._mongoClientPromise;
}

export async function getDb() {
  return (await getClientPromise()).db(dbName);
}

export function incidentsCollection() {
  return getDb().then((db) => db.collection(INCIDENTS_COLLECTION));
}

// Accepts either a Mongo ObjectId string or a plain string id like "incident-124".
export function idFilter(id) {
  return ObjectId.isValid(id) && String(new ObjectId(id)) === id ? { _id: new ObjectId(id) } : { _id: id };
}

// Shaping documents for the UI lives in lib/incident.js.
export { normalizeIncident } from './incident';
