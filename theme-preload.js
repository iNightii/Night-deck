const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('themeApi', {
  onThemeState: (callback) => ipcRenderer.on('theme-state', (_, theme) => callback(theme)),
  update: (key, value) => ipcRenderer.send('theme-update', { [key]: value }),
  reset: () => ipcRenderer.send('theme-reset'),
  close: () => ipcRenderer.send('close-theme-window')
});
