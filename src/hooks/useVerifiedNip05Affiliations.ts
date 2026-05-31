import { NIP05_AFFILIATION_DOMAINS, type TNip05AffiliationDomain } from '@/constants'
import { affiliationNip05CandidatesFromProfile } from '@/lib/nip05-affiliation'
import { verifyNip05 } from '@/lib/nip05'
import { useEffect, useMemo, useState } from 'react'

export function useVerifiedNip05Affiliations(
  pubkey: string | undefined,
  nip05?: string,
  nip05List?: string[]
): readonly TNip05AffiliationDomain[] {
  const candidates = useMemo(
    () => affiliationNip05CandidatesFromProfile(nip05, nip05List),
    [nip05, nip05List]
  )
  const candidatesKey = useMemo(
    () => candidates.map((c) => c.nip05).join('\u0001'),
    [candidates]
  )
  const [verified, setVerified] = useState<readonly TNip05AffiliationDomain[]>([])

  useEffect(() => {
    if (!pubkey || candidates.length === 0) {
      setVerified([])
      return
    }
    let cancelled = false
    void (async () => {
      const confirmed = new Set<string>()
      await Promise.all(
        candidates.map(async ({ nip05: nip05Id, affiliation }) => {
          const result = await verifyNip05(nip05Id, pubkey)
          if (
            result.isVerified &&
            result.nip05Domain.toLowerCase() === affiliation.domain
          ) {
            confirmed.add(affiliation.domain)
          }
        })
      )
      if (cancelled) return
      setVerified(
        NIP05_AFFILIATION_DOMAINS.filter((entry) => confirmed.has(entry.domain))
      )
    })()
    return () => {
      cancelled = true
    }
  }, [pubkey, candidatesKey])

  return verified
}
