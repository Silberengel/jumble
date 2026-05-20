import logger from '@/lib/logger'

type NeedRefreshListener = () => void

const needRefreshListeners = new Set<NeedRefreshListener>()
let applyUpdate: (() => Promise<void>) | undefined
let initialized = false

export function subscribePwaNeedRefresh(listener: NeedRefreshListener): () => void {
  needRefreshListeners.add(listener)
  return () => {
    needRefreshListeners.delete(listener)
  }
}

function notifyPwaNeedRefresh(): void {
  for (const listener of needRefreshListeners) {
    try {
      listener()
    } catch (error) {
      logger.debug('PWA need-refresh listener error', { error })
    }
  }
}

export function getPwaApplyUpdate(): (() => Promise<void>) | undefined {
  return applyUpdate
}

/**
 * Register the service worker and surface {@link notifyPwaNeedRefresh} via vite-plugin-pwa prompt mode.
 * Importing `virtual:pwa-register` prevents the auto-injected `registerSW.js` script tag.
 */
export function initPwaUpdate(): void {
  if (initialized || import.meta.env.DEV) return
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) {
    return
  }
  initialized = true

  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      applyUpdate = registerSW({
        immediate: true,
        onNeedRefresh() {
          notifyPwaNeedRefresh()
        },
        onRegisterError(error: unknown) {
          logger.debug('Service worker registration failed', { error })
        }
      })
    })
    .catch((error) => {
      logger.debug('PWA registration module unavailable', { error })
    })
}

/** True when a new build is installed but waiting for user confirmation (prompt mode). */
export async function probePwaWaitingWorker(): Promise<boolean> {
  if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false
  }
  try {
    const registration = await navigator.serviceWorker.ready
    return Boolean(registration.waiting)
  } catch {
    return false
  }
}
