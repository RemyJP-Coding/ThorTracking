import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, expect } from '@playwright/test';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputRoot = path.join(root, 'outputs', 'desktop-notifications-qa');
await mkdir(outputRoot, { recursive: true });
const outputDirectory = await mkdtemp(path.join(outputRoot, 'run-'));
const profile = path.join(outputDirectory, 'user-data');
const env = { ...process.env, THOR_TRACK_USER_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.THOR_TRACK_EXECUTABLE || (await import('electron')).default;
const report = { executablePath, checks: [] };
let app;
let diagnostics = '';
const record = (message) => { report.checks.push(message); console.info(`PASS ${message}`); };

try {
  app = await _electron.launch({ executablePath, args: process.env.THOR_TRACK_EXECUTABLE ? [] : [root], cwd: root, env, timeout: 45_000 });
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', chunk => { diagnostics += chunk; });
  const page = await app.firstWindow();
  await page.waitForURL('thor-track://app/', { timeout: 45_000 });
  const refresh = page.getByRole('button', { name: 'Refresh AYN shipment data' });
  await expect(refresh).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole('complementary', { name: 'Desktop notifications' })).toBeVisible();

  // Fixtures replace only the native public-feed request in this isolated process.
  await app.evaluate(({ session, Notification }) => {
    globalThis.notificationQa = { requests: 0, notifications: [], shown: 0, failed: [],
      html: '<p>2026/09/10<br>AYN Thor Black Base: 9000xx--9010xx</p>', updatedAt: '2026-09-10T12:00:00Z', offline: false };
    session.defaultSession.fetch = async () => {
      const qa = globalThis.notificationQa;
      qa.requests += 1;
      if (qa.offline) throw new Error('Offline notification fixture');
      return Response.json({ page: { body_html: qa.html, updated_at: qa.updatedAt } });
    };
    const originalShow = Notification.prototype.show;
    Notification.prototype.show = function () {
      const qa = globalThis.notificationQa;
      qa.notifications.push({ title: this.title, body: this.body });
      qa.latest = this;
      this.once('show', () => { qa.shown += 1; });
      this.once('failed', (_event, error) => { qa.failed.push(error); });
      // Exercise one native Windows toast; later cases verify dispatch without extra banners.
      if (qa.notifications.length === 1) originalShow.call(this);
    };
  });
  await page.getByLabel('AYN order number').fill('9999');
  await page.getByRole('combobox', { name: /^Color/ }).selectOption('Black');
  await page.getByRole('combobox', { name: /^Model/ }).selectOption('base');
  await page.getByRole('button', { name: 'Watch this order' }).click();
  await expect(page.getByRole('heading', { name: '9999xx · Black · Base', exact: true })).toBeVisible();
  await expect.poll(async () => {
    try { return JSON.parse(await readFile(path.join(profile, 'notifications.json'), 'utf8')).baseline?.ranges?.some(range => range[0] === '2026-09-10'); }
    catch { return false; }
  }).toBe(true);
  assert.equal(await app.evaluate(() => globalThis.notificationQa.notifications.length), 0);
  record('Saving the watch creates a quiet baseline from a live check');

  await assert.rejects(page.evaluate(() => window.thorTrackDesktop.setWatch({ prefix: 123456, color: 'Black', model: 'base' })));
  assert.deepEqual(await page.evaluate(() => Object.keys(window.thorTrackDesktop).sort()), ['minimize', 'onRefreshRequested', 'quit', 'setWatch']);
  await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.src = '/';
    document.body.append(frame);
    await new Promise(resolve => { frame.onload = resolve; });
  });
  const iframe = page.frames().find(frame => frame !== page.mainFrame());
  // Sandboxed preload runs only for the top-level document by default.
  assert.equal(await iframe.evaluate(() => typeof window.thorTrackDesktop), 'undefined');
  await page.locator('iframe').evaluate(element => element.remove());
  record('Desktop bridge exposes only fixed actions and rejects malformed watches');

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
  await app.evaluate(({ powerMonitor }) => {
    const qa = globalThis.notificationQa;
    qa.html += '<p>2026/09/11<br>AYN Thor Black Base: 9011xx--9020xx</p>';
    qa.updatedAt = '2026-09-11T12:00:00Z';
    powerMonitor.emit('resume');
  });
  await expect.poll(() => app.evaluate(() => globalThis.notificationQa.notifications.length)).toBe(1);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  record('A background check detects the watched update while the window stays hidden in the system tray');
  await expect.poll(() => app.evaluate(() => globalThis.notificationQa.shown + globalThis.notificationQa.failed.length), { timeout: 15_000 }).toBeGreaterThan(0);
  report.nativeNotification = await app.evaluate(() => ({ shown: globalThis.notificationQa.shown, failed: globalThis.notificationQa.failed }));
  assert.equal(report.nativeNotification.shown, 1, `Native notification failed: ${report.nativeNotification.failed.join('; ')}`);
  record('Windows reports that the native notification was shown');
  const activatedRefresh = page.waitForResponse(response => response.url() === 'thor-track://app/api/shipments');
  await app.evaluate(() => globalThis.notificationQa.latest.emit('click'));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return window.isVisible() && !window.isMinimized();
  })).toBe(true);
  const activatedFeed = await (await activatedRefresh).json();
  assert.ok(activatedFeed.days.some(day => day.date === '2026-09-11' && day.entries.some(entry => entry.color === 'Black' && entry.model === 'base' && entry.endPrefix === 9020)));
  await expect(refresh).toBeEnabled();
  record('Notification activation restores the watched dashboard and refreshes its displayed data');

  const check = async () => {
    const before = await app.evaluate(() => globalThis.notificationQa.requests);
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
    await expect.poll(() => app.evaluate(() => globalThis.notificationQa.requests)).toBeGreaterThan(before);
    // The parser/storage request completes before the explicit duplicate refresh returns.
    await page.evaluate(async () => { const response = await fetch('/api/shipments'); await response.json(); });
  };
  await check();
  assert.equal(await app.evaluate(() => globalThis.notificationQa.notifications.length), 1);
  await app.evaluate(() => {
    const qa = globalThis.notificationQa;
    qa.html += '<p>2026/09/12<br>AYN Thor White Pro: 8000xx--8010xx</p>';
    qa.updatedAt = '2026-09-12T12:00:00Z';
  });
  await check();
  assert.equal(await app.evaluate(() => globalThis.notificationQa.notifications.length), 1);
  await app.evaluate(() => { globalThis.notificationQa.offline = true; });
  await check();
  assert.equal(await app.evaluate(() => globalThis.notificationQa.notifications.length), 1);
  record('Duplicate checks, other models, and offline fallback produce no additional alerts');
  await app.evaluate(() => {
    const qa = globalThis.notificationQa;
    qa.offline = false;
    qa.html = qa.html.replace('9011xx--9020xx', '9011xx--9021xx');
    qa.updatedAt = '2026-09-12T13:00:00Z';
  });
  await check();
  assert.equal(await app.evaluate(() => globalThis.notificationQa.notifications.length), 2);
  record('A correction to the watched range produces one notification');
  await page.screenshot({ path: path.join(outputDirectory, 'notifications.png') });
  report.notifications = await app.evaluate(() => globalThis.notificationQa.notifications);
  await app.evaluate(() => globalThis.notificationQa.latest.close());
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack ?? String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outputDirectory, 'process-output.log'), diagnostics);
  console.info(`Notification QA: ${outputDirectory}`);
}
