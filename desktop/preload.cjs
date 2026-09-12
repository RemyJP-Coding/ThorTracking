/* eslint-disable @typescript-eslint/no-require-imports -- Sandboxed Electron preloads use CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

// Expose only fixed app actions; never expose ipcRenderer or arbitrary channels.
contextBridge.exposeInMainWorld('thorTrackDesktop', Object.freeze({
  setWatch: (watch) => ipcRenderer.invoke('thor-track:set-watch', watch),
  minimize: () => ipcRenderer.invoke('thor-track:minimize'),
  quit: () => ipcRenderer.invoke('thor-track:quit'),
  onRefreshRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('thor-track:refresh', listener);
    return () => ipcRenderer.removeListener('thor-track:refresh', listener);
  },
}));
