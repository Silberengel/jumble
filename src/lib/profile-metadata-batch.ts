import { archivesMetadataToProfile } from '@/lib/archives-profile-metadata'
import { formatPubkey, pubkeyToNpub } from '@/lib/pubkey'
import {
  registerProfileBatchPubkeys,
  unregisterProfileBatchPubkeys
} from '@/lib/profile-batch-coordinator'
import client from '@/services/client.service'
import nostrArchivesApi from '@/services/nostr-archives-api.service'
import type { TArchivesApiResult, TArchivesProfileMetadata } from '@/types/nostr-archives'
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

function mergeArchivesProfiles(
  byPk: Map<string, TProfile>,
  res: TArchivesApiResult<{ profiles: TArchivesProfileMetadata[] }>
): void {
  if (!res.ok) return
  for (const meta of res.data.profiles) {
    const profile = archivesMetadataToProfile(meta)
    if (profile) byPk.set(profile.pubkey, profile)
  }
}

/**
 * Batch profile hydration: Nostr Archives `POST /v1/profiles/metadata` and relay fetch run in
 * parallel so a slow or missing Archives response never blocks relay fallbacks (feeds stay populated).
 */
export async function fetchProfilesMetadataBatch(pubkeys: readonly string[]): Promise<TProfile[]> {
  const deduped = normalizeHexPubkeys(pubkeys)
  if (deduped.length === 0) return []

  registerProfileBatchPubkeys(deduped)
  try {
    const byPk = new Map<string, TProfile>()

    const archivesPromise = nostrArchivesApi.isAvailable()
      ? nostrArchivesApi.fetchProfilesMetadata(deduped)
      : Promise.resolve({ ok: false as const, reason: 'disabled' as const })

    const archivesRes = await Promise.race([
      archivesPromise,
      new Promise<{ ok: false; reason: 'timeout' }>((resolve) =>
        setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 400)
      )
    ])
    mergeArchivesProfiles(byPk, archivesRes)

    const relayNeeded = deduped.filter((pk) => !byPk.has(pk))
    const relayProfiles =
      relayNeeded.length > 0
        ? await client.fetchProfilesForPubkeys(relayNeeded).catch(() => [] as TProfile[])
        : []

    for (const p of relayProfiles) {
      const pkNorm = p.pubkey.toLowerCase()
      if (!byPk.has(pkNorm)) {
        byPk.set(pkNorm, { ...p, pubkey: pkNorm })
      }
    }

    return deduped.map((pk) => byPk.get(pk) ?? placeholderProfile(pk))
  } finally {
    unregisterProfileBatchPubkeys(deduped)
  }
}
