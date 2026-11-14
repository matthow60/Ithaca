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

const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

// Shapes a raw Mongo document into what the UI components expect,
// filling gaps so a half-written document from Member 1/2 doesn't crash the page.
export function normalizeIncident(doc) {
  const stackTrace = doc.stackTrace ?? '';
  return {
    ...doc,
    _id: String(doc._id),
    route: doc.route ?? 'Unknown route',
    errorMessage: doc.errorMessage || stackTrace.split('\n')[0] || 'Unknown error',
    stackTrace,
    timestamp: toIso(doc.timestamp) ?? new Date().toISOString(),
    status: doc.status ?? 'open',
    actions: (doc.actions ?? []).map((a) => ({ ...a, timestamp: toIso(a.timestamp) })),
    prUrl: doc.prUrl ?? null,
    codeDiff: doc.codeDiff ?? null,
  };
}
