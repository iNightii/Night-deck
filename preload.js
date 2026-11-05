const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokeidle', {
  reloadAll: () => ipcRenderer.send('reload-all'),
  openExternal: () => ipcRenderer.send('open-external'),
  openTwitchChat: () => ipcRenderer.send('open-twitch-chat'),
  toggleEcho: () => ipcRenderer.send('echo-toggle'),
  getEchoState: () => ipcRenderer.send('echo-get-state'),
  onEchoState: callback => ipcRenderer.on('echo-state', (_, enabled) => callback(!!enabled)),
  onResourceState: callback => ipcRenderer.on('resource-state', (_, state) => callback(state)),
  openHuntingGuide: () => ipcRenderer.send('open-hunting-guide'),
  toggleThemeWindow: () => ipcRenderer.send('toggle-theme-window'),
  syncTheme: (theme) => ipcRenderer.send('theme-sync', theme),
  onThemeUpdated: (callback) => ipcRenderer.on('theme-updated', (_, theme) => callback(theme)),
  toggleAccount: (index, visible) => ipcRenderer.send('toggle-account', { index, visible }),
  setLayout: (mode) => ipcRenderer.send('set-layout', mode),
  hudMenu: (name, x, y) => ipcRenderer.send('hud-menu', { name, x, y }),
  hudZoom: (delta) => ipcRenderer.send('hud-zoom', delta),
  hudFullscreen: () => ipcRenderer.send('hud-fullscreen'),
  onHudState: (callback) => ipcRenderer.on('hud-state', (_, s) => callback(s)),
  focusAccount: (index) => ipcRenderer.send('focus-account', index),
  clearAccountFocus: () => ipcRenderer.send('clear-account-focus'),
  initUiState: (state) => ipcRenderer.send('init-ui-state', state),
  onFocusAccountChanged: (callback) => ipcRenderer.on('focus-account-changed', (_, index) => callback(index)),
  onLayoutChanged: (callback) => ipcRenderer.on('layout-changed', (_, data) => callback(data)),
  onAccountHidden: (callback) => ipcRenderer.on('account-hidden-changed', (_, data) => callback(data))
});
