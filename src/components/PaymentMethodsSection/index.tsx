import PaytoLink from '@/components/PaytoLink'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { usePreferredPaytoCategory } from '@/hooks/usePreferredPaytoCategory'
import type { PaymentMethodGroup } from '@/lib/merge-payment-methods'
import { partitionPaymentGroupsByPreferredCategory } from '@/lib/payto-category-display'
import { PRIMARY_LINK_HOVER_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'
import { ChevronDown, Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { NostrEvent } from 'nostr-tools'
import type { PostPaymentContext } from '@/lib/post-payment-context'

function PaymentMethodGroupsList({
  groups,
  recipientPubkey,
  referencedEvent,
  offerTipNoticeOnClose,
  onPostPaymentRequest
}: {
  groups: PaymentMethodGroup[]
  recipientPubkey?: string
  referencedEvent?: NostrEvent
  offerTipNoticeOnClose: boolean
  onPostPaymentRequest?: (context: PostPaymentContext) => void
}) {
  const { t } = useTranslation()

  return (
    <>
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
    </>
  )
}

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
  const { preferredPaytoCategory } = usePreferredPaytoCategory()
  const [otherCategoriesOpen, setOtherCategoriesOpen] = useState(false)

  const { preferredGroups, otherGroups } = useMemo(
    () => partitionPaymentGroupsByPreferredCategory(groups, preferredPaytoCategory),
    [groups, preferredPaytoCategory]
  )

  if (groups.length === 0) return null

  const listProps = {
    recipientPubkey,
    referencedEvent,
    offerTipNoticeOnClose,
    onPostPaymentRequest
  }

  return (
    <div className={className}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        {title ?? t('Payment Methods')}
      </div>
      <div className="space-y-3 min-w-0">
        <PaymentMethodGroupsList groups={preferredGroups} {...listProps} />
        {otherGroups.length > 0 && (
          <Collapsible
            open={otherCategoriesOpen}
            onOpenChange={setOtherCategoriesOpen}
            className="rounded-lg border border-border/80 bg-muted/20"
          >
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 rounded-lg">
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform [[data-state=open]_&]:rotate-180" />
              <span className="flex-1">
                {t('Other payment categories ({{count}})', { count: otherGroups.length })}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 px-3 pb-3 pt-0">
              <PaymentMethodGroupsList groups={otherGroups} {...listProps} />
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
