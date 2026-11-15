// Replay the user's recorded steps in a real (headless) browser, screenshotting each step
// and watching the network for 5xx responses.
//
// Action format (from the incident's `actions` array):
//   { t, type, target, value, url }
//   type:   navigate | click | dblclick | input | type | fill | change | select |
//           check | uncheck | submit | keypress | press | scroll
//   target: a CSS selector (data-testid selectors replay best), or a URL for navigate
//   url:    the page the action happened on — recorded on another host/port is fine,
//           only path + query are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import * as live from './live.js';

const STEP_TIMEOUT_MS = 4000;
const SETTLE_MS = 2500;
export const MAX_STEPS = 15;

// Headless Chrome has no visible mouse. For the live view we draw one: a cursor that glides to
// each element before it's used, plus a highlight ring around that element. It's injected into
// every page the replay visits, and only when someone is watching or DEMO_PACING is on.
const CURSOR_SCRIPT = () => {
  const KEY = '__autofix_xy';
  const ensure = () => {
    let cursor = document.getElementById('__autofix_cursor');
    if (cursor) return cursor;
    const ring = document.createElement('div');
    ring.id = '__autofix_ring';
    Object.assign(ring.style, {
      position: 'fixed', zIndex: 2147483646, pointerEvents: 'none', display: 'none',
      border: '3px solid #2fc2b4', borderRadius: '6px', boxShadow: '0 0 0 5px rgba(47,194,180,.28)',
      transition: 'all .35s ease',
    });
    cursor = document.createElement('div');
    cursor.id = '__autofix_cursor';
    cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.6L21 11z" fill="#ffbe58" stroke="#120f10" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    let xy = [24, 24];
    try { xy = JSON.parse(sessionStorage.getItem(KEY)) || xy; } catch {}
    Object.assign(cursor.style, {
      position: 'fixed', left: `${xy[0]}px`, top: `${xy[1]}px`, zIndex: 2147483647, pointerEvents: 'none',
      transition: 'left .55s cubic-bezier(.3,.7,.3,1), top .55s cubic-bezier(.3,.7,.3,1)',
      filter: 'drop-shadow(2px 3px 0 rgba(0,0,0,.45))',
    });
    document.documentElement.append(ring, cursor);
    return cursor;
  };
  window.__autofixPoint = (x, y, box) => {
    const cursor = ensure();
    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;
    try { sessionStorage.setItem(KEY, JSON.stringify([x, y])); } catch {}
    const ring = document.getElementById('__autofix_ring');
    if (box) {
      Object.assign(ring.style, {
        display: 'block', left: `${box.x - 6}px`, top: `${box.y - 6}px`,
        width: `${box.width + 12}px`, height: `${box.height + 12}px`,
      });
    } else {
      ring.style.display = 'none';
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  else ensure();
};

/** Stream the page to the live view as JPEG frames (Chrome DevTools screencast). */
async function startScreencast(context, page, label) {
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
    live.frame(label, data);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });
  return async () => {
    await cdp.send('Page.stopScreencast').catch(() => {});
    await cdp.detach().catch(() => {});
  };
}

/** Glide the drawn cursor onto the element an action is about to use. */
async function pointAt(page, target) {
  if (!target) return;
  const el = page.locator(target).first();
  await el.scrollIntoViewIfNeeded({ timeout: STEP_TIMEOUT_MS }).catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  if (!box) return;
  await page
    .evaluate(([x, y, b]) => window.__autofixPoint?.(x, y, b), [box.x + box.width / 2, box.y + box.height / 2, box])
    .catch(() => {});
}

/**
 * @returns {Promise<{
 *   crashed: boolean,
 *   steps: Array<{ step, type, target, value, ok, error, serverErrors, screenshot }>,
 *   serverErrors: Array<{ step, status, method, url }>,
 *   pageErrors: Array<{ step, message }>
 * }>}
 */
export async function replayActions({ baseUrl, actions, outDir, label }) {
  const list = (actions || []).slice(-MAX_STEPS);
  await fs.mkdir(outDir, { recursive: true });
  for (const f of await fs.readdir(outDir)) {
    if (f.startsWith(`${label}-`)) await fs.rm(path.join(outDir, f), { force: true });
  }

  const browser = await chromium.launch();
  const steps = [];
  const serverErrors = [];
  const pageErrors = [];
  let current = 0;
  let stopScreencast = null;
  const cursor = live.showCursor();

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (cursor) await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    if (live.hasViewers()) stopScreencast = await startScreencast(context, page, label).catch(() => null);
    page.on('response', (res) => {
      if (res.status() >= 500) {
        serverErrors.push({ step: current, status: res.status(), method: res.request().method(), url: pathOf(res.url()) });
      }
    });
    page.on('pageerror', (err) => pageErrors.push({ step: current, message: err.message }));

    // Make sure we start on a page even if the recording doesn't begin with navigate.
    if (list[0]?.type !== 'navigate') {
      await page.goto(localize(baseUrl, list[0]?.url) || `${baseUrl}/`).catch(() => {});
    }

    for (let i = 0; i < list.length; i++) {
      current = i + 1;
      const action = list[i];
      const errorsBefore = serverErrors.length;
      let ok = true;
      let error = null;
      const stepInfo = { label, step: i + 1, total: list.length, type: action.type, target: action.target ?? null, value: action.value ?? null };
      live.step({ ...stepInfo, phase: 'start' });
      try {
        if (action.type !== 'navigate') await ensureOnPage(page, baseUrl, action.url);
        if (cursor && action.type !== 'navigate') {
          await pointAt(page, action.target);
          await live.pace(live.PACE.actionMs); // let viewers see where the bot is about to click
        }
        await perform(page, baseUrl, action);
        await settle(page);
      } catch (err) {
        ok = false;
        error = String(err.message).split('\n')[0];
      }
      const screenshot = `${label}-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, screenshot) }).catch(() => {});
      const result = {
        step: i + 1,
        type: action.type,
        target: action.target ?? null,
        value: action.value ?? null,
        ok,
        error,
        serverErrors: serverErrors.length - errorsBefore,
        screenshot,
      };
      steps.push(result);
      live.step({ ...stepInfo, phase: 'end', ok, error, serverErrors: result.serverErrors });
      await live.pace(live.PACE.actionMs / 2);
    }
  } finally {
    if (stopScreencast) await stopScreencast();
    await browser.close();
  }

  return { crashed: serverErrors.length > 0, steps, serverErrors, pageErrors };
}

async function perform(page, baseUrl, a) {
  const type = String(a.type || '').toLowerCase();
  switch (type) {
    case 'navigate':
    case 'goto':
    case 'load': {
      const url = localize(baseUrl, a.url || a.target);
      if (!url) throw new Error('navigate step has no url');
      await page.goto(url);
      return;
    }
    case 'click':
      return page.click(a.target);
    case 'dblclick':
      return page.dblclick(a.target);
    case 'input':
    case 'type':
    case 'fill':
    case 'change': {
      const tag = await page.locator(a.target).first().evaluate((el) => `${el.tagName}:${el.type || ''}`);
      if (tag.startsWith('SELECT')) return page.selectOption(a.target, String(a.value ?? ''));
      if (/:(checkbox|radio)$/.test(tag)) return page.setChecked(a.target, Boolean(a.value) && a.value !== 'false');
      return page.fill(a.target, String(a.value ?? ''));
    }
    case 'select':
      return page.selectOption(a.target, String(a.value ?? ''));
    case 'check':
      return page.check(a.target);
    case 'uncheck':
      return page.uncheck(a.target);
    case 'submit':
      return page.locator(a.target || 'form').first().evaluate((el) => {
        const form = el.tagName === 'FORM' ? el : el.closest('form');
        if (!form) throw new Error('submit target is not inside a form');
        form.requestSubmit ? form.requestSubmit() : form.submit();
      });
    case 'keypress':
    case 'keydown':
    case 'press':
      return page.press(a.target || 'body', String(a.value || 'Enter'));
    case 'scroll':
      return page.mouse.wheel(0, Number(a.value) || 500);
    default:
      throw new Error(`Unsupported action type "${a.type}"`);
  }
}

/** If the recorded action happened on a different page than we're on, go there first. */
async function ensureOnPage(page, baseUrl, recordedUrl) {
  const want = localize(baseUrl, recordedUrl);
  if (!want) return;
  const here = new URL(page.url() === 'about:blank' ? baseUrl : page.url());
  const there = new URL(want);
  if (here.pathname !== there.pathname || here.search !== there.search) await page.goto(want);
}

/** Wait for the page to quiet down so fetches triggered by the step complete. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
  await page.waitForTimeout(150);
}

/** Map a URL recorded on the user's machine onto the local test server. */
function localize(baseUrl, url) {
  if (!url) return null;
  try {
    const u = new URL(url, baseUrl);
    return `${baseUrl}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
