import { CALENDAR_EVENT_KINDS, ExtendedKind } from '@/constants'
import type { TFeedSubRequest } from '@/types'

/**
 * REQ shards for a profile “posts” timeline: per-relay URL group, `authors` + `kinds`, plus optional
 * calendar-invite filters (#p) when {@link kindsArg} includes NIP-52 calendar kinds.
 * Same shape as {@link useProfileTimeline}’s internal {@code buildSubRequests}, for {@link NoteList} / {@link NormalFeed}.
 */
export function buildProfileAuthorSubRequestsFromUrlGroups(
  groups: string[][],
  authorPubkeyHex: string,
  kindsArg: number[],
  limit: number
): TFeedSubRequest[] {
  const hasCalendarKinds = kindsArg.some((k) =>
    (CALENDAR_EVENT_KINDS as readonly number[]).includes(k)
  )
  const authorRequests: TFeedSubRequest[] = groups
    .map((urls) => ({
      urls,
      filter: {
        authors: [authorPubkeyHex],
        kinds: kindsArg,
        limit
      }
    }))
    .filter((request) => request.urls.length > 0)
  const calendarInviteRequests: TFeedSubRequest[] = hasCalendarKinds
    ? groups
        .map((urls) => ({
          urls,
          filter: {
            kinds: [ExtendedKind.CALENDAR_EVENT_DATE, ExtendedKind.CALENDAR_EVENT_TIME],
            '#p': [authorPubkeyHex],
            limit: 100
          }
        }))
        .filter((request) => request.urls.length > 0)
    : []
  return [...authorRequests, ...calendarInviteRequests]
}
