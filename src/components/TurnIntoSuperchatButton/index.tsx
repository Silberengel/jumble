import { Button } from '@/components/ui/button'
import { createPaymentAttestationDraftEvent } from '@/lib/draft-event'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import {
  getSuperchatAttestationTargetKindValue,
  isAttestableSuperchatPayment
} from '@/lib/superchat'
import { cn } from '@/lib/utils'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { useNostr } from '@/providers/NostrProvider'
import { Sparkles } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function TurnIntoSuperchatButton({
  event,
  className,
  prominent = false
}: {
  event: Event
  className?: string
  /** Full-width call-to-action styling for note cards. */
  prominent?: boolean
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const { attested, checking, recipientPubkey } = usePaymentAttestationStatus(event)
  const [publishing, setPublishing] = useState(false)

  if (!isAttestableSuperchatPayment(event) || !getSuperchatAttestationTargetKindValue(event)) {
    return null
  }
  if (!pubkey || !recipientPubkey || recipientPubkey.toLowerCase() !== pubkey.toLowerCase()) {
    return null
  }
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
    checkLogin(async () => {
      setPublishing(true)
      try {
        const draft = await createPaymentAttestationDraftEvent(event, { addClientTag: true })
        await publish(draft, { disableFallbacks: true })
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
