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

const STEP_TIMEOUT_MS = 4000;
const SETTLE_MS = 2500;
export const MAX_STEPS = 15;

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

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
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
      try {
        if (action.type !== 'navigate') await ensureOnPage(page, baseUrl, action.url);
        await perform(page, baseUrl, action);
        await settle(page);
      } catch (err) {
        ok = false;
        error = String(err.message).split('\n')[0];
      }
      const screenshot = `${label}-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(outDir, screenshot) }).catch(() => {});
      steps.push({
        step: i + 1,
        type: action.type,
        target: action.target ?? null,
        value: action.value ?? null,
        ok,
        error,
        serverErrors: serverErrors.length - errorsBefore,
        screenshot,
      });
    }
  } finally {
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
