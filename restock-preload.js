const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('restockApi', {
  get: account => ipcRenderer.invoke('restock-get', account),
  save: (account, config) => ipcRenderer.invoke('restock-save', account, config),
  summary: account => ipcRenderer.invoke('restock-summary', account),
  getKickRedeem: account => ipcRenderer.invoke('kick-redeem-get', account),
  setKickRedeem: (account, reward) => ipcRenderer.invoke('kick-redeem-set', account, reward),
  onAccount: cb => ipcRenderer.on('restock-account', (_, account) => cb(account))
});
