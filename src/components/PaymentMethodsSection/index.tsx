import PaytoLink from '@/components/PaytoLink'
import type { PaymentMethodGroup } from '@/lib/merge-payment-methods'
import { isLightningPaytoType } from '@/lib/payto'
import { cn } from '@/lib/utils'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function PaymentMethodsSection({
  groups,
  recipientPubkey,
  onOpenZap,
  title,
  className,
  headerHelpText
}: {
  groups: PaymentMethodGroup[]
  recipientPubkey?: string
  /** When set, lightning rows open the zap flow with that address as the default. */
  onOpenZap?: (lightningAuthority: string) => void
  title?: string
  className?: string
  /** Prominent note above the list (e.g. on-chain Bitcoin eligibility in zap dialog). */
  headerHelpText?: string
}) {
  const { t } = useTranslation()

  if (groups.length === 0) return null

  return (
    <div className={className}>
      <div className="text-xs font-semibold text-muted-foreground mb-2">
        {title ?? t('Payment Methods')}
      </div>
      {headerHelpText ? (
        <p
          className="mb-3 rounded-md border border-amber-500/45 bg-amber-500/15 px-3 py-2.5 text-sm font-semibold leading-snug text-foreground"
          role="note"
        >
          {headerHelpText}
        </p>
      ) : null}
      <div className="space-y-3 min-w-0">
        {groups.map((group, groupIdx) => (
          <div
            key={groupIdx}
            className={cn(
              'text-sm min-w-0',
              group.highlighted &&
                'rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-2'
            )}
          >
            <div className={cn('font-medium', group.highlighted && 'text-foreground')}>
              {group.displayType}
            </div>
            <div className="space-y-1.5 mt-1">
              {group.methods.map((method, idx) => (
                <div key={idx} className="min-w-0">
                  {method.authority && (
                    <div className="text-muted-foreground flex items-center gap-1 min-w-0">
                      <PaytoLink
                        type={method.type}
                        authority={method.authority}
                        paytoUri={method.payto}
                        pubkey={isLightningPaytoType(method.type) ? recipientPubkey : undefined}
                        onOpenZap={
                          isLightningPaytoType(method.type) && onOpenZap
                            ? (_pk, authority) => onOpenZap(authority)
                            : undefined
                        }
                        className="hover:underline break-all min-w-0 text-primary flex-1"
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
