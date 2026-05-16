import { buildExplorePopularRelayUrls } from '@/lib/explore-popular-relays'
import { toRelay } from '@/lib/link'
import { normalizeAnyRelayUrl, simplifyUrl } from '@/lib/url'
import { useSmartRelayNavigation } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Lightweight Explore relay list: URLs from the viewer's NIP-65 / favorites / defaults and optional
 * cached NIP-66 data — no GitHub collections fetch and no NIP-11 storm on mount.
 */
export default function ExplorePopularRelays() {
  const { t } = useTranslation()
  const { relayList } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const { navigateToRelay } = useSmartRelayNavigation()
  const [nip66Cached, setNip66Cached] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void indexedDb
      .getPublicLivelyRelayUrlsCache()
      .then((c) => {
        if (!cancelled && c?.urls?.length) setNip66Cached(c.urls)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const urls = useMemo(
    () =>
      buildExplorePopularRelayUrls({
        relayList,
        favoriteRelays,
        blockedRelays,
        nip66CachedUrls: nip66Cached
      }),
    [relayList, favoriteRelays, blockedRelays, nip66Cached]
  )

  if (urls.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">{t('No relays in your lists yet.')}</p>
    )
  }

  return (
    <section className="min-w-0 pb-6" aria-label={t('Popular relays')}>
      <h2 className="mb-2 px-4 text-base font-semibold tracking-tight">{t('Popular relays')}</h2>
      <p className="mb-3 px-4 text-sm text-muted-foreground">
        {t('From your mailbox, favorites, and cached relay lists on this device.')}
      </p>
      <ul className="grid min-w-0 gap-2 px-2 md:grid-cols-2 md:px-4">
        {urls.map((url) => {
          const key = normalizeAnyRelayUrl(url) || url
          return (
            <li key={key}>
              <button
                type="button"
                className="flex w-full min-w-0 flex-col rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-accent/40"
                onClick={() => navigateToRelay(toRelay(url))}
              >
                <span className="truncate font-mono text-sm font-semibold">{simplifyUrl(url)}</span>
                <span className="mt-0.5 truncate text-xs text-muted-foreground">{url}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
