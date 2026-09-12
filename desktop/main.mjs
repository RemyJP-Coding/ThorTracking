import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, powerMonitor, protocol, screen, session, shell, Tray } from 'electron';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_URL, isAppUrl, isDevelopmentLaunch, isExternalUrl, restoreWindowState } from './policy.mjs';
import { createShipmentMonitor } from './monitor.mjs';

const dev = isDevelopmentLaunch(process.argv);

let mainWindow;
let runtime;
let monitor;
let tray;
const notifications = new Set();
let quitting = false;
let handlingFailure = false;
const dataDirectory = app.getPath('userData');
const stateFile = path.join(dataDirectory, 'window.json');
const logFile = path.join(dataDirectory, 'desktop.log');

function logError(error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    mkdirSync(dataDirectory, { recursive: true });
    // Bound diagnostics across repeated launches.
    let previous = '';
    try { previous = readFileSync(logFile, 'utf8').slice(-64_000); } catch { /* First launch. */ }
    writeFileSync(logFile, previous);
    appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch { /* A diagnostics failure must not prevent closing the app. */ }
  if (dev) console.error(message);
}

async function showFailure(error) {
  logError(error);
  if (quitting || handlingFailure) return;
  handlingFailure = true;
  const options = {
    type: 'error',
    title: 'Thor Track',
    message: 'Thor Track could not open.',
    detail: dev ? `${error instanceof Error ? error.stack ?? error.message : String(error)}\n\nDetails: ${logFile}` : 'Please try opening the app again. Your saved order and history will be kept.',
    buttons: ['Try again', 'Close'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  if (response === 0) app.relaunch();
  app.quit();
}

function openExternal(url) {
  if (isExternalUrl(url)) void shell.openExternal(url).catch(logError);
}

function restoreWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function minimizeToTray() {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(true);
  mainWindow.hide();
}

function notifyUpdate(options) {
  if (quitting || !Notification.isSupported()) return;
  const notification = new Notification({ ...options, icon: path.join(app.getAppPath(), 'desktop', 'icon.png') });
  notifications.add(notification);
  notification.on('click', () => {
    restoreWindow();
    // A resume check may have found changes before the window's own check is stale.
    mainWindow?.webContents.send('thor-track:refresh');
  });
  notification.on('failed', (_event, error) => { notifications.delete(notification); logError(new Error(`Notification: ${error}`)); });
  // Keep the object alive while its toast can be activated from notification history.
  if (notifications.size > 50) notifications.delete(notifications.values().next().value);
  notification.show();
}

function configureDesktopActions() {
  const ownFrame = (event) => event.sender === mainWindow?.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame && isAppUrl(event.senderFrame?.url);
  for (const [channel, action] of [
    ['thor-track:set-watch', (watch) => monitor.setWatch(watch)],
    ['thor-track:minimize', minimizeToTray],
    ['thor-track:quit', () => { setImmediate(() => app.quit()); }],
  ]) {
    ipcMain.handle(channel, (event, value) => {
      if (!ownFrame(event)) throw new Error('This action is only available in Thor Track.');
      return action(value);
    });
  }
  tray = new Tray(path.join(app.getAppPath(), 'desktop', 'icon.ico'));
  tray.setToolTip('Thor Track — shipment updates');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Thor Track', click: restoreWindow },
    { type: 'separator' },
    { label: 'Exit Thor Track', click: () => app.quit() },
  ]));
  tray.on('click', restoreWindow);
  tray.on('double-click', restoreWindow);
  powerMonitor.on('resume', () => { void monitor?.checkInBackground(); });
}

function createWindow() {
  let saved;
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* Use the default window. */ }
  mainWindow = new BrowserWindow({
    ...restoreWindowState(saved, screen.getAllDisplays().map((display) => display.workArea)),
    minWidth: 640,
    minHeight: 480,
    title: dev ? 'Thor Track — Development' : 'Thor Track',
    icon: path.join(app.getAppPath(), 'desktop', 'icon.png'),
    backgroundColor: '#f5f3ef',
    autoHideMenuBar: !dev,
    webPreferences: { preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: dev, spellcheck: false },
  });
  if (saved?.maximized) mainWindow.maximize();
  mainWindow.on('page-title-updated', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void showFailure(new Error(`The application window stopped: ${details.reason}`));
  });
  // Also handle the native title-bar Minimize button and Win+Down.
  mainWindow.on('minimize', minimizeToTray);
  mainWindow.on('close', (event) => {
    try {
      mkdirSync(dataDirectory, { recursive: true });
      writeFileSync(stateFile, JSON.stringify({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }));
    } catch (error) { logError(error); }
    if (!quitting && !handlingFailure) {
      event.preventDefault();
      minimizeToTray();
    }
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  return mainWindow.loadFile(path.join(app.getAppPath(), 'desktop', 'opening.html'));
}

function configureMenu() {
  if (!dev) {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'App', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Development', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' },
      { label: 'Runtime details', click: () => { void dialog.showMessageBox(mainWindow, {
        title: 'Thor Track — Development', message: 'Desktop runtime',
        detail: `App: ${APP_URL}\nRuntime: ${runtime?.url ?? 'Starting'}\nData: ${dataDirectory}\nDiagnostics: ${logFile}`,
      }); } },
      { label: 'Open app data', click: () => { void shell.openPath(dataDirectory); } },
    ] },
  ]));
}

async function start() {
  mkdirSync(dataDirectory, { recursive: true });
  configureMenu();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  const opening = createWindow();
  // Make restore/exit available even if the user hides the startup window.
  configureDesktopActions();
  await opening;
  const { createDesktopRuntime } = await import('./runtime.mjs');
  const { createDesktopOutboundService } = await import('./network.mjs');
  if (quitting) return;
  runtime = createDesktopRuntime({
    appDirectory: app.getAppPath(), dataDirectory, dev,
    outboundService: createDesktopOutboundService({
      fetcher: (url, options) => session.defaultSession.fetch(url, options),
      onError: logError,
    }),
  });
  let startupTimeout;
  try {
    await Promise.race([
      runtime.ready,
      new Promise((_, reject) => { startupTimeout = setTimeout(() => reject(new Error('App startup timed out.')), 30_000); }),
    ]);
  } finally { clearTimeout(startupTimeout); }
  if (quitting) return;
  monitor = createShipmentMonitor({
    dataDirectory,
    fetchFeed: (signal) => runtime.fetch(new Request('http://thor-track.local/api/shipments', { signal })),
    notify: notifyUpdate,
    onError: logError,
    isBackground: () => !mainWindow || mainWindow.isMinimized() || !mainWindow.isVisible(),
  });
  protocol.handle('thor-track', async (request) => {
    if (!isAppUrl(request.url)) return new Response('Not found', { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Not allowed', { status: 405 });
    const url = new URL(request.url);
    try {
      const response = url.pathname === '/api/shipments' && request.method === 'GET'
        ? await monitor.refresh()
        : await runtime.fetch(new Request(`http://thor-track.local${url.pathname}${url.search}`, {
        method: request.method, headers: request.headers,
      }));
      if (url.pathname === '/' && response.status >= 400 && !dev) {
        void showFailure(new Error(`The application screen returned ${response.status}.`));
        await response.body?.cancel();
        return new Response('Thor Track could not open. Please try opening the app again.', { status: 503 });
      }
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      logError(error);
      if (url.pathname === '/') void showFailure(error);
      return new Response('Thor Track is temporarily unavailable. Please reopen the app.', { status: 503 });
    }
  });
  await mainWindow.loadURL(APP_URL);
  if (dev) {
    console.info(`Thor Track: ${APP_URL}\nRuntime: ${runtime.url}\nData: ${dataDirectory}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('second-instance', restoreWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  monitor?.stop();
  tray?.destroy();
  // A broken runtime must never trap the user in an application that will not close.
  const timeout = setTimeout(() => app.exit(), 5_000);
  Promise.resolve(runtime?.close()).catch(logError).finally(() => {
    clearTimeout(timeout);
    app.quit();
  });
});
process.on('uncaughtException', (error) => { void showFailure(error); });
process.on('unhandledRejection', (error) => { void showFailure(error); });
void app.whenReady().then(start).catch(showFailure);
