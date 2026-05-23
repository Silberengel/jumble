import QrCode from '@/components/QrCode'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { LIGHTNING_WALLET_PAY_ENABLED } from '@/constants'
import {
  clampZapSats,
  formatAmount,
  formatSatsGrouped,
  getAmountFromInvoice,
  parseGroupedIntegerInput
} from '@/lib/lightning'
import { buildPaytoUri, formatPaytoTagValue } from '@/lib/payto'
import { superchatLightningAccentClass } from '@/lib/superchat-ui'
import { cn } from '@/lib/utils'
import { useZap } from '@/providers/ZapProvider'
import lightning from '@/services/lightning.service'
import { Check, Copy, Wallet, Zap } from 'lucide-react'
import { closeModal } from '@getalby/bitcoin-connect-react'
import { releaseBodyScrollLocks } from '@/lib/react-remove-scroll-body-cleanup'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const PRESET_SATS = [21, 210, 420, 1000, 2100, 10_000, 21_000]

function invoiceQrPayload(pr: string): string {
  const trimmed = pr.trim()
  if (trimmed.toLowerCase().startsWith('lightning:')) return trimmed
  return `lightning:${trimmed}`
}

export default function LightningInvoiceSection({
  lightningAddress,
  paytoUri,
  onBolt11InvoiceChange,
  onPaymentFlowComplete
}: {
  lightningAddress: string
  paytoUri: string
  /** Fired when a BOLT11 invoice is created or cleared (for Phoenix / external wallet links). */
  onBolt11InvoiceChange?: (invoice: string | null) => void
  /** After a wallet payment succeeds (dialog stays open for the user to choose next steps). */
  onPaymentFlowComplete?: (details?: { amountMsat: number; payto: string }) => void
}) {
  const { t } = useTranslation()
  const { defaultZapSats, isWalletConnected } = useZap()
  const [sats, setSats] = useState(() => clampZapSats(defaultZapSats))
  const [description, setDescription] = useState('')
  const [commentMax, setCommentMax] = useState<number | null>(null)
  const [lnurlMetadataState, setLnurlMetadataState] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  )
  const [invoice, setInvoice] = useState<string | null>(null)
  const [invoiceDescription, setInvoiceDescription] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      closeModal()
      releaseBodyScrollLocks()
    }
  }, [])

  useEffect(() => {
    setSats(clampZapSats(defaultZapSats))
    setDescription('')
    setInvoice(null)
    setInvoiceDescription(null)
    setCommentMax(null)
    setLnurlMetadataState('loading')
    let cancelled = false
    void lightning.getLnurlPayInvoiceOptions(lightningAddress).then((opts) => {
      if (!cancelled && mountedRef.current) {
        if (opts) {
          setCommentMax(opts.commentAllowed)
          setLnurlMetadataState('ready')
        } else {
          setCommentMax(0)
          setLnurlMetadataState('error')
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [lightningAddress, defaultZapSats])

  useEffect(() => {
    setInvoice(null)
    setInvoiceDescription(null)
  }, [sats, description])

  useEffect(() => {
    onBolt11InvoiceChange?.(invoice)
  }, [invoice, onBolt11InvoiceChange])

  const invoiceSats = useMemo(() => {
    if (!invoice) return null
    try {
      return getAmountFromInvoice(invoice)
    } catch {
      return null
    }
  }, [invoice])

  const invoiceQrValue = useMemo(
    () => (invoice ? invoiceQrPayload(invoice) : ''),
    [invoice]
  )

  const handleCreateInvoice = async () => {
    try {
      setCreating(true)
      const trimmedDesc = description.trim()
      const pr = await lightning.createLnurlInvoice(lightningAddress, sats, {
        description: trimmedDesc || undefined
      })
      if (!mountedRef.current) return
      setInvoice(pr)
      setInvoiceDescription(trimmedDesc || null)
    } catch (error) {
      if (mountedRef.current) {
        toast.error(`${t('Failed to create invoice')}: ${(error as Error).message}`)
      }
    } finally {
      if (mountedRef.current) setCreating(false)
    }
  }

  const paymentDetails = useMemo(
    () => ({
      amountMsat: clampZapSats(sats) * 1000,
      payto: formatPaytoTagValue(buildPaytoUri('lightning', lightningAddress))
    }),
    [sats, lightningAddress]
  )

  const handlePay = async () => {
    if (!invoice) return
    try {
      setPaying(true)
      const result = await lightning.payInvoice(invoice, undefined, (flowResult) => {
        if (flowResult) onPaymentFlowComplete?.(paymentDetails)
      })
      if (!mountedRef.current) return
      if (result) {
        toast.success(t('Payment sent'))
        setInvoice(null)
        setInvoiceDescription(null)
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(`${t('Lightning payment failed')}: ${(error as Error).message}`)
      }
    } finally {
      if (mountedRef.current) setPaying(false)
    }
  }

  const copyText = (text: string, message?: string) => {
    navigator.clipboard.writeText(text)
    toast.success(message ?? t('Copied to clipboard'))
  }

  return (
    <section
      className="min-w-0 space-y-5 rounded-xl border border-border/80 bg-muted/25 p-4 sm:p-5 text-base"
      aria-label={t('Lightning payment')}
    >
      <div className="min-w-0 rounded-lg bg-background/90 px-3 py-2.5 ring-1 ring-border/60">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('Pay to')}
        </p>
        <p className="break-all text-base font-medium leading-snug sm:text-lg">{lightningAddress}</p>
      </div>

      <div className="min-w-0 space-y-3">
        <Label htmlFor="ln-invoice-sats" className="text-sm font-medium text-muted-foreground sm:text-base">
          {t('Amount (sats)')}
        </Label>
        <div className="flex min-w-0 items-center gap-3">
          <Input
            id="ln-invoice-sats"
            inputMode="numeric"
            value={sats === 0 ? '' : formatSatsGrouped(sats)}
            onChange={(e) => setSats(parseGroupedIntegerInput(e.target.value))}
            className="h-12 min-w-0 flex-1 text-xl font-semibold tabular-nums sm:h-14 sm:text-2xl"
            aria-describedby="ln-invoice-preset-hint"
          />
          <span className="shrink-0 text-base font-medium text-muted-foreground sm:text-lg">{t('sats')}</span>
        </div>
        <div
          id="ln-invoice-preset-hint"
          className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-6"
          role="group"
          aria-label={t('Amount (sats)')}
        >
          {PRESET_SATS.map((preset) => {
            const active = sats === preset
            return (
              <Button
                key={preset}
                type="button"
                variant={active ? 'default' : 'outline'}
                size="default"
                className={cn(
                  'h-10 min-w-0 px-1.5 text-sm tabular-nums sm:text-base',
                  active && 'ring-1 ring-amber-600/45 dark:ring-yellow-400/50'
                )}
                onClick={() => setSats(preset)}
              >
                {formatAmount(preset)}
              </Button>
            )
          })}
        </div>
      </div>

      {lnurlMetadataState === 'loading' ? (
        <Skeleton className="h-[4.5rem] w-full rounded-lg" aria-hidden />
      ) : lnurlMetadataState === 'error' ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t(
            'Could not read this Lightning address (network or browser block). Descriptions need LNURL-pay support on the recipient side.'
          )}
        </p>
      ) : (commentMax ?? 0) > 0 ? (
        <div className="min-w-0 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="ln-invoice-description" className="text-sm font-medium text-muted-foreground sm:text-base">
              {t('Description (optional)')}
            </Label>
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {description.length}/{commentMax ?? 0}
            </span>
          </div>
          <Textarea
            id="ln-invoice-description"
            value={description}
            onChange={(e) =>
              setDescription(e.target.value.slice(0, commentMax ?? 0))
            }
            maxLength={commentMax ?? 0}
            rows={3}
            placeholder={t('Payment description')}
            className="min-h-[5rem] resize-none text-base leading-relaxed sm:text-lg"
          />
        </div>
      ) : (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {t('This address does not support payment descriptions.')}
        </p>
      )}

      {!invoice ? (
        <Button
          type="button"
          className="h-12 w-full gap-2 text-base sm:h-14 sm:text-lg"
          disabled={creating || sats < 1}
          onClick={() => void handleCreateInvoice()}
        >
          {creating ? (
            <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden />
          ) : (
            <Zap className={cn('size-5 shrink-0', superchatLightningAccentClass)} />
          )}
          {t('Create invoice')}
        </Button>
      ) : null}

      {invoice ? (
        <div
          className="min-w-0 space-y-3 rounded-lg border border-green-500/35 bg-green-500/[0.07] p-3 sm:p-4"
          role="status"
          aria-live="polite"
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-green-500/20">
              <Check className="size-5 text-green-600 dark:text-green-400" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium uppercase tracking-wide text-green-700 dark:text-green-400">
                {t('Invoice ready')}
              </p>
              {invoiceSats != null ? (
                <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">
                  {formatSatsGrouped(invoiceSats)}{' '}
                  <span className="text-base font-semibold text-muted-foreground sm:text-lg">{t('sats')}</span>
                </p>
              ) : null}
              {invoiceDescription ? (
                <p className="mt-2 text-base leading-snug text-foreground/90 break-words sm:text-lg">
                  {invoiceDescription}
                </p>
              ) : null}
            </div>
          </div>

          <div
            className="flex min-w-0 flex-col items-center gap-2"
            role="img"
            aria-label={t('Scan to pay with a Lightning wallet')}
          >
            <div className="w-full max-w-[min(100%,240px)]">
              <QrCode value={invoiceQrValue} size={240} />
            </div>
            <p className="text-center text-sm text-muted-foreground sm:text-base">
              {t('Scan to pay with a Lightning wallet')}
            </p>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('BOLT11 invoice')}
            </p>
            <div className="max-h-32 min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-background/80 p-3 ring-1 ring-border/50">
              <p className="select-text break-all font-mono text-sm leading-relaxed text-muted-foreground sm:text-base">
                {invoice}
              </p>
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="secondary"
              className="h-11 w-full min-w-0 gap-2 text-base"
              onClick={() => copyText(invoice)}
            >
              <Copy className="size-5 shrink-0" />
              <span className="truncate">{t('Copy invoice')}</span>
            </Button>
            {LIGHTNING_WALLET_PAY_ENABLED ? (
              <Button
                type="button"
                variant="default"
                className="h-11 w-full min-w-0 gap-2 text-base"
                disabled={paying}
                onClick={() => void handlePay()}
              >
                {paying ? (
                  <Skeleton className="size-5 shrink-0 rounded-full" aria-hidden />
                ) : (
                  <Wallet className="size-5 shrink-0" />
                )}
                <span className="truncate">
                  {isWalletConnected ? t('Pay with connected wallet') : t('Open in wallet')}
                </span>
              </Button>
            ) : null}
          </div>

          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full text-base text-muted-foreground"
            onClick={() => void handleCreateInvoice()}
            disabled={creating}
          >
            {t('Regenerate invoice')}
          </Button>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-2 border-t border-border/60 pt-3 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 flex-1 gap-2 text-base"
          onClick={() => copyText(lightningAddress, t('Copied {{label}} address', { label: 'Lightning' }))}
        >
          <Copy className="size-5 shrink-0" />
          <span className="truncate">{t('Copy address')}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 flex-1 gap-2 text-base"
          onClick={() => copyText(paytoUri)}
        >
          <Copy className="size-5 shrink-0" />
          <span className="truncate">{t('Copy payto URI')}</span>
        </Button>
      </div>
    </section>
  )
}
