import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { refreshAppBrowserCacheAndClearServiceWorker } from '@/lib/app-cache-maintenance'
import logger from '@/lib/logger'
import {
  initPwaUpdate,
  probePwaWaitingWorker,
  subscribePwaNeedRefresh
} from '@/lib/pwa-update'
import { useNostrOptional } from '@/providers/nostr-context'
import { RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function readVersionUpdateDismissed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem('versionUpdateDismissed') === 'true'
  } catch {
    return false
  }
}

export default function VersionUpdateBanner() {
  const { t } = useTranslation()
  const nostr = useNostrOptional()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isDismissed, setIsDismissed] = useState(readVersionUpdateDismissed)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    if (import.meta.env.DEV || typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) {
      return
    }

    initPwaUpdate()

    const showBanner = () => setUpdateAvailable(true)
    const unsubscribe = subscribePwaNeedRefresh(showBanner)

    void probePwaWaitingWorker().then((waiting) => {
      if (waiting) showBanner()
    })

    const checkForUpdate = () => {
      if (document.hidden) return
      void navigator.serviceWorker.ready
        .then((registration) => registration.update())
        .catch(() => {})
    }
    const interval = window.setInterval(checkForUpdate, 60_000)
    document.addEventListener('visibilitychange', checkForUpdate)
    checkForUpdate()

    return () => {
      unsubscribe()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', checkForUpdate)
    }
  }, [])

  const handleUpdate = () => {
    try {
      sessionStorage.setItem('versionUpdateDismissed', 'true')
    } catch {
      // ignore quota or private browsing
    }
    setIsDismissed(true)
    setIsUpdating(true)

    void (async () => {
      try {
        await refreshAppBrowserCacheAndClearServiceWorker({
          pubkey: nostr?.pubkey,
          relayList: nostr?.relayList,
          requestAccountNetworkHydrate: nostr?.requestAccountNetworkHydrate
        })
      } catch (error) {
        logger.warn('[VersionUpdateBanner] Pre-update cache refresh failed', { error })
      }
      window.location.reload()
    })()
  }

  const handleDismiss = () => {
    setIsDismissed(true)
    try {
      sessionStorage.setItem('versionUpdateDismissed', 'true')
    } catch {
      // ignore quota or private browsing
    }
  }

  if (!updateAvailable || isDismissed) {
    return null
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              {t('A new version is available')}
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-300">
              {t('Click update to get the latest features and improvements')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isUpdating ? (
              <>
                <Skeleton className="mr-2 size-4 shrink-0 rounded-sm" aria-hidden />
                {t('Updating...')}
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t('Update')}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="h-8 w-8 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
