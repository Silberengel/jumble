import { useFetchProfile } from '@/hooks'
import { useVerifiedNip05Affiliations } from '@/hooks/useVerifiedNip05Affiliations'
import { userIdToPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

export default function Nip05AffiliationBadges({
  userId,
  pubkey: pubkeyProp,
  nip05: nip05Prop,
  nip05List: nip05ListProp,
  className
}: {
  /** Hex or npub — loads kind 0 for NIP-05 when `nip05` / `nip05List` omitted. */
  userId?: string
  pubkey?: string
  nip05?: string
  nip05List?: string[]
  className?: string
}) {
  const { t } = useTranslation()
  const pubkey = pubkeyProp ?? (userId ? userIdToPubkey(userId) : '')
  const { profile } = useFetchProfile(
    nip05Prop === undefined && nip05ListProp === undefined && pubkey ? pubkey : undefined
  )
  const nip05 = nip05Prop ?? profile?.nip05
  const nip05List = nip05ListProp ?? profile?.nip05List
  const affiliations = useVerifiedNip05Affiliations(pubkey, nip05, nip05List)

  if (affiliations.length === 0) return null

  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-0.5', className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {affiliations.map((aff) => {
        const label = aff.label ?? aff.domain
        return (
          <span
            key={aff.domain}
            role="img"
            aria-label={t('Verified NIP-05 affiliation', { domain: label })}
            title={t('Verified NIP-05 affiliation', { domain: label })}
            className="inline-flex size-[1.05em] items-center justify-center text-sm leading-none select-none grayscale contrast-125 opacity-90"
          >
            {aff.emoji}
          </span>
        )
      })}
    </span>
  )
}
