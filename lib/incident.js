// The one place that turns a stored incident document into what the UI renders.
// Pure (no DB imports): used by the API routes before data is sent to the browser.
//
// Stored schema (written by the crash reporter, updated by patcher/ — see patcher/README.md):
// {
//   incidentId, status, createdAt, route,
//   error:   { message, stack, file, line },
//   actions: [{ t, type, target, value, url }],          // last 15 user actions
//   request: { method, path, body, headers },            // the request that returned 500
//   fix:     { branch, prUrl, codeDiff, verified, attempts, patchSource, error,
//              reproduction, proof, evidence },
//   summary                                              // cached by app/api/summarize
// }
// status: open → reproducing → patching → verifying → fixed  (or failed / not_reproducible)
//
// Older flat documents (errorMessage, stackTrace, prUrl, codeDiff, timestamp) are still accepted.

const toIso = (v) => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') return new Date(v).toISOString(); // epoch ms, e.g. actions[].t
  return v ?? null;
};

export function normalizeIncident(doc) {
  const stackTrace = doc.error?.stack ?? doc.stackTrace ?? '';
  return {
    ...doc,
    _id: String(doc._id),
    incidentId: doc.incidentId ?? String(doc._id),
    route: doc.route ?? 'Unknown route',
    errorMessage: doc.error?.message || doc.errorMessage || stackTrace.split('\n')[0] || 'Unknown error',
    stackTrace,
    timestamp: toIso(doc.createdAt ?? doc.timestamp) ?? new Date().toISOString(),
    status: doc.status ?? 'open',
    actions: (doc.actions ?? []).map((a) => ({
      ...a,
      timestamp: toIso(a.t ?? a.timestamp),
      value: a.value ?? undefined, // stored as null when absent; the timeline checks for undefined
    })),
    prUrl: doc.fix?.prUrl ?? doc.prUrl ?? null,
    codeDiff: doc.fix?.codeDiff ?? doc.codeDiff ?? null,
    fixError: doc.fix?.error ?? null,
  };
}
