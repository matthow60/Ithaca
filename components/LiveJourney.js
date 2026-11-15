'use client';

// "Live Journey": watch the AutoFix engine work in real time.
// Connects to the engine's Server-Sent Events stream (patcher/src/live.js, GET /live) and shows:
//   - the replay browser as it retraces the user's steps (live frames, drawn cursor)
//   - the broken file + crashing line while Gemini writes the fix
//   - a scene card for the other phases, and the result (PR link) at the end
//   - a ticker of the engine's latest log lines
import { useEffect, useReducer } from 'react';
import styles from './LiveJourney.module.css';
import { CompassIcon, OwlIcon, ShipIcon, StormIcon, WaveIcon } from './Icons';

// Inlined at build time (NEXT_PUBLIC_*). The engine runs on the same machine by default.
const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:4000';
const TICKER_LINES = 4;

const SCENES = {
  idle: { Icon: CompassIcon, title: 'Calm seas', text: 'Waiting for the next crash to wash ashore.' },
  open: { Icon: StormIcon, title: 'Crash detected', text: 'A new incident has arrived. Readying the ship…' },
  reproducing: { Icon: CompassIcon, title: 'Charting the course', text: 'Cloning the repo and preparing to retrace the user’s steps…' },
  patching: { Icon: OwlIcon, title: 'Gemini is writing the fix', text: 'Reading the broken file and the user’s journey…' },
  verifying: { Icon: CompassIcon, title: 'Proving the fix', text: 'Replaying the same steps on the patched code…' },
  fixed: { Icon: ShipIcon, title: 'Pull request opened', text: 'The fix is verified and waiting for review.' },
  failed: { Icon: WaveIcon, title: 'Fix failed', text: 'The engine could not produce a working fix.' },
  not_reproducible: { Icon: WaveIcon, title: 'Could not reproduce', text: 'Replaying the user’s steps did not hit the crash.' },
};

const REPLAY_TAG = { before: 'Retracing the crash · original code', after: 'Proving the fix · patched code' };

const initial = { connection: 'connecting', run: null, pacing: false };

function reducer(state, { type, data }) {
  const run = state.run ?? {};
  switch (type) {
    case 'open':
      return { ...state, connection: 'live' };
    case 'offline':
      return { ...state, connection: 'offline' };
    case 'snapshot':
      return { ...state, connection: 'live', pacing: data.pacing, run: data.incidentId ? data : null };
    case 'run':
      return { ...state, run: { ...data, logs: [], step: null, focus: null, frame: null, result: null } };
    case 'status':
      return { ...state, run: { ...run, status: data.status } };
    case 'log':
      return { ...state, run: { ...run, logs: [...(run.logs ?? []).slice(-(TICKER_LINES * 3)), data] } };
    case 'step':
      return { ...state, run: { ...run, step: data } };
    case 'focus':
      return { ...state, run: { ...run, focus: data } };
    case 'frame':
      return { ...state, run: { ...run, frame: { label: data.label, data: data.data } } };
    case 'done':
      return { ...state, run: { ...run, result: data } };
    default:
      return state;
  }
}

function useEngineStream() {
  const [state, dispatch] = useReducer(reducer, initial);
  useEffect(() => {
    const source = new EventSource(`${ENGINE_URL}/live`);
    source.onopen = () => dispatch({ type: 'open' });
    source.onerror = () => dispatch({ type: 'offline' }); // EventSource retries by itself
    const types = ['snapshot', 'run', 'status', 'log', 'step', 'focus', 'frame', 'done'];
    const handlers = types.map((type) => {
      const handler = (e) => dispatch({ type, data: JSON.parse(e.data) });
      source.addEventListener(type, handler);
      return [type, handler];
    });
    return () => {
      handlers.forEach(([type, handler]) => source.removeEventListener(type, handler));
      source.close();
    };
  }, []);
  return state;
}

function describeStep(step) {
  const target = step.target ? ` ${step.target.replace(/^\[data-testid="(.+)"\]$/, '$1')}` : '';
  const value = step.value !== null && step.value !== undefined && step.value !== '' ? ` “${step.value}”` : '';
  return `Step ${step.step}/${step.total} · ${step.type}${target}${value}`;
}

function StepCaption({ step }) {
  if (!step) return null;
  let mark = '…';
  let bad = false;
  if (step.phase === 'end') {
    if (step.serverErrors) {
      mark = `❌ ${step.serverErrors}× 500`;
      bad = true;
    } else {
      mark = step.ok ? '✓' : `⚠ ${step.error ?? 'step failed'}`;
    }
  }
  return (
    <div className={`${styles.caption} ${bad ? styles.captionBad : ''}`}>
      <span className={styles.captionText}>{describeStep(step)}</span>
      <span className={styles.captionMark}>{mark}</span>
    </div>
  );
}

function CodeView({ focus }) {
  return (
    <div className={styles.code}>
      <div className={styles.codeFile}>
        {focus.file}
        {focus.line ? `:${focus.line}` : ''}
      </div>
      {focus.lines.map((text, i) => {
        const n = focus.from + i;
        return (
          <div key={n} className={`${styles.codeLine} ${n === focus.line ? styles.crashLine : ''}`}>
            <span className={styles.lineNo}>{n}</span>
            <span>{text || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

function Scene({ sceneKey, children }) {
  const { Icon, title, text } = SCENES[sceneKey] ?? SCENES.idle;
  return (
    <div className={styles.scene}>
      <span className={styles.sceneIcon}>
        <Icon size={56} />
      </span>
      <div className={styles.sceneTitle}>{title}</div>
      <div className={styles.sceneText}>{text}</div>
      {children}
    </div>
  );
}

function Screen({ run }) {
  if (!run) return <Scene sceneKey="idle" />;
  const { status, frame, step, focus, result } = run;
  const finished = ['fixed', 'failed', 'not_reproducible'].includes(status);

  // Replays: show the live browser once its frames arrive.
  const replayLabel = status === 'reproducing' ? 'before' : status === 'verifying' ? 'after' : null;
  if (replayLabel && frame?.label === replayLabel) {
    return (
      <>
        <img className={styles.frame} src={`data:image/jpeg;base64,${frame.data}`} alt="Engine replay browser" />
        <span className={styles.tag}>{REPLAY_TAG[replayLabel]}</span>
        {step?.label === replayLabel && <StepCaption step={step} />}
      </>
    );
  }

  // Patching: the file and crashing line the engine located, while Gemini works.
  if (status === 'patching' && focus) {
    return (
      <>
        <CodeView focus={focus} />
        <span className={styles.tag}>Gemini is writing the fix</span>
        <div className={styles.thinking}>
          <OwlIcon size={16} /> thinking<span className={styles.dots} />
        </div>
      </>
    );
  }

  return (
    <Scene sceneKey={finished || SCENES[status] ? status : 'idle'}>
      {status === 'fixed' && result?.prUrl && (
        <a className={styles.prLink} href={result.prUrl} target="_blank" rel="noreferrer">
          <ShipIcon size={16} /> View the pull request →
        </a>
      )}
    </Scene>
  );
}

export default function LiveJourney({ incident }) {
  const { connection, run, pacing } = useEngineStream();
  const watchingOther = run && incident && run.incidentId !== incident.incidentId;
  const ticker = (run?.logs ?? []).slice(-TICKER_LINES);

  return (
    <section className={`card ${styles.card}`}>
      <h2>
        <CompassIcon />
        Live Journey
        <span className={`${styles.pill} ${connection === 'live' ? styles.pillLive : styles.pillOff}`}>
          <span className={styles.pillDot} />
          {connection === 'live' ? 'Live' : connection === 'offline' ? 'Engine offline' : 'Connecting'}
        </span>
        {pacing && connection === 'live' && <span className="muted">demo pacing</span>}
      </h2>

      {watchingOther && <div className={styles.note}>Engine is working on #{run.incidentId}</div>}

      <div className={styles.screen}>
        {connection === 'offline' && !run ? (
          <div className={styles.scene}>
            <span className={styles.sceneIcon}>
              <WaveIcon size={56} />
            </span>
            <div className={styles.sceneTitle}>Engine offline</div>
            <div className={styles.sceneText}>
              Start it with <code>npm start</code> in <code>patcher/</code> ({ENGINE_URL}).
            </div>
          </div>
        ) : (
          <Screen run={run} />
        )}
      </div>

      <ul className={styles.ticker}>
        {ticker.length ? (
          ticker.map((l) => (
            <li key={`${l.t}-${l.text}`} className={l.level === 'error' ? styles.tickerError : undefined}>
              {l.text}
            </li>
          ))
        ) : (
          <li className={styles.tickerIdle}>No activity yet.</li>
        )}
      </ul>
    </section>
  );
}
