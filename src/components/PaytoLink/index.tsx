import { ZAP_SENDING_ENABLED } from '@/constants'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  parsePaytoUri,
  buildPaytoUri,
  getCanonicalPaytoType,
  getPaytoTypeInfo,
  getPaytoIconChar,
  getPaytoLogoPath,
  isKnownPaytoType,
  isLightningPaytoType,
  isZappableLightningPaytoType,
  flattenPaytoLinkChildText,
  formatPaytoLinkDisplayText,
  paytoLinkChildTextLooksLikeAuthority
} from '@/lib/payto'
import PaytoDialog from '@/components/PaytoDialog'
import { HelpCircle } from 'lucide-react'
import { URI_LINK_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'

export default function PaytoLink({
  paytoUri,
  type: typeProp,
  authority: authorityProp,
  pubkey,
  onOpenZap,
  offerTipNoticeOnClose = true,
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
  /** When set with lightning type, clicking can open Zap dialog via onOpenZap */
  pubkey?: string
  onOpenZap?: (pubkey: string, lightningAuthority: string) => void
  /** Passed to PaytoDialog; set false when a parent already offers the tip notice on close. */
  offerTipNoticeOnClose?: boolean
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
  const isLightning = isLightningPaytoType(type)
  const canZap =
    ZAP_SENDING_ENABLED && isZappableLightningPaytoType(type) && !!pubkey && !!onOpenZap

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (canZap) {
      onOpenZap(pubkey!, authority)
      return
    }
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
  const logoPath = getPaytoLogoPath(type)
  const iconChar = getPaytoIconChar(type)
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

  const iconEl = (
    <span className="shrink-0 flex items-center justify-center w-4 h-4 text-[1rem] leading-none" aria-hidden>
      {logoPath ? (
        <img src={logoPath} alt="" className="size-4 object-contain" />
      ) : iconChar != null ? (
        <span className={cn(
          'inline-flex items-center justify-center',
          isLightning && 'text-yellow-400'
        )}>
          {iconChar}
        </span>
      ) : (
        <HelpCircle className="size-3.5 text-muted-foreground" />
      )}
    </span>
  )

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
      {known && !canZap && (
        <PaytoDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type={type}
          authority={authority}
          paytoUri={raw}
          recipientPubkey={pubkey}
          offerTipNoticeOnClose={offerTipNoticeOnClose}
        />
      )}
    </>
  )
}
