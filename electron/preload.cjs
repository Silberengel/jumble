'use strict'

const { contextBridge, ipcRenderer } = require('electron')

try {
  contextBridge.exposeInMainWorld('imwaldElectron', {
    isElectron: true,
    reloadApp: () => ipcRenderer.invoke('imwald:reload-app'),
    /**
     * Same-origin translate / LanguageTool from the renderer hits CORS when the shell is loopback.
     * Main process performs the HTTP(S) request (allowlisted host + path only).
     */
    backendRequest: (payload) => ipcRenderer.invoke('imwald:backend-request', payload)
  })
} catch (err) {
  console.error('[imwald] preload: failed to expose imwaldElectron', err)
}
