import { getProfileFromEvent } from '@/lib/event-metadata'
import { collectPaytoTypeFamiliesFromProfile } from '@/lib/merge-payment-methods'
import { loadAuthorReplaceablesFromLocalCache } from '@/lib/profile-author-replaceables-cache'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useState } from 'react'

/** Payto families configured on the logged-in viewer (for ordering recipient payment lists). */
export function useSenderPaytoTypes(enabled = true): Set<string> {
  const { pubkey, profileEvent: accountProfileEvent } = useNostr()
  const [families, setFamilies] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!enabled || !pubkey) {
      setFamilies(new Set())
      return
    }

    let cancelled = false
    void loadAuthorReplaceablesFromLocalCache(pubkey).then(({ paymentInfo, profileEvent }) => {
      if (cancelled) return
      const event = profileEvent ?? accountProfileEvent ?? null
      const profile = event ? getProfileFromEvent(event) : null
      setFamilies(collectPaytoTypeFamiliesFromProfile(paymentInfo, profile, event))
    })

    return () => {
      cancelled = true
    }
  }, [enabled, pubkey, accountProfileEvent])

  return families
}
