import { FOLLOWS_HISTORY_RELAY_URLS } from '@/constants'
import { createFollowListDraftEvent } from '@/lib/draft-event'
import type { Event } from 'nostr-tools'
import type { TDraftEvent, TPublishOptions } from '@/types'

/**
 * Append-only snapshot of the current kind-3 contacts list to follows-history relays (same practice as
 * {@link FollowingListPage} before destructive edits). Call immediately before publishing a new contacts state.
 */
export async function publishFollowListPreimageToHistory(
  publish: (draftEvent: TDraftEvent, options?: TPublishOptions) => Promise<Event>,
  tags: string[][],
  content: string | undefined
): Promise<void> {
  const draft = createFollowListDraftEvent(tags, content ?? '')
  await publish(draft, { specifiedRelayUrls: [...FOLLOWS_HISTORY_RELAY_URLS] })
}
