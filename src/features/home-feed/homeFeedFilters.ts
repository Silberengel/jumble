import { eventPassesNoteListKindPicker } from '@/lib/feed-kind-filter'
import { isPlausibleEventCreatedAt } from '@/lib/event-created-at'
import { shouldFilterEvent } from '@/lib/event-filtering'
import { isReplyNoteEvent, isMentioningMutedUsers } from '@/lib/event'
import { muteSetHas } from '@/lib/mute-set'
import { eventSeenOnMatchesAllowlist } from '@/lib/relay-allowlist'
import { shouldIncludePaymentInFeed } from '@/lib/superchat'
import type { HomeFeedListMode } from './buildHomeFeedDescriptor'
import type { Event } from 'nostr-tools'

export type HomeFeedFilterContext = {
  listMode: HomeFeedListMode
  hideReplies: boolean
  showKinds: readonly number[]
  showKind1OPs: boolean
  showKind1Replies: boolean
  showKind1111: boolean
  applyKindPickerInUi: boolean
  seeAllFeedEvents: boolean
  filterMutedNotes: boolean
  hideContentMentioningMutedUsers: boolean
  mutePubkeySet: Set<string> | ReadonlySet<string>
  attestedSuperchatIds: ReadonlySet<string> | Set<string>
  incomingPaymentRecipientPubkey?: string
  seenOnAllowlist?: readonly string[]
  relayAuthoritativeFeedOnly: boolean
  isEventDeleted?: (event: Event) => boolean
  getSeenOnRelays: (eventId: string) => readonly string[]
}

export function shouldHideHomeFeedEvent(event: Event, ctx: HomeFeedFilterContext): boolean {
  if (ctx.isEventDeleted?.(event)) return true
  if (!isPlausibleEventCreatedAt(event.created_at)) return true
  if (ctx.hideReplies && isReplyNoteEvent(event)) return true
  if (ctx.filterMutedNotes && muteSetHas(ctx.mutePubkeySet, event.pubkey)) return true
  if (
    ctx.filterMutedNotes &&
    ctx.hideContentMentioningMutedUsers &&
    isMentioningMutedUsers(event, ctx.mutePubkeySet as Set<string>)
  ) {
    return true
  }
  if (shouldFilterEvent(event)) return true
  if (
    !shouldIncludePaymentInFeed(
      event,
      ctx.attestedSuperchatIds,
      ctx.incomingPaymentRecipientPubkey
    )
  ) {
    return true
  }

  const allowlist =
    ctx.listMode === 'posts' || ctx.relayAuthoritativeFeedOnly
      ? ctx.seenOnAllowlist
      : ctx.seenOnAllowlist

  if (
    allowlist?.length &&
    (ctx.listMode === 'posts' || ctx.relayAuthoritativeFeedOnly) &&
    !eventSeenOnMatchesAllowlist(ctx.getSeenOnRelays(event.id), allowlist, {
      strictUnknownSeenOn: ctx.relayAuthoritativeFeedOnly
    })
  ) {
    return true
  }

  return false
}

export function filterVisibleHomeFeedEvents(
  events: readonly Event[],
  ctx: HomeFeedFilterContext,
  limit: number
): Event[] {
  const out: Event[] = []
  const idSet = new Set<string>()

  for (const evt of events) {
    if (out.length >= limit) break
    if (ctx.applyKindPickerInUi && !ctx.seeAllFeedEvents) {
      if (
        !eventPassesNoteListKindPicker(
          evt,
          ctx.showKinds,
          ctx.showKind1OPs,
          ctx.showKind1Replies,
          ctx.showKind1111
        )
      ) {
        continue
      }
    }
    if (shouldHideHomeFeedEvent(evt, ctx)) continue
    if (idSet.has(evt.id)) continue
    idSet.add(evt.id)
    out.push(evt)
  }

  return out
}
