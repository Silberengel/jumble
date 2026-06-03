import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import type { TProfile } from '@/types'
import type { TArchivesProfileMetadata } from '@/types/nostr-archives'

/** Map Nostr Archives profile metadata to {@link TProfile} for search / list UI. */
export function archivesMetadataToProfile(meta: TArchivesProfileMetadata): TProfile | null {
  const pk = meta.pubkey?.trim().toLowerCase()
  if (!pk || !/^[0-9a-f]{64}$/.test(pk)) return null

  const npub = pubkeyToNpub(pk) ?? ''
  const username =
    meta.display_name?.trim() ||
    meta.preferred_name?.trim() ||
    meta.name?.trim() ||
    formatPubkey(pk)

  return {
    pubkey: pk,
    npub,
    username,
    avatar: meta.picture?.trim() || undefined,
    about: meta.about?.trim() || undefined,
    nip05: meta.nip05?.trim() || undefined,
    lud16: meta.lud16?.trim() || undefined
  }
}

export function archivesMetadataListToProfiles(metas: readonly TArchivesProfileMetadata[]): TProfile[] {
  const out: TProfile[] = []
  const seen = new Set<string>()
  for (const meta of metas) {
    const p = archivesMetadataToProfile(meta)
    if (!p || seen.has(p.pubkey)) continue
    seen.add(p.pubkey)
    out.push(p)
  }
  return out
}
