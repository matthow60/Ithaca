# AutoFix

**A web app crashes → AutoFix replays what the user did, finds the bug, has AI fix it, proves the fix
works by replaying the same steps again, and opens a GitHub pull request. No human in the loop until
review.**

Built for HackUTA.

## How it works

```
 BuggyWebsite (target app, separate repo)          MongoDB Atlas            AutoFix (this repo)
 ─────────────────────────────────────────        ───────────────          ───────────────────────────
 user clicks around → server crashes (500)
 crash recorder saves an incident:        ──────►  hackuta.incidents  ◄────  patcher/  (the engine)
   error + stack trace                             { status: "open", …}       1. sees the new incident
   the user's last 15 actions                                                  2. clones the target repo
   the request that failed                                                     3. REPRODUCE: replays the user's
                                                                                  steps in a headless browser
                                                                                  until the 500 happens
                                                                               4. finds the broken file from
                                                                                  the stack trace
                                                                               5. Gemini writes the fix
                                                                               6. PROVE: replays the same steps
                                                                                  on the fixed code, no 500
                                                                               7. pushes a branch + opens a PR
                                                                                  with before/after screenshots
                                                          ▲                    8. writes status + PR link back
                                                          │
                                                   dashboard (Next.js, repo root)
                                                   shows every incident live: steps, stack trace,
                                                   status pipeline, diff, PR link, AI summary
```

The three parts never call each other directly. They only share the `incidents` collection in MongoDB.

Incident status: `open → reproducing → patching → verifying → fixed`, or `failed` / `not_reproducible`.

## Repo layout

```
AutomatedFix/
├── .env.example     settings template, shared by the engine and the dashboard
├── app/ components/ lib/   dashboard (Next.js)
├── scripts/         dashboard checks: npm run db:test, npm run llm:test
└── patcher/         the engine; details in patcher/README.md
```

The target app lives in its own repo: [`matthow60/BuggyWebsite`](https://github.com/matthow60/BuggyWebsite).
It has three planted bugs and the crash recorder.

## Requirements

- **Node.js 20+** and **git**
- **MongoDB Atlas** cluster (the free tier works). Your IP must be allowed under *Security → Network Access*.
- **GitHub fine-grained token** for the target repo with **Contents: read/write** and **Pull requests: read/write**
- **Gemini API key** from https://aistudio.google.com/apikey (the free tier works)

## Setup (once)

```powershell
# 1. Install the dashboard and the engine (the engine also downloads a headless Chromium, ~300 MB)
cd AutomatedFix
npm install
cd patcher
npm install
cd ..

# 2. Create your settings file and fill it in
copy .env.example .env
```

In `.env`, fill in at least:

| Setting | Value |
|---|---|
| `MONGODB_URI` | Atlas connection string, with your database user's password |
| `GH_TOKEN` | the GitHub token |
| `TARGET_OWNER` / `TARGET_REPO` | `matthow60` / `BuggyWebsite` |
| `LLM_MODE` | `llm` (Gemini writes the fixes; `mock` uses hand-written ones from `patcher/patches/`) |
| `LLM_API_KEY` and `LLM_FALLBACK_API_KEY` | your Gemini key (it can be the same key for both) |

Check the settings:

```powershell
npm run db:test     # can we reach Atlas?
npm run llm:test    # does the Gemini key work?
```

**Never commit `.env`.** It's git-ignored. Share keys with teammates privately.

**BuggyWebsite** has its own setup. In its `server/` folder, copy `.env.example` to `.env` and set
`CRASH_REPORT_MONGODB_URI` to the **same** Atlas string. It is deliberately not called `MONGODB_URI`;
see "Troubleshooting" below.

## Running it

You need **three terminals**, started **in this order**:

```powershell
# 1. ENGINE: start this first. It only picks up crashes that happen while it's running.
cd AutomatedFix\patcher
npm start
#    wait for:  watching incidents collection for new open incidents

# 2. DASHBOARD
cd AutomatedFix
npm run dev
#    open the URL it prints (3000, or 3001 if BuggyWebsite already uses 3000)

# 3. TARGET APP
cd BuggyWebsite\server
npm start
```

⚠️ **`npm start` in the `AutomatedFix` folder starts the dashboard, not the engine.** The engine's
`npm start` only works inside `patcher/`.

## Demo

1. Open BuggyWebsite and trigger one of its bugs:

   | Bug | In the UI |
   |---|---|
   | 1 | **Cart** page with an empty cart: type `MAVS10`, click **Apply** |
   | 2 | **Checkout** page: leave "Friends splitting with you" blank, click **Calculate split** |
   | 3 | **Shop** page, *Mavs Classic Tee*: pick **XXL**, click **Add to cart** |

2. Watch the **engine terminal**. A full run takes about 30–60 seconds:
   ```
   [incident-…] new open incident from change stream
   [incident-…] ✔ clone repo   ✔ install deps
   [incident-…]   before step 5: click [data-testid="promo-apply"] → ❌ 1× 5xx
   [llm] asking gemini-3.5-flash … for a patch to server/src/services/pricing.js
   [incident-…]   after step 5: click [data-testid="promo-apply"] → ✔
   [incident-…] ✔ commit + push fix/incident-…   ✔ open PR
   [incident-…] ✅ fixed in 41000ms → https://github.com/…/pull/…
   ```
3. Watch the **dashboard**. The incident moves through Crash Detected → Reproducing Steps → AI Patching → PR Ready.
4. Open the **PR** on GitHub. It contains the error, how it was reproduced, a before/after screenshot
   for each user step, and the diff.

### Engine endpoints

```powershell
curl.exe http://localhost:4000/health                           # is the engine up? which LLM mode?
curl.exe -X POST http://localhost:4000/incidents/<incidentId>/fix  # run an "open" incident by hand
curl.exe -X POST http://localhost:4000/demo/run/<incidentId>       # reset any incident to "open" and run it again
```

### Between demo runs

- Close the PR and delete its `fix/…` branch on GitHub.
- Clear the incidents: `npm run reset-demo` in `BuggyWebsite\server`. This also checks the bugs still crash.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Crash appears on the dashboard, but nothing else happens | The engine isn't running. Start it in `patcher/` and check `curl.exe http://localhost:4000/health`. |
| An incident from before the engine started stays "Crash Detected" | The engine only reacts automatically to **new** crashes. Run it by hand with `/incidents/<id>/fix`. |
| An incident is stuck on "Reproducing" or "AI Patching" for more than 3 minutes | The engine was stopped mid-run. Restart it and use `/demo/run/<id>` to reset and re-run that incident. |
| BuggyWebsite shows the 500, but no incident appears in Atlas | Its crash reporting is off. Check its startup log for `[capture] off (…)`. Usually `CRASH_REPORT_MONGODB_URI` is missing from `BuggyWebsite/server/.env`, or the local copy is out of date (`git pull`). |
| `bad auth : authentication failed` | Wrong Atlas database-user password in `MONGODB_URI`. Reset it under *Database Access*. |
| Atlas connection times out | Your IP isn't allowed under Atlas *Network Access*. |
| `[llm] … busy (HTTP 503)` / `falling back to …` | Gemini is overloaded. That's normal: it retries, then switches to the fallback model. |
| `LLM HTTP 404 … no longer available` | That Gemini model has been retired. List the current ones: `curl -H "Authorization: Bearer <key>" https://generativelanguage.googleapis.com/v1beta/openai/models` |
| `git push failed` / PR not created | `GH_TOKEN` needs Contents + Pull requests read/write on the target repo. |
| Status `not_reproducible` | Replaying the user's steps (and the failing request) didn't produce a 500, so the engine didn't patch blind. Check that the target app's buttons have `data-testid`s. |

**Why BuggyWebsite uses `CRASH_REPORT_MONGODB_URI`:** to prove a fix, the engine starts its own copy of
BuggyWebsite and makes it crash on purpose. If that copy also reported crashes, every replay would create
a new incident, and the engine would loop forever. The engine never passes `CRASH_REPORT_MONGODB_URI` to
its copy, so the replays stay silent.

## More detail

- **Engine internals, incident format, configuration:** [`patcher/README.md`](patcher/README.md)
- **Bugs, crash recorder, demo scripts:** BuggyWebsite's README
