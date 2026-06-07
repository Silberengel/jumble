import { getPubkeysFromPTags } from '@/lib/tag'
import { resolveAutoLoadMediaForAuthor } from '@/lib/media-auto-load-policy'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMediaAutoLoadSourceEvent } from '@/providers/MediaAutoLoadEventContext'
import { useNostrOptional } from '@/providers/nostr-context'
import storage from '@/services/local-storage.service'
import type { Event } from 'nostr-tools'
import { useMemo } from 'react'

export function useShouldAutoLoadMedia(
  authorPubkey?: string | null,
  sourceEvent?: Event | null
): boolean {
  const contentPolicy = useContentPolicyOptional()
  const nostr = useNostrOptional()
  const contextSourceEvent = useMediaAutoLoadSourceEvent()

  const followings = useMemo(
    () => (nostr?.followListEvent ? getPubkeysFromPTags(nostr.followListEvent.tags) : []),
    [nostr?.followListEvent]
  )

  const effectiveSourceEvent = sourceEvent ?? contextSourceEvent

  return useMemo(
    () =>
      resolveAutoLoadMediaForAuthor({
        policy: contentPolicy?.mediaAutoLoadPolicy ?? storage.getMediaAutoLoadPolicy(),
        connectionType: contentPolicy?.connectionType,
        authorPubkey,
        followings,
        accountPubkey: nostr?.pubkey ?? null,
        sourceEvent: effectiveSourceEvent
      }),
    [
      contentPolicy?.mediaAutoLoadPolicy,
      contentPolicy?.connectionType,
      authorPubkey,
      followings,
      nostr?.pubkey,
      effectiveSourceEvent
    ]
  )
}
