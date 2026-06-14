'use strict'

const { contextBridge, ipcRenderer } = require('electron')

try {
  contextBridge.exposeInMainWorld('imwaldElectron', {
    isElectron: true,
    /** Loopback SOCKS bridge for `.onion` / `.i2p` relay URLs (packaged desktop). */
    hiddenRelayProxyBase: () => ipcRenderer.sendSync('imwald:get-hidden-relay-proxy-base'),
    getHiddenNetworkRelayStatus: (payload) =>
      ipcRenderer.invoke('imwald:hidden-network-relay-status', payload ?? {}),
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
