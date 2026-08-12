import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendedKind } from '@/constants'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  filterUnclaimedBadgeAwards,
  parseAddressableCoordinate,
  resolveBadgeDisplayFromDefinition,
  type ProfileBadgeEntry,
  type ResolvedProfileBadge
} from '@/lib/nip58-profile-badges'
import { fetchBadgeAwardsForRecipient } from '@/lib/nip58-profile-badges-list'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import { replaceableEventService } from '@/services/client.service'
import { Award, RefreshCw } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type UnclaimedBadgeAwardsProps = {
  /** Current in-editor list (may include unpublished local edits). */
  claimedEntries: ProfileBadgeEntry[]
  /**
   * Append-only publish. Caller must merge with the latest relay list before publishing
   * so existing badges are never wiped. Returns true on success.
   */
  onClaimAndPublish: (claim: ProfileBadgeEntry) => Promise<boolean>
  publishing?: boolean
}

function UnclaimedBadgeRow({
  badge,
  claiming,
  disabled,
  onClaim
}: {
  badge: ResolvedProfileBadge
  claiming: boolean
  disabled: boolean
  onClaim: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2">
      {badge.imageUrl ? (
        <img src={badge.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
          <Award className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-medium">{badge.name}</div>
        {badge.description ? (
          <div className="truncate text-xs text-muted-foreground">{badge.description}</div>
        ) : null}
        <div className="truncate font-mono text-[11px] text-muted-foreground">
          {badge.definitionCoordinate}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={disabled || claiming}
        onClick={onClaim}
        className="shrink-0"
      >
        {claiming ? t('loading...') : t('Claim badge')}
      </Button>
    </div>
  )
}

export default function UnclaimedBadgeAwards({
  claimedEntries,
  onClaimAndPublish,
  publishing = false
}: UnclaimedBadgeAwardsProps) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [awards, setAwards] = useState<ProfileBadgeEntry[]>([])
  const [resolvedById, setResolvedById] = useState<Map<string, ResolvedProfileBadge>>(new Map())
  const [loading, setLoading] = useState(false)
  const [claimingId, setClaimingId] = useState<string | null>(null)

  const loadAwards = useCallback(async () => {
    if (!pubkey) {
      setAwards([])
      setResolvedById(new Map())
      return
    }
    setLoading(true)
    try {
      const relays = await buildAccountListRelayUrlsForMerge({
        accountPubkey: pubkey,
        favoriteRelays: favoriteRelays ?? [],
        blockedRelays
      })
      const fetched = await fetchBadgeAwardsForRecipient(pubkey, relays)
      setAwards(fetched)

      const defCoords = [...new Set(fetched.map((e) => e.definitionCoordinate))]
      const defByCoord = new Map<string, Event | undefined>()
      await Promise.all(
        defCoords.map(async (coord) => {
          const parsed = parseAddressableCoordinate(coord)
          if (!parsed || parsed.kind !== ExtendedKind.BADGE_DEFINITION) return
          try {
            const def = await replaceableEventService.fetchReplaceableEvent(
              parsed.pubkey,
              parsed.kind,
              parsed.d
            )
            defByCoord.set(coord, def ?? undefined)
          } catch {
            defByCoord.set(coord, undefined)
          }
        })
      )

      const nextResolved = new Map<string, ResolvedProfileBadge>()
      for (const entry of fetched) {
        nextResolved.set(
          entry.awardEventId,
          resolveBadgeDisplayFromDefinition(entry, defByCoord.get(entry.definitionCoordinate))
        )
      }
      setResolvedById(nextResolved)
    } catch {
      setAwards([])
      setResolvedById(new Map())
    } finally {
      setLoading(false)
    }
  }, [pubkey, favoriteRelays, blockedRelays])

  useEffect(() => {
    void loadAwards()
  }, [loadAwards])

  const unclaimed = useMemo(
    () => filterUnclaimedBadgeAwards(awards, claimedEntries),
    [awards, claimedEntries]
  )

  const unclaimedResolved = useMemo(() => {
    return unclaimed
      .map((e) => resolvedById.get(e.awardEventId))
      .filter((r): r is ResolvedProfileBadge => !!r)
  }, [unclaimed, resolvedById])

  const handleClaim = async (badge: ResolvedProfileBadge) => {
    if (claimingId || publishing) return
    setClaimingId(badge.awardEventId)
    try {
      const ok = await onClaimAndPublish({
        definitionCoordinate: badge.definitionCoordinate,
        awardEventId: badge.awardEventId
      })
      if (ok) {
        setAwards((prev) => prev.filter((a) => a.awardEventId !== badge.awardEventId))
      }
    } finally {
      setClaimingId(null)
    }
  }

  if (!pubkey) return null

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-medium">{t('Unclaimed badge awards')}</h3>
          <p className="text-xs text-muted-foreground">{t('Unclaimed badge awards intro')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void loadAwards()}
          disabled={loading}
          aria-label={t('Refresh')}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading && unclaimedResolved.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : unclaimedResolved.length === 0 ? (
        <p className="text-sm text-muted-foreground py-1">
          {awards.length === 0
            ? t('No badge awards found on relays')
            : t('No unclaimed badge awards')}
        </p>
      ) : (
        <div className="space-y-2">
          {unclaimedResolved.map((badge) => (
            <UnclaimedBadgeRow
              key={`${badge.definitionCoordinate}:${badge.awardEventId}`}
              badge={badge}
              claiming={claimingId === badge.awardEventId}
              disabled={publishing || claimingId != null}
              onClaim={() => void handleClaim(badge)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
