import { NIP05_AFFILIATION_BY_DOMAIN, type TNip05AffiliationDomain } from '@/constants'
import { splitNip05Identifier } from '@/lib/nip05'

export function normalizeNip05AffiliationDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

export function affiliationForNip05Domain(domain: string): TNip05AffiliationDomain | undefined {
  return NIP05_AFFILIATION_BY_DOMAIN.get(normalizeNip05AffiliationDomain(domain))
}

/** Unique NIP-05 identifiers from kind-0 primary + list fields. */
export function collectProfileNip05Identifiers(
  nip05?: string,
  nip05List?: string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw?: string) => {
    const id = raw?.trim()
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  add(nip05)
  for (const entry of nip05List ?? []) {
    add(entry)
  }
  return out
}

/**
 * NIP-05 rows on the profile whose domain is in {@link NIP05_AFFILIATION_DOMAINS}.
 * One row per identifier (verification runs separately).
 */
export function affiliationNip05CandidatesFromProfile(
  nip05?: string,
  nip05List?: string[]
): { nip05: string; affiliation: TNip05AffiliationDomain }[] {
  const out: { nip05: string; affiliation: TNip05AffiliationDomain }[] = []
  const domainsSeen = new Set<string>()
  for (const id of collectProfileNip05Identifiers(nip05, nip05List)) {
    const parts = splitNip05Identifier(id)
    if (!parts) continue
    const affiliation = affiliationForNip05Domain(parts.domain)
    if (!affiliation || domainsSeen.has(affiliation.domain)) continue
    domainsSeen.add(affiliation.domain)
    out.push({ nip05: id, affiliation })
  }
  return out
}
