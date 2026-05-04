/**
 * Preload — runs in a sandboxed context before the renderer.
 * Exposes only the minimum surface needed by the app.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform:   process.platform,
  isElectron: true,

  // Persistent account store (encrypted passwords via safeStorage)
  loadAccounts:  ()        => ipcRenderer.invoke('accounts:load'),
  saveAccount:   (account) => ipcRenderer.invoke('accounts:save',   account),
  removeAccount: (id)      => ipcRenderer.invoke('accounts:remove', id),
})
