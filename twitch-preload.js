const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('twitchApi', {
  get: () => ipcRenderer.invoke('twitch-get'),
  set: patch => ipcRenderer.send('twitch-set', patch),
  connect: slot => ipcRenderer.invoke('twitch-connect', slot),
  disconnect: slot => ipcRenderer.invoke('twitch-disconnect', slot),
  openLink: slot => ipcRenderer.send('twitch-open-link', slot),
  cancel: slot => ipcRenderer.invoke('twitch-cancel', slot),
  openConsole: () => ipcRenderer.send('twitch-open-console'),
  openLives: () => ipcRenderer.send('open-twitch-lives'),
  openVideo: slot => ipcRenderer.send('twitch-open-video', slot),
  onState: cb => ipcRenderer.on('twitch-state', (_, s) => cb(s)),
  onLog: cb => ipcRenderer.on('twitch-log', (_, l) => cb(l)),
  onTheme: cb => ipcRenderer.on('theme-state', (_, t) => cb(t))
});
