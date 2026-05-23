import { Button } from '@/components/ui/button'
import { createPaymentAttestationDraftEvent } from '@/lib/draft-event'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import {
  canUserAttestSuperchatPayment,
  getSuperchatAttestationTargetKindValue,
  getSuperchatPaymentRecipientPubkey,
  isAttestableSuperchatPayment
} from '@/lib/superchat'
import { cn } from '@/lib/utils'
import { requestProfileWallRefresh } from '@/hooks/useProfileWall'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { markLocalAttestationTarget } from '@/lib/payment-attestation-cache'
import { useNostr } from '@/providers/NostrProvider'
import { Sparkles } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function TurnIntoSuperchatButton({
  event,
  className,
  prominent = false,
  attestationRecipientPubkey: attestationRecipientPubkeyProp
}: {
  event: Event
  className?: string
  /** Full-width call-to-action styling for note cards (notifications feed). */
  prominent?: boolean
  /** Note author for note zaps; defaults to payment `p` / zap metadata. */
  attestationRecipientPubkey?: string | null
}) {
  const { pubkey } = useNostr()
  const attestationRecipientPubkey =
    attestationRecipientPubkeyProp ?? getSuperchatPaymentRecipientPubkey(event)

  if (
    !isAttestableSuperchatPayment(event) ||
    !getSuperchatAttestationTargetKindValue(event) ||
    !pubkey ||
    !attestationRecipientPubkey ||
    !canUserAttestSuperchatPayment(event, pubkey, attestationRecipientPubkey)
  ) {
    return null
  }

  return (
    <TurnIntoSuperchatButtonInner
      event={event}
      attestationRecipientPubkey={attestationRecipientPubkey}
      className={className}
      prominent={prominent}
    />
  )
}

function TurnIntoSuperchatButtonInner({
  event,
  attestationRecipientPubkey,
  className,
  prominent = false
}: {
  event: Event
  attestationRecipientPubkey: string
  className?: string
  prominent?: boolean
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const { attested, checking, markAttested } = usePaymentAttestationStatus(
    event,
    attestationRecipientPubkey
  )
  const [publishing, setPublishing] = useState(false)

  if (attested) {
    return (
      <p
        className={cn(
          'text-sm font-medium text-yellow-400/90',
          prominent && 'rounded-md border border-yellow-400/40 bg-yellow-400/10 px-3 py-2 text-center',
          className
        )}
      >
        {t('Superchat attested')}
      </p>
    )
  }

  const handleAttest = () => {
    if (attested || checking || publishing) return
    checkLogin(async () => {
      setPublishing(true)
      try {
        const draft = await createPaymentAttestationDraftEvent(event, { addClientTag: true })
        const published = await publish(draft, { disableFallbacks: true })
        markLocalAttestationTarget(attestationRecipientPubkey, event.id)
        if (published) {
          markAttested(published)
        } else {
          markAttested({ ...draft, id: event.id, pubkey: attestationRecipientPubkey, sig: '' } as Event)
        }
        requestProfileWallRefresh(attestationRecipientPubkey)
        showSimplePublishSuccess(t('Superchat attested'))
      } catch (error) {
        if (error instanceof LoginRequiredError) return
        toast.error(
          t('Failed to attest superchat', {
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setPublishing(false)
      }
    })
  }

  return (
    <Button
      type="button"
      variant={prominent ? 'default' : 'secondary'}
      className={cn(
        prominent &&
          'h-auto min-h-11 w-full gap-2 border-yellow-400/50 bg-yellow-400/20 py-2.5 text-base font-semibold text-yellow-100 shadow-[0_0_16px_rgba(250,204,21,0.25)] hover:bg-yellow-400/30',
        className
      )}
      disabled={checking || publishing}
      onClick={(e) => {
        e.stopPropagation()
        handleAttest()
      }}
    >
      <Sparkles className={cn('shrink-0', prominent ? 'size-5' : 'size-4')} aria-hidden />
      {t('Turn this into a superchat!')}
    </Button>
  )
}
