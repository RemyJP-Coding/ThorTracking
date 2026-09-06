// Optional browser acceptance suite. Use an installed Playwright, or set
// THOR_PLAYWRIGHT_MODULE to its index.mjs. Start the local app before running.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.THOR_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.THOR_PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.env.THOR_QA_URL ?? 'http://localhost:3001';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const row = (date, endPrefix, startPrefix = endPrefix - 20, color = 'Black', model = 'base') => ({ date, entries: [{ color, model, sourceVariant: `${color} ${model}`, startPrefix, endPrefix }] });
const initialDays = [row('2026-08-16', 2000), row('2026-08-23', 2040), row('2026-08-30', 2080), row('2026-09-06', 2120)];
let days = initialDays;
let mode = 'live';
let checks = 0;
let lastSuccess = '2026-09-06T19:00:00.000Z';
let held = null;
let holdNext = false;
await context.route('**/api/shipments', async (route) => {
  checks++;
  const checkedAt = new Date(Date.parse('2026-09-06T19:00:00Z') + checks * 1000).toISOString();
  if (mode === 'error') return route.fulfill({ status: 503, body: 'Fixture offline' });
  if (mode === 'live') lastSuccess = checkedAt;
  const body = JSON.stringify({ status: mode, days, checkedAt, archivedAt: lastSuccess, sourceUpdatedAt: null, history: { persisted: true } });
  if (holdNext) { holdNext = false; held = () => route.fulfill({ contentType: 'application/json', body }); return; }
  await route.fulfill({ contentType: 'application/json', body });
});
const refresh = () => page.getByRole('button', { name: 'Refresh AYN shipment data' });
const settled = async () => { await page.waitForFunction(() => document.querySelector('header [role="status"]')?.textContent !== 'Connecting to AYN…' && document.querySelector('button[aria-label="Refresh AYN shipment data"]')?.getAttribute('aria-busy') === 'false'); };
const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('thor-track.experience.v1')));
const summary = () => page.locator('.visit-summary');
const refreshNow = async () => { const old = checks; await refresh().click(); await page.waitForFunction(() => document.querySelector('button[aria-label="Refresh AYN shipment data"]')?.getAttribute('aria-busy') === 'false'); assert.ok(checks > old); };
const expectText = async (locator, pattern) => assert.match(await locator.innerText(), pattern);
const hidden = async (state) => page.evaluate((value) => { Object.defineProperty(document, 'visibilityState', { configurable: true, value }); document.dispatchEvent(new Event('visibilitychange')); }, state);
fs.mkdirSync('outputs/personal-dashboard-qa', { recursive: true });

try {
  await page.clock.setFixedTime(new Date('2026-09-06T12:00:00-07:00'));
  await page.goto(url);
  await settled();
  await page.getByLabel('AYN order number').fill('216012');
  await page.getByRole('button', { name: 'Watch this order' }).click();
  await page.waitForSelector('#personal-title');
  await settled();
  await page.waitForSelector('.forecast-history li');
  await expectText(page.locator('#personal-title'), /2160xx.*Black.*Base/s);
  assert.equal(await page.getByLabel('AYN order number').count(), 0);
  assert.equal((await history()).initialEndpoint, 2120);
  await expectText(summary(), /Comparisons begin with your next visit/);
  const first = await history();
  await refreshNow();
  assert.equal((await history()).history.length, first.history.length);
  console.log('PASS first use, saved-first view and unchanged refresh deduplication');

  await page.reload(); await settled();
  await expectText(summary(), /No changes since your last visit/);
  days = [...initialDays, row('2026-09-07', 2130), row('2026-09-07', 3100, 3080, 'White', 'max-1tb')];
  await refreshNow();
  await expectText(summary(), /Newly published dates.*2130xx/s);
  assert.equal(await summary().locator('details').getAttribute('open'), null);
  days = [...days, row('2026-09-08', 2140)];
  await refreshNow();
  await expectText(summary(), /Sep 7, 2026.*Sep 8, 2026/s);
  await refreshNow();
  await expectText(summary(), /Sep 7, 2026.*Sep 8, 2026/s);
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/desktop-light.png', fullPage: false });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/desktop-dark.png', fullPage: false });
  await page.reload(); await settled();
  await expectText(summary(), /No changes since your last visit/);
  console.log('PASS visit comparisons persist through refresh; next reload resets baseline; themes');

  await page.getByRole('button', { name: 'Edit order', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByLabel('AYN order number').evaluate((element) => document.activeElement === element), true);
  await page.getByLabel('AYN order number').fill('9999');
  await page.keyboard.press('Escape');
  assert.equal((await history()).watch.prefix, 2160);
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  const beforeSave = await history();
  await page.getByRole('button', { name: /^Save/ }).click();
  assert.equal((await history()).startedAt, beforeSave.startedAt);
  assert.equal((await history()).history.length, beforeSave.history.length);
  await page.getByRole('button', { name: 'Edit order', exact: true }).click();
  await page.getByLabel('AYN order number').fill('8888');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await history()).watch.prefix, 2160);
  console.log('PASS keyboard Edit, Save same watch, Escape and Cancel');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok((await page.locator('#personal-title').boundingBox()).y < 450);
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/mobile-dark.png', fullPage: false });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/mobile-light.png', fullPage: false });
  await page.locator('#history-title').scrollIntoViewIfNeeded();
  assert.ok((await refresh().boundingBox()).y < 100);
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('PASS 375px and 320px mobile layouts and sticky header controls');

  mode = 'archived'; await refreshNow();
  await expectText(summary(), /Unable to check for new changes/);
  await expectText(page.locator('.personal-status'), /saved archive/);
  mode = 'error'; await refreshNow();
  await expectText(summary(), /Unable to check for new changes/);
  await expectText(page.locator('.personal-status'), /device’s saved history/);
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/mobile-offline.png', fullPage: true });
  mode = 'live'; await refreshNow();
  console.log('PASS archived and offline states keep the watch and distinguish failed checks');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await hidden('hidden');
  const lastVisible = await history();
  days = [...days, row('2026-09-09', 2150)];
  await refreshNow();
  assert.deepEqual(await history(), lastVisible);
  await page.clock.setFixedTime(new Date('2026-09-06T12:31:00-07:00'));
  await hidden('visible');
  await settled();
  await expectText(summary(), /Sep 9, 2026/);
  assert.doesNotMatch(await summary().innerText(), /Sep 7, 2026/);
  console.log('PASS hidden updates stay unseen and returning after 30 minutes creates a visit');

  days = [...initialDays.slice(0, -1), row('2026-09-06', 2090)];
  await refreshNow();
  await expectText(page.locator('.revision-note').first(), /lowered from 2150xx to 2090xx/);
  await expectText(summary(), /Historical archive changes/);
  await expectText(summary(), /not forward progress/);
  console.log('PASS downward correction and historical change copy');

  // Cross-tab change while a response for the old watch is pending.
  holdNext = true;
  await refresh().click();
  for (let tries = 0; !held && tries < 50; tries++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(held);
  const other = await context.newPage();
  await other.goto(url); await other.waitForSelector('#personal-title');
  await other.evaluate(() => localStorage.setItem('thor-track.watch.v1', JSON.stringify({ prefix: 3000, color: 'White', model: 'max-512' })));
  await held().catch(() => {}); held = null;
  await page.waitForFunction(() => document.querySelector('#personal-title')?.textContent.includes('3000xx'));
  await settled();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('thor-track.experience.v1'))?.watch.prefix === 3000);
  assert.equal((await history()).initialEndpoint, null);
  assert.equal((await history()).history.at(-1).assessment.reason, 'no-configuration');
  await other.close();
  console.log('PASS cross-tab watch changes and stale responses');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForSelector('input[placeholder="#251612"]');
  await page.waitForFunction(() => localStorage.getItem('thor-track.experience.v1') === null);
  assert.equal(await page.evaluate(() => localStorage.getItem('thor-track.watch.v1')), null);
  console.log('PASS Clear removes watch and companion');

  for (const blocked of ['all', 'writes']) {
    const limited = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Los_Angeles' });
    const limitedPage = await limited.newPage();
    await limited.addInitScript((mode) => {
      if (mode === 'all') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
      else Storage.prototype.setItem = () => { throw new DOMException('Quota', 'QuotaExceededError'); };
    }, blocked);
    await limited.route('**/api/shipments', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'live', days: initialDays, checkedAt: '2026-09-06T19:00:00Z' }) }));
    await limitedPage.goto(url);
    await limitedPage.waitForFunction(() => document.querySelector('header [role="status"]')?.textContent.includes('Live AYN data checked'));
    await limitedPage.getByLabel('AYN order number').fill('2160');
    await limitedPage.getByRole('button', { name: 'Watch this order' }).click();
    await limitedPage.waitForSelector('#personal-title');
    await limitedPage.waitForSelector('.forecast-history li');
    await expectText(limitedPage.locator('.personal-dashboard'), /kept for this tab only/);
    await limited.close();
  }
  console.log('PASS blocked storage and failed writes preserve session-only watch/history');

  const calendarContext = await browser.newContext({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Los_Angeles' });
  const calendarPage = await calendarContext.newPage();
  calendarPage.on('pageerror', (error) => errors.push(error.message));
  await calendarPage.clock.install({ time: new Date('2026-09-06T23:59:30-07:00') });
  await calendarContext.addInitScript(() => localStorage.setItem('thor-track.watch.v1', JSON.stringify({ prefix: 2160, color: 'Black', model: 'base' })));
  await calendarContext.route('**/api/shipments', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'live', days: initialDays, checkedAt: '2026-09-06T19:00:00Z' }) }));
  await calendarPage.goto(url);
  await calendarPage.waitForSelector('.forecast-history li');
  const beforeMidnight = await calendarPage.evaluate(() => JSON.parse(localStorage.getItem('thor-track.experience.v1')));
  await calendarPage.clock.fastForward(31_000);
  await calendarPage.waitForFunction(() => JSON.parse(localStorage.getItem('thor-track.experience.v1')).history.length > 1);
  const midnight = await calendarPage.evaluate(() => JSON.parse(localStorage.getItem('thor-track.experience.v1')));
  assert.equal(midnight.history.at(-1).calendarDate, '2026-09-07');
  assert.match(midnight.history.at(-1).changes.join(' '), /1 day later.*unchanged shipment evidence/);
  assert.equal(midnight.initialEndpoint, beforeMidnight.initialEndpoint);
  for (let index = 0; index < 6; index++) {
    await calendarPage.clock.fastForward(86400000);
    await calendarPage.waitForFunction((count) => JSON.parse(localStorage.getItem('thor-track.experience.v1')).history.length >= count, index + 3);
  }
  assert.equal(await calendarPage.locator('.forecast-history li').count(), 5);
  await calendarPage.getByRole('button', { name: /^Show history/ }).click();
  assert.equal(await calendarPage.locator('.forecast-history li').count(), 8);
  await calendarPage.getByText('How this estimate is calculated', { exact: true }).click();
  await expectText(calendarPage.locator('.evidence-list'), /Training span.*Last advance/s);
  await calendarPage.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await calendarPage.screenshot({ path: 'outputs/personal-dashboard-qa/mobile-200-percent.png', fullPage: true });
  const overflow = await calendarPage.evaluate(() => [...document.querySelectorAll('body *')].filter((element) => {
    const rect = element.getBoundingClientRect(); return rect.width && rect.right > innerWidth + 1;
  }).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, text: element.textContent.slice(0, 60) })).sort((a, b) => b.right - a.right).slice(0, 20));
  assert.ok(await calendarPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow));
  await calendarContext.close();
  console.log('PASS local midnight reassessment, five-entry history preview, expansion, explanations and 200% text');

  const fallbackContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await fallbackContext.addInitScript(() => {
    localStorage.setItem('thor-track.watch.v1', JSON.stringify({ prefix: 2160, color: 'Black', model: 'base' }));
    localStorage.setItem('thor-track.experience.v1', '{malformed');
  });
  await fallbackContext.route('**/api/shipments', (route) => route.fulfill({ status: 503, body: 'Fixture offline' }));
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.goto(url);
  await fallbackPage.waitForFunction(() => document.querySelector('header [role="status"]')?.textContent.includes('bundled reference'));
  const fallbackRecord = await fallbackPage.evaluate(() => JSON.parse(localStorage.getItem('thor-track.experience.v1')));
  assert.equal(fallbackRecord.watch.prefix, 2160);
  assert.equal(fallbackRecord.initialEndpoint, null);
  assert.equal(fallbackRecord.latest, null);
  assert.equal(fallbackRecord.history.length, 0);
  await fallbackContext.close();
  console.log('PASS malformed companion preserves watch and bundled fallback never becomes personal history');
  assert.deepEqual(errors, []);
  console.log('PASS no browser runtime errors');
} catch (error) {
  await page.screenshot({ path: 'outputs/personal-dashboard-qa/failure.png', fullPage: true }).catch(() => {});
  console.error('Page errors:', errors);
  throw error;
} finally { await browser.close(); }
