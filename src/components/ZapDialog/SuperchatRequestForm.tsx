import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { ExtendedKind } from '@/constants'
import { createPaymentNotificationDraftEvent } from '@/lib/draft-event'
import { createFakeEvent } from '@/lib/event'
import { clampZapSats, formatSatsGrouped, parseGroupedIntegerInput } from '@/lib/lightning'
import { parsePaytoTagType } from '@/lib/payto'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { paymentNotificationReferenceTags, type PostPaymentContext } from '@/lib/post-payment-context'
import { showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import SatsAmountEquivalents from '@/components/SatsAmountEquivalents'
import MarkdownArticle from '../Note/MarkdownArticle/MarkdownArticle'
import SuperchatPaymentMethodLabel from '../Note/SuperchatPaymentMethodLabel'

export default function SuperchatRequestForm({
  recipientPubkey,
  paymentContext,
  onBack,
  onDone
}: {
  recipientPubkey: string
  paymentContext?: PostPaymentContext | null
  onBack: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const { publish, checkLogin, pubkey: selfPubkey } = useNostr()
  const [message, setMessage] = useState('')
  const [amountSats, setAmountSats] = useState(() =>
    paymentContext?.amountMsat ? clampZapSats(Math.floor(paymentContext.amountMsat / 1000)) : 0
  )
  const [minPow, setMinPow] = useState(0)
  const [sending, setSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const amountMsat = amountSats > 0 ? clampZapSats(amountSats) * 1000 : undefined

  useEffect(() => {
    const id = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const previewEvent = useMemo(() => {
    const tags: string[][] = [['p', recipientPubkey]]
    if (amountMsat) {
      tags.push(['amount', String(amountMsat)])
    }
    if (paymentContext?.payto) {
      tags.push(['payto', paymentContext.payto])
    }
    tags.push(...paymentNotificationReferenceTags(paymentContext?.referencedEvent))
    return createFakeEvent({
      kind: ExtendedKind.PAYMENT_NOTIFICATION,
      pubkey: selfPubkey ?? '',
      content: message,
      tags
    })
  }, [amountMsat, message, paymentContext, recipientPubkey, selfPubkey])

  const handleSend = () => {
    const trimmed = message.trim()
    if (!trimmed) return
    checkLogin(async () => {
      setSending(true)
      try {
        const draft = await createPaymentNotificationDraftEvent(trimmed, recipientPubkey, {
          amountMsat,
          payto: paymentContext?.payto,
          referencedEvent: paymentContext?.referencedEvent,
          addClientTag: true
        })
        await publish(draft, { disableFallbacks: true, minPow })
        showSimplePublishSuccess(t('Superchat request sent'))
        onDone()
      } catch (error) {
        if (error instanceof LoginRequiredError) return
        toast.error(
          t('Failed to send superchat request', {
            error: error instanceof Error ? error.message : String(error)
          })
        )
      } finally {
        setSending(false)
      }
    })
  }

  const paytoType = paymentContext?.payto ? parsePaytoTagType(paymentContext.payto) : null

  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{t('Superchat request prompt description')}</p>
      {paytoType ? (
        <div className="mt-3">
          <SuperchatPaymentMethodLabel paytoType={paytoType} />
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        <Label htmlFor="superchat-amount">{t('Superchat estimated amount (sats)')}</Label>
        <SatsAmountEquivalents sats={amountSats} id="superchat-amount-equiv" />
        <div className="flex min-w-0 items-center gap-2">
          <Input
            id="superchat-amount"
            inputMode="numeric"
            value={amountSats > 0 ? formatSatsGrouped(amountSats) : ''}
            onChange={(e) => setAmountSats(parseGroupedIntegerInput(e.target.value))}
            placeholder="0"
            disabled={sending}
            className="min-w-0 flex-1 tabular-nums"
            aria-describedby="superchat-amount-equiv superchat-amount-hint"
          />
          <span className="shrink-0 text-sm text-muted-foreground">{t('sats')}</span>
        </div>
        <p id="superchat-amount-hint" className="text-xs text-muted-foreground">
          {t('Superchat estimated amount hint')}
        </p>
      </div>
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={sending}
        rows={5}
        className="mt-3 min-h-[8rem] resize-y text-sm leading-relaxed"
        aria-label={t('Superchat message')}
        placeholder={t('Superchat message placeholder')}
      />
      <div className="mt-4 grid gap-2">
        <Label htmlFor="superchat-pow">{t('Proof of Work (difficulty {{minPow}})', { minPow })}</Label>
        <Slider
          id="superchat-pow"
          value={[minPow]}
          onValueChange={([pow]) => setMinPow(pow)}
          max={28}
          step={1}
          disabled={sending}
        />
      </div>
      {previewEvent && message.trim() ? (
        <div className="mt-4 min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{t('Preview')}</p>
          <div
            className={cn(
              'mt-1.5 max-h-48 min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-border',
              'bg-muted/25 px-3 py-2'
            )}
          >
            <MarkdownArticle event={previewEvent} hideMetadata lazyMedia={false} className="text-sm" />
          </div>
        </div>
      ) : null}
      <DialogFooter className="mt-4 flex w-full min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="w-full min-w-0 sm:w-auto" onClick={onBack} disabled={sending}>
          {t('Back')}
        </Button>
        <Button
          type="button"
          className="w-full min-w-0 sm:w-auto"
          onClick={handleSend}
          disabled={sending || !message.trim()}
        >
          {t('Send superchat request')}
        </Button>
      </DialogFooter>
    </div>
  )
}
