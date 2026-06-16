import './index.css'
import './polyfill'
import './lib/error-suppression'
import './lib/console-log-buffer'
import storage from './services/local-storage.service'
import './lib/debug-utils'
import { fetchWithTimeout } from './lib/fetch-with-timeout'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { initI18n } from './i18n'
import { restorePersistedFeedSnapshots } from './services/session-feed-snapshot.service'
import { installStaleBuildChunkRecovery } from './lib/stale-chunk-recovery'
import { initPwaUpdate } from './lib/pwa-update'
import { installViewportHeightListeners } from './lib/viewport-height'
import { preloadEmojiPicker } from './lib/emoji-picker-preload'

installStaleBuildChunkRecovery()
initPwaUpdate()
installViewportHeightListeners()

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: { NIP66_MONITOR_NPUB?: string }
  }
}

const SESSION_STORAGE_KEY = 'jumble:session'

async function bootstrap() {
  // Always defined: fetch does not throw on 4xx/5xx, so non-OK responses must not leave this unset.
  window.__RUNTIME_CONFIG__ = {}
  console.info('[imwald] Boot: loading i18n (sync settings already read from localStorage)…')
  await initI18n()
  restorePersistedFeedSnapshots()
  console.info('[imwald] Boot: hydrating settings from IndexedDB…')
  await storage.initAsync()
  console.info('[imwald] Boot: mounting React')
  // Mark session storage as used so it's visible in DevTools; VersionUpdateBanner and NotePage also use it.
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, String(Date.now()))
  } catch {
    // ignore quota or private browsing
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
  const warmEmojiPicker = () => void preloadEmojiPicker()
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(warmEmojiPicker, { timeout: 4000 })
  } else {
    setTimeout(warmEmojiPicker, 1500)
  }
  void (async () => {
    try {
      const r = await fetchWithTimeout('/config.json', { timeoutMs: 10_000 })
      if (r.ok) {
        window.__RUNTIME_CONFIG__ = (await r.json()) as {
          NIP66_MONITOR_NPUB?: string
        }
      }
    } catch {
      window.__RUNTIME_CONFIG__ = {}
    }
  })()
}

bootstrap()
