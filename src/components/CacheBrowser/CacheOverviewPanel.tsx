import { getNotePersistencePolicy } from '@/lib/note-persistence-policy'
import { getCacheRelayUrlsFromEvent } from '@/lib/private-relays'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { invalidateArchiveFootprintCache, readArchiveFootprintSync } from '@/services/event-archive.service'
import indexedDb from '@/services/indexed-db.service'
import { StoreNames } from '@/services/indexed-db-stores'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TOverviewStats = {
  sessionCount: number
  sessionMax: number
  archiveCount: number
  archiveMb: number
  timelineShards: number
}

export default function CacheOverviewPanel() {
  const { t } = useTranslation()
  const { cacheRelayListEvent, cacheRelaysEnabled } = useNostr()
  const policy = getNotePersistencePolicy()
  const cacheUrls = cacheRelaysEnabled ? getCacheRelayUrlsFromEvent(cacheRelayListEvent) : []
  const [stats, setStats] = useState<TOverviewStats | null>(null)

  const refresh = useCallback(async () => {
    invalidateArchiveFootprintCache()
    const session = client.getSessionCacheFootprint()
    const footprint = readArchiveFootprintSync() ?? (await indexedDb.getArchiveFootprint())
    const cacheInfo = await indexedDb.getStoreInfo()
    setStats({
      sessionCount: session.count,
      sessionMax: session.max,
      archiveCount: footprint.count,
      archiveMb: Math.round(footprint.bytes / (1024 * 1024)),
      timelineShards: cacheInfo[StoreNames.TIMELINE_STATE] ?? 0
    })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, policy.lightArchive, cacheUrls.length])

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('cacheOverview.title')}</h3>
        <span className="text-xs text-muted-foreground">
          {policy.lightArchive ? t('eventArchive.modeLight') : t('eventArchive.modeFull')}
        </span>
      </div>
      {stats ? (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('cacheOverview.sessionLru')}</dt>
            <dd className="font-medium tabular-nums">
              {stats.sessionCount.toLocaleString()} / {stats.sessionMax.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('cacheOverview.noteArchive')}</dt>
            <dd className="font-medium tabular-nums">
              {stats.archiveCount.toLocaleString()} · {stats.archiveMb} MB
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('cacheOverview.timelineShards')}</dt>
            <dd className="font-medium tabular-nums">{stats.timelineShards.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('cacheOverview.cacheRelays')}</dt>
            <dd className="font-medium break-all">
              {cacheUrls.length > 0
                ? cacheUrls.join(', ')
                : t('cacheOverview.cacheRelaysNone')}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-xs text-muted-foreground">{t('Loading…')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('cacheOverview.advancedStoresHint')}</p>
    </div>
  )
}
