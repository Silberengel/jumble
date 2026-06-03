import { archivesMetadataToProfile } from '@/lib/archives-profile-metadata'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import {
  registerProfileBatchPubkeys,
  unregisterProfileBatchPubkeys
} from '@/lib/profile-batch-coordinator'
import client from '@/services/client.service'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import type { TProfile } from '@/types'

function normalizeHexPubkeys(pubkeys: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of pubkeys) {
    const pk = raw.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(pk) || seen.has(pk)) continue
    seen.add(pk)
    out.push(pk)
  }
  return out
}

function placeholderProfile(pubkey: string): TProfile {
  return {
    pubkey,
    npub: pubkeyToNpub(pubkey) ?? '',
    username: formatPubkey(pubkey),
    batchPlaceholder: true
  }
}

/**
 * Batch profile hydration: Nostr Archives `POST /v1/profiles/metadata` first, then
 * {@link client.fetchProfilesForPubkeys} for pubkeys Archives did not return.
 */
export async function fetchProfilesMetadataBatch(pubkeys: readonly string[]): Promise<TProfile[]> {
  const deduped = normalizeHexPubkeys(pubkeys)
  if (deduped.length === 0) return []

  registerProfileBatchPubkeys(deduped)
  try {
    const byPk = new Map<string, TProfile>()

    if (nostrArchivesApi.isAvailable()) {
      const res = await nostrArchivesApi.fetchProfilesMetadata(deduped)
      if (res.ok) {
        for (const meta of res.data.profiles) {
          const profile = archivesMetadataToProfile(meta)
          if (profile) byPk.set(profile.pubkey, profile)
        }
      }
    }

    const missing = deduped.filter((pk) => !byPk.has(pk))
    if (missing.length > 0) {
      const relayProfiles = await client.fetchProfilesForPubkeys(missing)
      for (const p of relayProfiles) {
        const pkNorm = p.pubkey.toLowerCase()
        byPk.set(pkNorm, { ...p, pubkey: pkNorm })
      }
    }

    return deduped.map((pk) => byPk.get(pk) ?? placeholderProfile(pk))
  } finally {
    unregisterProfileBatchPubkeys(deduped)
  }
}
