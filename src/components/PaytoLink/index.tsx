import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import PaytoTypeIcon from '@/components/PaytoTypeIcon'
import {
  parsePaytoUri,
  buildPaytoUri,
  getCanonicalPaytoType,
  getPaytoTypeInfo,
  isKnownPaytoType,
  flattenPaytoLinkChildText,
  formatPaytoLinkDisplayText,
  paytoLinkChildTextLooksLikeAuthority
} from '@/lib/payto'
import { NostrEvent } from 'nostr-tools'
import PaytoDialog from '@/components/PaytoDialog'
import { URI_LINK_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'
import type { PostPaymentContext } from '@/lib/post-payment-context'

export default function PaytoLink({
  paytoUri,
  type: typeProp,
  authority: authorityProp,
  pubkey,
  offerTipNoticeOnClose = true,
  onPostPaymentRequest,
  referencedEvent,
  className,
  children,
  /** `compact`: `47R4Npvudm... (Monero)` for notes/markup; `full`: show authority as-is (e.g. zap dialog). */
  displayFormat = 'compact',
  /** When set (e.g. Markdown link title), used as the native `title` tooltip instead of the default payto hint. */
  linkTitle
}: {
  paytoUri?: string
  type?: string
  authority?: string
  pubkey?: string
  /** Passed to PaytoDialog; set false when a parent already offers the post-payment prompt. */
  offerTipNoticeOnClose?: boolean
  /** Parent-owned post-payment prompt (e.g. ZapDialog). */
  onPostPaymentRequest?: (context: PostPaymentContext) => void
  /** Thread context for superchat requests (kind 9740). */
  referencedEvent?: NostrEvent
  className?: string
  children?: React.ReactNode
  displayFormat?: 'compact' | 'full'
  linkTitle?: string
}) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)

  const parsed = paytoUri
    ? parsePaytoUri(paytoUri)
    : typeProp && authorityProp
      ? {
          type: getCanonicalPaytoType(typeProp),
          authority: authorityProp,
          raw: buildPaytoUri(typeProp, authorityProp)
        }
      : null

  if (!parsed) {
    return children ? <span className={className}>{children}</span> : null
  }

  const { type, authority, raw } = parsed
  const info = getPaytoTypeInfo(type)
  const known = isKnownPaytoType(type)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!known) {
      navigator.clipboard.writeText(raw)
      toast.success(t('Copied payto address'))
      return
    }
    setDialogOpen(true)
  }

  const displayLabel = info?.label ?? type
  const categoryLabel = (() => {
    const c = info?.category
    if (!c) return ''
    if (c === 'bitcoin-layer') return 'Bitcoin layer'
    return c.charAt(0).toUpperCase() + c.slice(1)
  })()
  const childText = flattenPaytoLinkChildText(children)
  const useCompactDisplay =
    displayFormat === 'compact' &&
    (!children || paytoLinkChildTextLooksLikeAuthority(childText, authority, raw))
  const content = useCompactDisplay ? (
    <span>{formatPaytoLinkDisplayText(type, authority)}</span>
  ) : children != null && children !== false ? (
    children
  ) : (
    <span className="break-all">{authority}</span>
  )
  const overrideTip = linkTitle?.trim()
  const fullAddressTip = `${displayLabel}: ${authority}`
  const paymentOptionsTip = known
    ? categoryLabel
      ? `${displayLabel} (${categoryLabel}): ${t('Click to open payment options')}`
      : `${displayLabel}: ${t('Click to open payment options')}`
    : t('Click to copy address')

  const iconEl = <PaytoTypeIcon type={type} className="w-4 h-4 text-[1rem]" />

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          URI_LINK_CLASS,
          'cursor-pointer text-left inline-flex items-center gap-1.5',
          className
        )}
        title={overrideTip || (useCompactDisplay ? fullAddressTip : paymentOptionsTip)}
      >
        {iconEl}
        {content}
      </button>
      {known && (
        <PaytoDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type={type}
          authority={authority}
          paytoUri={raw}
          recipientPubkey={pubkey}
          offerTipNoticeOnClose={offerTipNoticeOnClose}
          onPostPaymentRequest={onPostPaymentRequest}
          referencedEvent={referencedEvent}
        />
      )}
    </>
  )
}
