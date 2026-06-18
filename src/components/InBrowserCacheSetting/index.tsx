import { Button } from '@/components/ui/button'
import {
  clearAppServiceWorkerAndCaches,
  refreshAppBrowserCache
} from '@/lib/app-cache-maintenance'
import { clearConsoleLogBuffer, isActivityTraceLogEntry } from '@/lib/console-log-buffer'
import { useConsoleLogBuffer } from '@/hooks/useConsoleLogBuffer'
import { setActivityTraceEnabled, useActivityTraceEnabled } from '@/hooks/useActivityTraceEnabled'
import logger from '@/lib/logger'
import { useNostr } from '@/providers/NostrProvider'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, RefreshCw, Database, X, Terminal, XCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { StorageKey } from '@/constants'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { toast } from 'sonner'
import { useCacheBrowser } from '../../contexts/cache-browser-context'

type ConsoleLogFilter = 'all' | 'errors-warnings' | 'trace'

export default function InBrowserCacheSetting() {
  const { t } = useTranslation()
  const { isSmallScreen } = useScreenSize()
  const {
    pubkey,
    relayList,
    requestAccountNetworkHydrate
  } = useNostr()
  const { openBrowseCache } = useCacheBrowser()
  const consoleLogs = useConsoleLogBuffer()
  const activityTraceEnabled = useActivityTraceEnabled()
  const [showConsoleLogs, setShowConsoleLogs] = useState(false)
  const [consoleLogSearch, setConsoleLogSearch] = useState('')
  const [consoleLogFilter, setConsoleLogFilter] = useState<ConsoleLogFilter>('all')
  const [cacheRefreshBusy, setCacheRefreshBusy] = useState(false)

  const handleClearCache = async () => {
    if (!confirm(t('Are you sure you want to clear all cached data? This will delete all stored events and settings from your browser.'))) {
      return
    }

    try {
      await indexedDb.clearAllCache()
      await indexedDb.clearPiperTtsCache()

      const cacheKeys = Object.values(StorageKey).filter(key =>
        key.includes('CACHE') || key.includes('EVENT') || key.includes('FEED') || key.includes('NOTIFICATION')
      )
      cacheKeys.forEach(key => {
        try {
          window.localStorage.removeItem(key)
        } catch (e) {
          logger.warn(`Failed to remove ${key} from localStorage`, e as Error)
        }
      })

      if ('caches' in window) {
        try {
          const cacheNames = await caches.keys()
          const currentOrigin = window.location.origin

          const appCacheNames = [
            'nostr-images',
            'satellite-images',
            'external-images'
          ]

          const appCaches = cacheNames.filter(name => {
            if (appCacheNames.includes(name)) return true
            if (name.startsWith('workbox-') || name.startsWith('precache-')) return true
            if (name.includes(currentOrigin.replace(/https?:\/\//, '').split('/')[0])) return true
            return false
          })

          await Promise.all(appCaches.map(name => caches.delete(name).catch(error => {
            logger.warn(`Failed to delete cache: ${name}`, { error })
          })))
        } catch (error) {
          logger.warn('Failed to clear some service worker caches', { error })
        }
      }

      postEditorCache.clearAllPostCaches()
      client.clearInMemoryCaches()

      toast.success(t('Cache cleared successfully'))
      setTimeout(() => window.location.reload(), 1500)
    } catch (error) {
      logger.error('Failed to clear cache', { error })
      toast.error(t('Failed to clear cache'))
    }
  }

  const handleRefreshCache = async () => {
    try {
      setCacheRefreshBusy(true)
      await refreshAppBrowserCache({
        pubkey,
        relayList,
        requestAccountNetworkHydrate
      })
      toast.success(t('Cache refreshed successfully'))
    } catch (error) {
      logger.error('Failed to refresh cache', { error })
      toast.error(t('Failed to refresh cache'))
    } finally {
      setCacheRefreshBusy(false)
    }
  }

  const handleClearServiceWorker = async () => {
    if (!confirm(t('Are you sure you want to unregister the service worker? This will clear this app\'s service worker caches and you will need to reload the page.'))) {
      return
    }

    try {
      const { unregisteredCount, cacheClearedCount } = await clearAppServiceWorkerAndCaches()

      if (unregisteredCount > 0 || cacheClearedCount > 0) {
        const message = unregisteredCount > 0 && cacheClearedCount > 0
          ? t('Service worker unregistered and caches cleared. Please reload the page.')
          : unregisteredCount > 0
          ? t('Service worker unregistered. Please reload the page.')
          : t('Service worker caches cleared. Please reload the page.')
        toast.success(message)
        setTimeout(() => window.location.reload(), 1000)
      } else {
        toast.info(t('No service workers or caches found for this app'))
      }
    } catch (error) {
      logger.error('Failed to unregister service worker', { error })
      toast.error(t('Failed to unregister service worker: ') + (error instanceof Error ? error.message : String(error)))
    }
  }

  const handleShowConsoleLogs = () => {
    setShowConsoleLogs(true)
    setConsoleLogSearch('')
    setConsoleLogFilter('all')
  }

  const handleClearConsoleLogs = () => {
    clearConsoleLogBuffer()
    toast.success(t('Console logs cleared'))
  }

  const filteredConsoleLogs = useMemo(() => {
    let filtered = [...consoleLogs]
    if (consoleLogFilter === 'errors-warnings') {
      filtered = filtered.filter((log) => log.type === 'error' || log.type === 'warn')
    } else if (consoleLogFilter === 'trace') {
      filtered = filtered.filter(isActivityTraceLogEntry)
    }
    if (consoleLogSearch.trim()) {
      const query = consoleLogSearch.toLowerCase().trim()
      filtered = filtered.filter(
        (log) =>
          log.message.toLowerCase().includes(query) || log.type.toLowerCase().includes(query)
      )
    }
    return filtered
  }, [consoleLogs, consoleLogSearch, consoleLogFilter])

  const renderConsoleLogList = () =>
    filteredConsoleLogs.length === 0 ? (
      <div className="text-muted-foreground p-4 text-center">
        {consoleLogs.length === 0
          ? t('No console logs captured yet')
          : t('No logs match the current filters')
        }
      </div>
    ) : (
      filteredConsoleLogs.map((log, index) => (
        <div
          key={index}
          className={`p-2 rounded border ${
            log.type === 'error'
              ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800'
              : log.type === 'warn'
                ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800'
                : isActivityTraceLogEntry(log)
                  ? 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800'
                  : 'bg-background border-border'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-muted-foreground text-[10px] whitespace-nowrap">
              [{log.type}]
            </span>
            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-words">
              {log.formattedParts ? (
                log.formattedParts.map((part, i) => {
                  if (part.style) {
                    const styleObj: Record<string, string> = {}
                    part.style.split(';').forEach(rule => {
                      const trimmed = rule.trim()
                      if (trimmed) {
                        const colonIndex = trimmed.indexOf(':')
                        if (colonIndex > 0) {
                          const key = trimmed.substring(0, colonIndex).trim()
                          const value = trimmed.substring(colonIndex + 1).trim()
                          const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                          styleObj[camelKey] = value
                        }
                      }
                    })
                    return <span key={i} style={styleObj}>{part.text}</span>
                  }
                  return <span key={i}>{part.text}</span>
                })
              ) : (
                log.message
              )}
            </pre>
          </div>
        </div>
      ))
    )

  const consoleLogFilters = (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        placeholder={t('Search logs...')}
        value={consoleLogSearch}
        onChange={(e) => setConsoleLogSearch(e.target.value)}
        className="min-w-0 w-full"
      />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Label htmlFor="console-log-filter" className="shrink-0 text-xs text-muted-foreground">
            {t('Log filter')}
          </Label>
          <Select
            value={consoleLogFilter}
            onValueChange={(value) => setConsoleLogFilter(value as ConsoleLogFilter)}
          >
            <SelectTrigger id="console-log-filter" className="h-8 min-w-[10rem] flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('All')}</SelectItem>
              <SelectItem value="errors-warnings">{t('Errors & warnings')}</SelectItem>
              <SelectItem value="trace">{t('Trace')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor="activity-trace-toggle" className="text-xs text-muted-foreground">
            {t('Activity trace')}
          </Label>
          <Switch
            id="activity-trace-toggle"
            checked={activityTraceEnabled}
            onCheckedChange={(checked) => setActivityTraceEnabled(checked, true)}
          />
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground space-y-1">
        <div>{t('Clear cached data stored in your browser, including IndexedDB events, localStorage settings, and service worker caches.')}</div>
        <div>
          {t('refreshCacheButtonExplainer', {
            defaultValue:
              'Refresh Cache runs an IndexedDB upgrade check, re-fetches your relay lists and profile-related events from the network (same work as the automatic startup sync), syncs kind-5 deletions into tombstones and removes deleted items from the local cache, then refreshes the store counts below.'
          })}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button variant="outline" className="shrink-0" onClick={handleClearCache}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('Clear Cache')}
        </Button>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={handleRefreshCache}
          disabled={cacheRefreshBusy}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${cacheRefreshBusy ? 'animate-spin' : ''}`} />
          {t('Refresh Cache')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={openBrowseCache}>
          <Database className="mr-2 h-4 w-4" />
          {t('Browse Cache')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={handleClearServiceWorker}>
          <XCircle className="mr-2 h-4 w-4" />
          {t('Clear Service Worker')}
        </Button>
        <Button variant="outline" className="shrink-0" onClick={handleShowConsoleLogs}>
          <Terminal className="mr-2 h-4 w-4" />
          {t('View Console Logs')} ({consoleLogs.length})
        </Button>
      </div>

      {isSmallScreen ? (
        <Drawer open={showConsoleLogs} onOpenChange={setShowConsoleLogs}>
          <DrawerContent className="max-h-[90vh]">
            <DrawerHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DrawerTitle>{t('Console Logs')}</DrawerTitle>
                  <DrawerDescription>
                    {t('View recent console logs for debugging')} ({filteredConsoleLogs.length} / {consoleLogs.length} {t('entries')})
                  </DrawerDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClearConsoleLogs}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('Clear')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowConsoleLogs(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DrawerHeader>
            <div className="space-y-2 px-4 pb-2">{consoleLogFilters}</div>
            <div className="flex-1 overflow-auto px-4 pb-4">
              <div className="space-y-1 font-mono text-xs">{renderConsoleLogList()}</div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={showConsoleLogs} onOpenChange={setShowConsoleLogs}>
          <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col" withoutClose>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <DialogTitle>{t('Console Logs')}</DialogTitle>
                  <DialogDescription>
                    {t('View recent console logs for debugging')} ({filteredConsoleLogs.length} / {consoleLogs.length} {t('entries')})
                  </DialogDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleClearConsoleLogs}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t('Clear')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowConsoleLogs(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-2 px-6 pb-4">{consoleLogFilters}</div>
            <div className="flex-1 overflow-auto px-6 pb-4">
              <div className="space-y-1 font-mono text-xs">{renderConsoleLogList()}</div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
