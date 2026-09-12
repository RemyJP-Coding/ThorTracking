import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron, expect } from '@playwright/test';

const execFileAsync = promisify(execFile);
const projectDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputRoot = path.join(projectDirectory, 'outputs', 'desktop-qa');
await mkdir(outputRoot, { recursive: true });
const outputDirectory = await mkdtemp(path.join(outputRoot, 'run-'));
const profileDirectory = path.join(outputDirectory, 'user-data');
// Leave the profile absent: first launch must create it without manual setup.
const executablePath = process.env.THOR_TRACK_EXECUTABLE || (await import('electron')).default;
if (process.env.THOR_TRACK_EXECUTABLE) assert.ok(path.isAbsolute(executablePath), 'THOR_TRACK_EXECUTABLE must be an absolute path');
const baseArgs = process.env.THOR_TRACK_EXECUTABLE ? [] : [projectDirectory];
const requireLive = process.env.THOR_TRACK_REQUIRE_LIVE === '1';
const launchEnvironment = { ...process.env, THOR_TRACK_USER_DATA_DIR: profileDirectory };
delete launchEnvironment.ELECTRON_RUN_AS_NODE;

const running = new Set();
const appProcesses = new WeakMap();
const secondaryProcesses = new Set();
const ownedProcesses = new Map();
const report = { executablePath, profileDirectory, requireLive, checks: [], feeds: [], processChecks: [] };
let diagnostics = '';

function record(message) {
  report.checks.push(message);
  console.info(`PASS ${message}`);
}

function bounded(promise, milliseconds, description) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${description}`)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

function waitForExit(child, milliseconds = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return bounded(new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  }), milliseconds, `process ${child.pid} to exit`);
}

async function windowsProcesses() {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate | ConvertTo-Json -Compress'],
  { windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function descendants(pid) {
  const processes = await windowsProcesses();
  const parents = new Set([pid]);
  let previousSize;
  do {
    previousSize = parents.size;
    for (const item of processes) if (parents.has(item.ParentProcessId)) parents.add(item.ProcessId);
  } while (parents.size !== previousSize);
  const children = processes.filter((item) => item.ProcessId !== pid && parents.has(item.ProcessId));
  for (const item of children) ownedProcesses.set(item.ProcessId, item);
  return children;
}

async function launch(dev = false) {
  const app = await _electron.launch({
    executablePath,
    args: [...baseArgs, ...(dev ? ['--dev'] : [])],
    cwd: projectDirectory, env: launchEnvironment, timeout: 45_000,
  });
  running.add(app);
  appProcesses.set(app, app.process());
  for (const stream of [app.process().stdout, app.process().stderr]) stream?.on('data', (chunk) => {
    diagnostics = `${diagnostics}${chunk}`.slice(-128_000);
  });
  const page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => { diagnostics += `\nRENDERER: ${error.stack ?? error.message}\n`; });
  await page.waitForURL('thor-track://app/', { timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Toggle color theme' })).toBeVisible();
  return { app, page };
}

async function refresh(page, phase) {
  const button = page.getByRole('button', { name: 'Refresh AYN shipment data' });
  await expect(page.locator('header [role="status"]')).not.toHaveText('Connecting to AYN…', { timeout: 30_000 });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  const [response] = await Promise.all([
    page.waitForResponse((item) => item.url() === 'thor-track://app/api/shipments' && item.request().method() === 'GET', { timeout: 30_000 }),
    button.click(),
  ]);
  assert.equal(response.status(), 200, `${phase}: shipment API must return usable data`);
  const feed = await response.json();
  assert.ok(['live', 'archived'].includes(feed.status), `${phase}: received ${feed.status}`);
  if (requireLive) {
    assert.equal(feed.status, 'live', `${phase}: an online refresh must fetch AYN; saved fallback does not pass (${feed.code ?? 'no code'})`);
    assert.ok(Number.isFinite(Date.parse(feed.sourceUpdatedAt)), `${phase}: AYN's update time must be present`);
  }
  assert.ok(feed.days.length > 0, `${phase}: shipment history is available`);
  assert.equal(feed.history.persisted, true, `${phase}: automatic local history database is ready`);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  report.feeds.push({ phase, status: feed.status, code: feed.code, sourceUpdatedAt: feed.sourceUpdatedAt,
    latestShipmentDate: feed.days.at(-1)?.date, days: feed.days.length, persisted: feed.history.persisted });
  record(`${phase}: ${feed.status === 'live' ? 'live AYN refresh' : 'saved-history fallback'} and automatic history storage`);
}

async function expectHiddenInTray(app, action) {
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return windows.length === 1 && !windows[0].isDestroyed() && !windows[0].isVisible();
  })).toBe(true);
  record(`${action} hides the window in the system tray and keeps the app running`);
}

async function restoreFromSecondLaunch(app) {
  const duplicate = spawn(executablePath, baseArgs, { cwd: projectDirectory, env: launchEnvironment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  secondaryProcesses.add(duplicate);
  for (const stream of [duplicate.stdout, duplicate.stderr]) stream.on('data', (chunk) => {
    diagnostics = `${diagnostics}\nSECOND LAUNCH: ${chunk}`.slice(-128_000);
  });
  await descendants(duplicate.pid);
  assert.equal((await waitForExit(duplicate)).code, 0, 'a second launch should hand off and exit');
  secondaryProcesses.delete(duplicate);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return windows.length === 1 && windows[0].isVisible() && !windows[0].isMinimized();
  }), { timeout: 10_000 }).toBe(true);
  record('A second launch restores the existing window from the system tray and exits');
}

async function exitApplication(app) {
  const child = appProcesses.get(app);
  const owned = await descendants(child.pid);
  if (process.platform === 'win32') assert.ok(owned.some((item) => /workerd/i.test(item.Name)), 'desktop owns a workerd child while running');
  // Playwright 1.63 has no public inspector-only disconnect API. Its app.close()
  // helper also calls app.quit(). Exercise the app's explicit Exit action instead,
  // and detach only the test's Node inspector.
  const inspector = app._connection.toImpl(app)._nodeConnection;
  assert.equal(typeof inspector?.close, 'function', 'Playwright Node inspector transport is available');
  let detached = false;
  const detachInspector = () => {
    if (detached) return;
    detached = true;
    inspector.close();
  };
  const exit = waitForExit(child);
  const closed = app.waitForEvent('close', { timeout: 15_000 });
  // Node can begin shutdown before acknowledging the evaluate call. Detach
  // independently too, so waiting for its reply cannot keep the debugger alive.
  const detachTimer = setTimeout(detachInspector, 500);
  let result;
  try {
    const page = app.windows().find((page) => page.url().startsWith('thor-track://app/'));
    [result] = await Promise.all([exit, closed,
      page.getByRole('button', { name: 'Exit Thor Track', exact: true }).click()
        .then(detachInspector).catch((error) => { if (!detached) throw error; })]);
  } finally { clearTimeout(detachTimer); }
  assert.equal(result.code, 0, 'Exit stops the app cleanly');
  running.delete(app);
  if (process.platform === 'win32') {
    // Chromium children can finish just after the parent exits. Allow that bounded
    // teardown to complete, while still failing if any owned process remains.
    await expect.poll(async () => {
      const remaining = await windowsProcesses();
      return owned.filter((before) => remaining.some((after) => after.ProcessId === before.ProcessId && after.CreationDate === before.CreationDate));
    }, { timeout: 5_000, message: 'Exit must stop all owned processes, including workerd' }).toEqual([]);
    report.processChecks.push({ parentPid: child.pid, stoppedChildren: owned.map(({ Name, ProcessId }) => ({ Name, ProcessId })) });
  }
  record('Explicit Exit stops the app and its runtime processes');
}

async function stopOwnedProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 }).catch(() => {});
  } else child.kill('SIGKILL');
  await waitForExit(child, 10_000).catch(() => {});
}

try {
  let { app, page } = await launch();
  const normalState = await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { title: window.getTitle(), menu: Menu.getApplicationMenu() === null,
      devToolsOpen: window.webContents.isDevToolsOpened() };
  });
  assert.deepEqual(normalState, { title: 'Thor Track', menu: true, devToolsOpen: false });
  report.normalWebPreferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.openDevTools());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()), false, 'developer tools are disabled in a normal launch');
  assert.deepEqual(await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, Buffer: typeof window.Buffer })),
    { require: 'undefined', process: 'undefined', Buffer: 'undefined' });
  record('Normal launch hides development UI and keeps Node APIs outside the renderer');
  await refresh(page, 'First launch');
  await page.getByLabel('AYN order number').fill('9999');
  await page.getByRole('combobox', { name: /^Color/ }).selectOption('Black');
  await page.getByRole('combobox', { name: /^Model/ }).selectOption('base');
  await page.getByRole('button', { name: 'Watch this order' }).click();
  await expect(page.getByRole('heading', { name: '9999xx · Black · Base', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Saved on this device: watching 9999xx' })).toBeVisible();
  const oldTheme = await page.locator('html').getAttribute('data-theme');
  const theme = oldTheme === 'dark' ? 'light' : 'dark';
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  record('Order 9999 Black Base and theme save through the visible controls');
  const bounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const area = screen.getDisplayMatching(window.getBounds()).workArea;
    window.unmaximize();
    window.setBounds({ x: area.x + 24, y: area.y + 24, width: Math.min(1040, area.width - 48), height: Math.min(760, area.height - 48) });
    return window.getNormalBounds();
  });
  await page.screenshot({ path: path.join(outputDirectory, 'desktop-default.png') });

  await page.getByRole('button', { name: 'Minimize to tray', exact: true }).click();
  await expectHiddenInTray(app, 'Minimize to tray');
  await restoreFromSecondLaunch(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await expectHiddenInTray(app, 'The native minimize button');
  await restoreFromSecondLaunch(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expectHiddenInTray(app, 'Close');
  await restoreFromSecondLaunch(app);
  await exitApplication(app);
  const savedBounds = JSON.parse(await readFile(path.join(profileDirectory, 'window.json'), 'utf8'));
  assert.deepEqual(savedBounds, { ...bounds, maximized: false });

  ({ app, page } = await launch());
  await expect(page.getByRole('heading', { name: '9999xx · Black · Base', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds()), bounds);
  await refresh(page, 'Reopened app');
  record('Saved order, theme, window bounds, and history survive a full restart');
  await page.screenshot({ path: path.join(outputDirectory, 'desktop-restored.png') });
  await exitApplication(app);

  ({ app, page } = await launch(true));
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened()), { timeout: 10_000 }).toBe(true);
  const developmentState = await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { title: window.getTitle(), devTools: window.webContents.isDevToolsOpened(),
      menus: Menu.getApplicationMenu()?.items.map((item) => item.label) };
  });
  assert.equal(developmentState.title, 'Thor Track — Development');
  assert.equal(developmentState.devTools, true);
  assert.ok(developmentState.menus.includes('Development'));
  record('--dev explicitly enables the development title, menu, and open developer tools');
  await page.screenshot({ path: path.join(outputDirectory, 'desktop-development.png') });
  await exitApplication(app);
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.stack ?? String(error);
  for (const app of running) {
    const page = app.windows().find((window) => !window.isClosed());
    if (page) await page.screenshot({ path: path.join(outputDirectory, 'desktop-failure.png'), timeout: 5_000 }).catch(() => {});
  }
  console.error(report.error);
  await writeFile(path.join(outputDirectory, 'process-output.log'), diagnostics);
  process.exitCode = 1;
} finally {
  for (const app of running) {
    const child = appProcesses.get(app);
    await descendants(child.pid).catch(() => {});
    await bounded(app.close(), 8_000, 'test cleanup').catch(() => {});
    await stopOwnedProcess(child);
  }
  for (const child of secondaryProcesses) await stopOwnedProcess(child);
  if (ownedProcesses.size) {
    // Playwright launches through cmd.exe on Windows; its shell can exit before a descendant.
    const remaining = await windowsProcesses().catch(() => []);
    for (const item of remaining) {
      const owned = ownedProcesses.get(item.ProcessId);
      if (owned && owned.CreationDate === item.CreationDate) {
        await execFileAsync('taskkill.exe', ['/PID', String(item.ProcessId), '/T', '/F'], { windowsHide: true, timeout: 10_000 }).catch(() => {});
      }
    }
  }
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outputDirectory, 'process-output.log'), diagnostics);
  console.info(`Desktop QA artifacts: ${outputDirectory}`);
}
