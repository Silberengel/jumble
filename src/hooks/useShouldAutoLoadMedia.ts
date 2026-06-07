import { getPubkeysFromPTags } from '@/lib/tag'
import { resolveAutoLoadMediaForAuthor } from '@/lib/media-auto-load-policy'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useNostrOptional } from '@/providers/nostr-context'
import storage from '@/services/local-storage.service'
import { useMemo } from 'react'

export function useShouldAutoLoadMedia(authorPubkey?: string | null): boolean {
  const contentPolicy = useContentPolicyOptional()
  const nostr = useNostrOptional()

  const followings = useMemo(
    () => (nostr?.followListEvent ? getPubkeysFromPTags(nostr.followListEvent.tags) : []),
    [nostr?.followListEvent]
  )

  return useMemo(
    () =>
      resolveAutoLoadMediaForAuthor({
        policy: contentPolicy?.mediaAutoLoadPolicy ?? storage.getMediaAutoLoadPolicy(),
        connectionType: contentPolicy?.connectionType,
        authorPubkey,
        followings,
        accountPubkey: nostr?.pubkey ?? null
      }),
    [
      contentPolicy?.mediaAutoLoadPolicy,
      contentPolicy?.connectionType,
      authorPubkey,
      followings,
      nostr?.pubkey
    ]
  )
}
