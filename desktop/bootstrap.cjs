/* eslint-disable @typescript-eslint/no-require-imports -- Electron's pre-ready setup must run synchronously. */
const { app, dialog, protocol } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

// Electron must receive these settings synchronously, before its ready event.
// Keep this entrypoint CommonJS: an asynchronous ESM entry can run too late on
// a plain Windows launch even when a debugger-assisted launch succeeds.
async function reportFailure(error) {
  await app.whenReady();
  dialog.showErrorBox('Thor Track', process.argv.includes('--dev')
    ? String(error instanceof Error ? error.stack ?? error.message : error)
    : 'Thor Track could not open. Please reopen or reinstall the app and try again. Your saved order and history will be kept.');
  app.exit(1);
}

try {
  app.setName('Thor Track');
  app.setAppUserModelId('com.thortrack.desktop');
  const profileDirectory = process.env.THOR_TRACK_USER_DATA_DIR;
  const dataDirectory = profileDirectory && path.isAbsolute(profileDirectory)
    ? profileDirectory : path.join(app.getPath('appData'), 'Thor Track');
  mkdirSync(dataDirectory, { recursive: true });
  app.setPath('userData', dataDirectory);
  app.setPath('sessionData', dataDirectory);
  protocol.registerSchemesAsPrivileged([{
    scheme: 'thor-track',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  }]);

  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
  } else {
    import('./main.mjs').catch(reportFailure);
  }
} catch (error) {
  void reportFailure(error);
}
