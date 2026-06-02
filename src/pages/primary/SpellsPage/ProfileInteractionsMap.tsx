import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { useMuteList } from '@/contexts/mute-list-context'
import { getRelayUrlsWithFavoritesFastReadAndInbox, userReadInboxUrls, userWriteOutboxUrls } from '@/lib/favorites-feed-relays'
import { toProfile } from '@/lib/link'
import { formatPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import type { TSubRequestFilter } from '@/types'
import { Loader2, RefreshCw, UserRound } from 'lucide-react'
import type { Filter } from 'nostr-tools'
import { kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mergeInteractionEvents, type InteractionCard } from './merge-interaction-events'

const INTERACTION_KINDS = [
  kinds.ShortTextNote,
  kinds.Reaction,
  kinds.Repost,
  kinds.Zap,
  kinds.Highlights,
  ExtendedKind.COMMENT,
  ExtendedKind.VOICE_COMMENT,
  ExtendedKind.GENERIC_REPOST,
  ExtendedKind.EXTERNAL_REACTION,
  ExtendedKind.WEB_BOOKMARK
]

const LOCAL_LIMIT = 1200
const RELAY_LIMIT = 700

type Props = {
  pubkey: string
  refreshKey: number
}

function interactionFilters(pubkey: string, limit: number): TSubRequestFilter[] {
  return [
    { authors: [pubkey], kinds: INTERACTION_KINDS, limit },
    { '#p': [pubkey], kinds: INTERACTION_KINDS, limit } as Filter & { limit: number }
  ]
}

function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export default function ProfileInteractionsMap({ pubkey, refreshKey }: Props) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const { relayList, cacheRelayListEvent } = useNostr()
  const { mutePubkeySet } = useMuteList()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [cards, setCards] = useState<InteractionCard[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const relayUrls = useMemo(
    () =>
      getRelayUrlsWithFavoritesFastReadAndInbox(
        favoriteRelays,
        blockedRelays,
        userReadInboxUrls(relayList, cacheRelayListEvent),
        {
          userWriteRelays: userWriteOutboxUrls(relayList, cacheRelayListEvent),
          applySocialKindBlockedFilter: false
        }
      ),
    [favoriteRelays, blockedRelays, relayList]
  )

  const openProfile = useCallback((partnerPubkey: string) => {
    push(toProfile(partnerPubkey))
  }, [push])

  const load = useCallback(
    async (includeRelays: boolean) => {
      const filters = interactionFilters(pubkey, includeRelays ? RELAY_LIMIT : LOCAL_LIMIT)
      const local = await client.getLocalFeedEvents(
        filters.map((filter) => ({ urls: relayUrls, filter })),
        { maxMatches: LOCAL_LIMIT, maxRowsScanned: 28_000 }
      )
      if (!includeRelays || relayUrls.length === 0) return local
      const relayRows = await Promise.all(
        filters.map((filter) =>
          client.fetchEvents(relayUrls, filter, {
            cache: true,
            eoseTimeout: 4500,
            globalTimeout: 16_000,
            firstRelayResultGraceMs: false
          })
        )
      )
      return [...local, ...relayRows.flat()]
    },
    [pubkey, relayUrls]
  )

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    setRefreshing(true)
    void (async () => {
      try {
        const local = await load(false)
        if (cancelled) return
        setCards(mergeInteractionEvents(pubkey, local, mutePubkeySet))
        setLoading(false)

        const all = await load(true)
        if (cancelled) return
        setCards(mergeInteractionEvents(pubkey, all, mutePubkeySet))
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, refreshKey, load, mutePubkeySet])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>{t('Profile interactions map description')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              void load(true)
                .then((rows) => setCards(mergeInteractionEvents(pubkey, rows, mutePubkeySet)))
                .catch((e) => setError(e instanceof Error ? e.message : String(e)))
                .finally(() => setRefreshing(false))
            }}
          >
            {refreshing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {t('heatMapRescan')}
          </Button>
          <div className="flex items-center gap-1.5 text-xs">
            <UserAvatar userId={pubkey} size="small" className="size-5" />
            <Username userId={pubkey} className="font-medium text-foreground" />
          </div>
        </div>
      </div>

      {loading && cards.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : error && cards.length === 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-8 text-center text-sm text-destructive">
          {t('Profile interactions map failed')}: {error}
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 px-4 py-12 text-center text-sm text-muted-foreground">
          {t('Profile interactions map empty')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="grid grid-cols-1 gap-3 min-[720px]:grid-cols-2 xl:grid-cols-3">
            {cards.map((card, index) => (
              <button
                key={card.pubkey}
                type="button"
                className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => openProfile(card.pubkey)}
              >
                <Card
                  className={cn(
                    'flex h-full min-w-0 flex-col overflow-hidden p-3 transition-colors hover:bg-accent/70',
                    index < 3 && 'border-primary/40 bg-primary/5'
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Username userId={card.pubkey} className="block truncate text-sm font-semibold" />
                      <div className="truncate text-xs text-muted-foreground">{formatPubkey(card.pubkey)}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-foreground ring-1 ring-border">
                      #{index + 1}
                    </span>
                  </div>

                  <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                    <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                      <UserRound className="mr-1 inline size-3 shrink-0" aria-hidden />
                      {t('n interactions', { count: card.score, formattedCount: compactCount(card.score) })}
                    </span>
                    {card.authoredByProfile > 0 ? (
                      <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5">
                        {t('outgoing interactions', { count: card.authoredByProfile })}
                      </span>
                    ) : null}
                    {card.mentionsProfile > 0 ? (
                      <span className="max-w-full truncate rounded-full bg-muted px-2 py-0.5">
                        {t('incoming interactions', { count: card.mentionsProfile })}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex justify-center">
                    <UserAvatar userId={card.pubkey} size="big" className="size-16 shrink-0 sm:size-20" />
                  </div>
                </Card>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
