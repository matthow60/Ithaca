# ⛵ Ithaca

### Every crash finds its way home.

**Ithaca is an autonomous bug-fixing agent.** It retraces a crashed user's steps in a real browser, has
Gemini fix the bug, replays the journey to prove the fix works, and opens a verified GitHub pull request,
while you watch it happen live.

Built at **HackUTA** by **Matthew Howard**, **James Nguyen**, and **Hannah Bunnag**.

---

## What it does

Like Odysseus fighting his way home to Ithaca, every crash goes on a journey:

| Stage | What Ithaca does |
|---|---|
| ⛈️ **Crash detected** | A user hits a bug and the server throws an uncaught error (HTTP 500). A recorder in the app saves the **stack trace**, the **failing request**, and the user's **last 15 actions** (clicks, typing, page visits) to MongoDB. |
| 🧭 **Reproducing steps** | Ithaca's engine sees the crash instantly, clones the app's repo, boots it, and **replays the user's exact steps in a headless browser** until the same 500 happens. If it can't reproduce the bug, it doesn't patch blind. |
| 🦉 **AI patching** | It finds the broken file and line from the stack trace, and **Gemini** writes a fix using the code, the error, and the user's journey. |
| 🧭 **Proving the fix** | It replays the **same journey on the patched code**. No 500 means verified. Still broken? Gemini gets the new error and tries again (up to 3 attempts). |
| 🚢 **PR ready** | It pushes a branch and opens a **GitHub pull request** with the diff, how the bug was reproduced, and a **before/after screenshot of every user step**. |

**From crash to verified pull request in about a minute, with no human involved until review.**

### Watch it work: the Live Journey

The Odyssey-themed dashboard shows every incident (the user's journey, stack trace, Gemini's diff and a
plain-English Gemini summary) with a progress bar that moves through each stage.

Its **Live Journey** window streams the engine at work, live:
- the bot's browser retracing the user's steps, with a cursor gliding to each button and a `Step 5/15 · click Apply → ❌ 500` caption
- the crashing line glowing while *"Gemini is writing the fix"*
- the same steps replayed cleanly on the fixed code, then a *"Pull request opened"* card

Each incident has its own live channel. If a teammate's engine picked up the crash, the window shows
*"A Different Odyssey"* instead of someone else's stream.

### What makes it different

- **Proof, not promises.** Ithaca only opens a PR after replaying the user's real steps shows the crash
  is gone, and the PR includes the screenshots to show it.
- **It reproduces from user behavior**, not just a stack trace: the same clicks, the same inputs, the same request.
- **You can watch it think.** The whole voyage is visible in real time, not hidden in a log.

---

## How it works

```
 Target app (Mavs Merch Store)               MongoDB Atlas                 Ithaca (this repo)
 ─────────────────────────────               ─────────────                 ──────────────────
 user clicks around → server crashes
 crash recorder saves an incident  ───────►  incidents collection  ◄─────  patcher/  (the engine)
   stack trace, failing request,             { status: "open", … }           change stream → claim
   last 15 user actions                                                      → clone → replay (Playwright)
                                                                             → Gemini patch → replay again
                                                    ▲                        → branch + pull request
                                                    │                        → write status + PR link back
                                                    │                              │
                                         dashboard (Next.js, repo root)  ◄─────────┘
                                         reads incidents from MongoDB;    Live Journey stream
                                         Live Journey via Server-Sent     (GET /live?incident=<id>)
                                         Events from the engine
```

The three parts never call each other directly. They share one MongoDB collection, so each can be built,
restarted or scaled on its own. Incidents move `open → reproducing → patching → verifying → fixed`
(or `failed` / `not_reproducible`).

### Tech stack

| Part | Built with |
|---|---|
| Engine | Node.js, Express, MongoDB change streams, **Playwright** (headless Chromium), simple-git, Octokit (GitHub API) |
| AI | **Google Gemini** via its OpenAI-compatible API, with automatic retries and a fallback model |
| Dashboard | **Next.js** + React, Server-Sent Events, Chrome DevTools screencast for the live browser view |
| Database | **MongoDB Atlas** |
| Target app | Node/Express store with planted bugs and a crash recorder ([`matthow60/BuggyWebsite`](https://github.com/matthow60/BuggyWebsite)) |

---

## Running it

### Requirements

- **Node.js 20+** and **git**
- A **MongoDB Atlas** cluster (the free tier works). Your IP must be allowed under *Security → Network Access*.
- A **GitHub token** with access to the target repo: fine-grained with **Contents** and **Pull requests** set to read/write, or classic with the `repo` scope
- A **Gemini API key** from https://aistudio.google.com/apikey (the free tier works)
- The target app: [`matthow60/BuggyWebsite`](https://github.com/matthow60/BuggyWebsite)

### 1. Install (once)

```powershell
# Dashboard
cd AutomatedFix
npm install

# Engine (also downloads a headless Chromium, ~300 MB)
cd patcher
npm install
cd ..

# Settings shared by the engine and the dashboard
copy .env.example .env        # macOS/Linux: cp .env.example .env
```

Fill in `.env`:

| Setting | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string, including the database user's password |
| `GH_TOKEN` | your GitHub token |
| `TARGET_OWNER` / `TARGET_REPO` | `matthow60` / `BuggyWebsite` |
| `LLM_MODE` | `llm` (Gemini writes the fixes) |
| `LLM_API_KEY`, `LLM_FALLBACK_API_KEY` | your Gemini key (the same key works for both) |
| `DEMO_PACING` | `1` to slow the run down for an audience, `0` for full speed |

Check the connections:

```powershell
npm run db:test     # can we reach MongoDB Atlas?
npm run llm:test    # does the Gemini key work?
```

Set up the **target app** in a separate folder:

```powershell
git clone https://github.com/matthow60/BuggyWebsite.git
cd BuggyWebsite\server
npm ci
copy .env.example .env        # then set CRASH_REPORT_MONGODB_URI to the SAME Atlas string
```

`.env` files are git-ignored; never commit them.

### 2. Start (three terminals, in this order)

```powershell
# 1. ENGINE: start it first. It reacts to crashes that happen while it's running.
cd AutomatedFix\patcher
npm start
#    wait for: "watching incidents collection for new open incidents"

# 2. TARGET APP → http://localhost:3000
cd BuggyWebsite\server
npm start

# 3. DASHBOARD → open the URL it prints (http://localhost:3001 when the store is on 3000)
cd AutomatedFix
npm run dev
```

> ⚠️ `npm start` inside `AutomatedFix\` starts the **dashboard**, not the engine. The engine's
> `npm start` only works inside `patcher\`.

The Live Journey streams straight from the engine, so run the engine and the dashboard on the **same machine**.

### 3. Demo

1. In the store, trigger one of the planted bugs:

   | Bug | Steps |
   |---|---|
   | 1 | **Cart** page with an empty cart → type `MAVS10` → **Apply** |
   | 2 | **Checkout** page → leave "Friends splitting with you" blank → **Calculate split** |
   | 3 | **Shop** page → *Mavs Classic Tee* → pick **XXL** → **Add to cart** |

2. Watch the **dashboard**. The crash appears and moves through *Crash Detected → Reproducing Steps → AI Patching → PR Ready*, and the **Live Journey** window shows each step as it happens.
3. Open the **pull request** from the dashboard's *View GitHub PR* button.

A run takes about 1 minute at full speed, or 1.5–2 minutes with `DEMO_PACING=1`.

**Resetting between demos:** close the PR and delete its `fix/…` branch on GitHub, then run
`npm run reset-demo` in `BuggyWebsite\server`. It clears the incidents and checks the bugs still crash.

### Engine endpoints

```powershell
curl.exe http://localhost:4000/health                              # is the engine up?
curl.exe -X POST http://localhost:4000/incidents/<incidentId>/fix  # run an "open" incident by hand
curl.exe -X POST http://localhost:4000/demo/run/<incidentId>       # reset any incident and run it again
```

---

## Repo layout

```
AutomatedFix/
├── .env.example            settings template shared by the engine and the dashboard
├── app/ components/ lib/   dashboard (Next.js)
│   └── components/LiveJourney.js   the live window
├── scripts/                connection checks (npm run db:test / llm:test)
└── patcher/                the engine; internals in patcher/README.md
    └── src/
        ├── pipeline.js     the whole voyage: claim → reproduce → patch → prove → PR
        ├── replay.js       replays the user's steps in headless Chromium
        ├── llm.js          Gemini patching, retries and fallback
        ├── live.js         per-incident live stream for the dashboard
        └── github.js       branch, commits and pull request
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The crash shows on the dashboard but nothing happens | The engine isn't running. Start it in `patcher\` and check `curl.exe http://localhost:4000/health`. |
| A crash from before the engine started stays on "Crash Detected" | The engine only reacts automatically to **new** crashes. Run it by hand: `/incidents/<id>/fix`. |
| Stuck on one stage for more than 3 minutes | The engine was stopped mid-run. Restart it, then `/demo/run/<id>`. |
| The store shows the 500 but no incident appears | The store's crash reporting is off. Check `CRASH_REPORT_MONGODB_URI` in `BuggyWebsite\server\.env`. |
| Live Journey says "Engine offline" | Start the engine, on the same machine as the dashboard. |
| Live Journey says "A Different Odyssey" | Another person's engine claimed that crash. Only the machine running that engine can watch it live. |
| `bad auth : authentication failed` | Wrong Atlas database-user password in `MONGODB_URI`. |
| MongoDB connection times out | Your IP isn't allowed under Atlas *Network Access*. |
| `busy (HTTP 503)` / `falling back to …` | Gemini is overloaded. Ithaca retries, then switches to the fallback model on its own. |
| `LLM HTTP 404 … no longer available` | That Gemini model was retired. Pick a current one for `LLM_MODEL`. |
| No pull request is created | `GH_TOKEN` needs read/write access to Contents and Pull requests on the target repo. |
| Status `not_reproducible` | Replaying the user's steps didn't hit a 500, so Ithaca didn't patch blind. |

**Why the store uses `CRASH_REPORT_MONGODB_URI`:** to prove a fix, the engine runs its own copy of the
store and crashes it on purpose. If that copy also reported crashes, every replay would create a new
incident for the engine to fix, forever. The engine never passes `CRASH_REPORT_MONGODB_URI` to its copy,
so replays stay silent.

## More detail

- **Engine internals, incident format, configuration:** [`patcher/README.md`](patcher/README.md)
- **The planted bugs, crash recorder and demo scripts:** the BuggyWebsite README
