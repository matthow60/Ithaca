# patcher

Takes a crash recorded in MongoDB — stack trace **plus the user's last 15 steps** — and:

1. **Reproduces** it: boots the original app and replays the user's steps in a headless browser,
   screenshotting every step, until the 500 shows up.
2. **Patches** the broken file (found from the stack trace).
3. **Proves** the fix: boots the patched app and replays the *same* steps. The incident's own crash
   must be gone and no *new* 5xx may appear. A 5xx that the original code also produced on a
   different endpoint (a separate, existing bug) is ignored and noted in the PR.
4. Opens a **GitHub PR** with the diff and a before/after screenshot for every step, and updates the
   incident in MongoDB.

```
incident (status: open)  ← written by the crash reporter in the target app
   │  change stream insert  /  POST /incidents/:id/fix  /  POST /demo/run/:id
   ▼
claim → clone repo → npm ci → stack trace → crashing file + line
   ▼
REPRODUCE  original code, replay user steps in Chromium → 📸 before-NN.png     (status: reproducing)
   │ no 5xx (browser or raw request)? → status: not_reproducible, stop
   ▼
generatePatch() → write file                                                   (status: patching)
   ▼
PROVE      patched code, replay same steps → 📸 after-NN.png, + request replay (status: verifying)
   │ target crash still there, or a new 5xx → retry with previousAttemptError (max 3) → status: failed
   ▼
commit fix  +  commit .autofix/<id>/*.png  → push fix/<id> → PR               (status: fixed)
```

Once it's running there is nothing to do by hand: crashes get inserted, the change stream picks
them up, and PRs appear. A human reviews and merges.

> **Patch source:** `LLM_MODE=llm` asks Gemini (or any OpenAI-compatible model) to write the fix;
> `LLM_MODE=mock` uses hand-written fixes from `patches/` (handy for a guaranteed demo).

## Setup

Requirements: Node 20+, git, MongoDB with change streams (Atlas, any tier), a GitHub repo for the
target app.

```bash
cd patcher
npm install        # also downloads headless Chromium for Playwright (~300 MB, once)
cp ../.env.example ../.env   # one .env at the repo root, shared with the dashboard
```

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | — | Mongo connection string (same name as the dashboard) |
| `MONGODB_DB` | `hackuta` | Database shared with the dashboard |
| `MONGODB_COLLECTION` | `incidents` | Collection holding incidents |
| `GH_TOKEN` | — | Fine-grained token: Contents + Pull requests read/write on the target repo only |
| `TARGET_OWNER` / `TARGET_REPO` | — | Repo to clone and open PRs against |
| `TARGET_START_CMD` | `node server/index.js` | Boots the target app from the repo root. Must listen on `process.env.PORT` |
| `TARGET_SERVER_DIR` | `.` | Folder (relative to repo root) where `npm ci` runs |
| `PORT` | `4000` | Patcher HTTP port |
| `LLM_MODE` | `mock` | `llm` = AI writes the fix; `mock` = use `patches/` |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | — | Primary AI model (OpenAI-compatible endpoint, e.g. Gemini) |
| `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_MODEL` | — | Used when the primary is busy (429/5xx), times out, or errors |

The clone goes to `<os temp dir>/<incidentId>` and is always deleted afterwards. `GH_TOKEN` and the LLM
keys are removed from the environment the target app runs with.

## What the target app must do

1. **One Node server serves the pages and the API**, started by `TARGET_START_CMD`, listening on
   `process.env.PORT`, and able to boot with no external services (in-memory data is ideal).
2. **The crash reporter writes an incident** in this shape (collection `incidents`):
   ```js
   {
     incidentId: "incident-123", status: "open", createdAt, route,
     error:   { message, stack, file, line },        // stack is what's used to find the file
     actions: [{ t, type, target, value, url }],      // last 15 user actions
     request: { method, path, body, headers }         // the request that returned 500
   }
   ```
3. **Actions are replayable:**
   - `type`: `navigate`, `click`, `dblclick`, `input`/`type`/`fill`/`change`, `select`, `check`,
     `uncheck`, `submit`, `keypress`, `scroll`
   - `target`: a CSS selector. **Use `data-testid` attributes** (`[data-testid="add-to-cart"]`) —
     auto-generated selectors like `div > span:nth-child(3)` break.
   - `url`: the page the action happened on. Any host/port is fine; only path + query are used.

## Tests

```bash
npm test    # boots a tiny fixture app and runs reproduce()/prove() in headless Chromium (~20s)
```

Run it before pushing changes to `src/verify.js` or `src/replay.js`. No Mongo, GitHub or LLM needed.

## Run it locally (mock mode)

```bash
npm start                                   # terminal 1
npm run seed                                # terminal 2 — inserts incident-123, change stream picks it up
```

Or trigger manually / re-run:

```bash
curl -X POST http://localhost:4000/incidents/incident-123/fix   # run an open incident
curl -X POST http://localhost:4000/demo/run/incident-123         # reset to open + run again
curl http://localhost:4000/health
```

Every step is logged with its duration, prefixed `[incident-123]`, including each replayed user
step (`before step 3: click [data-testid="add-sku-42"] → ❌ 1× 5xx`).

## Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/health` | Status, `llmMode`, current/queued work |
| `POST` | `/incidents/:id/fix` | Queue a run; `202` immediately. No-op if not `open` |
| `POST` | `/demo/run/:id` | Reset to `open`, clear `fix`, queue a run. `404` if unknown, `409` if busy |

Incidents run one at a time. Claiming is atomic, so duplicate triggers are harmless.

## What ends up where

**The PR** — error, how it was reproduced, proof it's fixed, a table of every user step with the
before/after screenshot and result, and the diff. Screenshots are committed in a **separate
commit** under `.autofix/<incidentId>/` so GitHub can render them; drop that commit before merging
if you don't want them in `main`.

**MongoDB** (`incidents.fix`):

```js
{ branch, prUrl, codeDiff, verified, attempts, patchSource, file, line,
  reproduction: { reproduced, by: "browser"|"request", requestStatus, serverErrors, steps: [...] },
  proof:        { passed, requestStatus, serverErrors, steps: [...] },
  evidence:     { commit, path },          // screenshots in the repo at that commit
  error }                                  // set when status is failed / not_reproducible
```

Statuses: `open → reproducing → patching → verifying → fixed`, or `failed` /
`not_reproducible`.

## Adding a mock patch

The crashing file is found by parsing `error.stack` (first frame outside `node_modules`/Node
internals; absolute paths like `/app/server/...` or `file:///C:/.../server/...` are mapped onto the
clone). If that fails it falls back to `error.file` / `error.line`.

`generatePatch` in mock mode returns `patches/<repo-relative crash file>` **as the entire new file**:

1. Copy the broken file from the target repo to `patches/<same path>`.
2. Fix the bug in the copy.
3. Make sure the incident's steps/request hit that bug, then trigger a run.

No matching file → the run fails with `No mock patch for <file> — AI patching not implemented yet`.
The included `patches/server/src/routes/cart.js` matches the seed incident.

## AI patching (`src/llm.js`)

- `buildPrompt` sends the broken file, stack trace, crashing line, the user's steps, the request,
  and on retries **why the previous fix failed** (replay output), asking for the full fixed file.
- Calls `${LLM_BASE_URL}/chat/completions`. If the model is busy (429/503) it waits 3 s, then 8 s,
  and then switches to the `LLM_FALLBACK_*` model. 60 s timeout per call.
- A reply with no code block, or a fix that still crashes on replay, counts as a failed attempt
  (max 3). Config errors and missing mock patches stop the run immediately.
- Line endings of the original file are preserved so the PR diff only shows real changes.

Gemini model names change often and older ones get retired for new keys. List what your key can
use with `curl -H "Authorization: Bearer KEY" https://generativelanguage.googleapis.com/v1beta/openai/models`.
