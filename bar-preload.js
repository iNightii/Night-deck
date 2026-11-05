const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('barApi', {
  action: (index, action) => ipcRenderer.send('bar-action', { index, action }),
  menu: (index, name, x, y) => ipcRenderer.send('bar-menu', { index, name, x, y }),
  onState: cb => ipcRenderer.on('bar-state', (_, s) => cb(s)),
  onTheme: cb => ipcRenderer.on('theme-updated', (_, t) => cb(t))
});
