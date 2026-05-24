import PaytoLink from '@/components/PaytoLink'
import type { PaymentMethodGroup } from '@/lib/merge-payment-methods'
import { PRIMARY_LINK_HOVER_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { NostrEvent } from 'nostr-tools'
import type { PostPaymentContext } from '@/lib/post-payment-context'

export default function PaymentMethodsSection({
  groups,
  recipientPubkey,
  referencedEvent,
  offerTipNoticeOnClose = true,
  onPostPaymentRequest,
  title,
  className
}: {
  groups: PaymentMethodGroup[]
  recipientPubkey?: string
  /** Thread context passed to PaytoDialog for superchat requests. */
  referencedEvent?: NostrEvent
  /** When false, PaytoDialog defer post-payment prompt to parent. */
  offerTipNoticeOnClose?: boolean
  onPostPaymentRequest?: (context: PostPaymentContext) => void
  title?: string
  className?: string
}) {
  const { t } = useTranslation()

  if (groups.length === 0) return null

  return (
    <div className={className}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        {title ?? t('Payment Methods')}
      </div>
      <div className="space-y-3 min-w-0">
        {groups.map((group, groupIdx) => (
          <div key={groupIdx} className="text-sm min-w-0">
            <div className="font-medium">{group.displayType}</div>
            <div className="space-y-1.5 mt-1">
              {group.methods.map((method, idx) => (
                <div key={idx} className="min-w-0">
                  {method.authority && (
                    <div className="text-muted-foreground flex items-center gap-1 min-w-0">
                      <PaytoLink
                        type={method.type}
                        authority={method.authority}
                        paytoUri={method.payto}
                        displayFormat="full"
                        pubkey={recipientPubkey}
                        offerTipNoticeOnClose={offerTipNoticeOnClose}
                        onPostPaymentRequest={onPostPaymentRequest}
                        referencedEvent={referencedEvent}
                        className={cn(PRIMARY_LINK_HOVER_CLASS, 'break-all min-w-0 flex-1')}
                      >
                        {method.authority}
                      </PaytoLink>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          navigator.clipboard.writeText(method.authority)
                          toast.success(t('Copied to clipboard'))
                        }}
                        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                        title={t('Copy address')}
                      >
                        <Copy className="size-3.5" />
                      </button>
                    </div>
                  )}
                  {(method.currency ||
                    (method.minAmount !== undefined && method.maxAmount !== undefined)) && (
                    <div className="text-muted-foreground text-xs mt-0.5">
                      {method.currency && <span>({method.currency})</span>}
                      {method.minAmount !== undefined && method.maxAmount !== undefined && (
                        <span className="ml-2">
                          {method.minAmount}-{method.maxAmount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
