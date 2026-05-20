import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Copy, ExternalLink, Wallet, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  filterPaytoPaymentOpenHandlersForDevice,
  getPaytoPaymentOpenHandlers,
  getPaytoTypeInfo
} from '@/lib/payto'

export default function PaytoDialog({
  open,
  onOpenChange,
  type,
  authority,
  paytoUri
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: string
  authority: string
  paytoUri: string
}) {
  const { t } = useTranslation()
  const info = getPaytoTypeInfo(type)
  const label = info?.label ?? type
  const isLightning = type.toLowerCase() === 'lightning'
  const openHandlers = filterPaytoPaymentOpenHandlersForDevice(
    getPaytoPaymentOpenHandlers(type, authority)
  )

  const handleCopy = (text: string, copyLabel?: string) => {
    navigator.clipboard.writeText(text)
    toast.success(copyLabel ? t('Copied {{label}} address', { label: copyLabel }) : t('Copied to clipboard'))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isLightning && <Zap className="size-5 text-yellow-400" />}
            <span>{label}</span>
          </DialogTitle>
          <DialogDescription>
            {isLightning
              ? t('Lightning payment address – copy to pay via your wallet')
              : t('Payment address – copy to use in your wallet or app')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pb-2">
          <div className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all select-text">
            {authority}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => handleCopy(authority, label)}
              className="gap-2"
            >
              <Copy className="size-4" />
              {t('Copy address')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleCopy(paytoUri)}
              className="gap-2"
            >
              <Copy className="size-4" />
              {t('Copy payto URI')}
            </Button>
          </div>
          {openHandlers.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-sm font-medium text-muted-foreground">{t('Open with')}</p>
              <div className="flex flex-wrap gap-2">
                {openHandlers.map((handler) => (
                  <Button key={handler.id} variant="outline" size="sm" asChild className="gap-2">
                    <a
                      href={handler.href}
                      {...(handler.isHttp
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {handler.isHttp ? (
                        <ExternalLink className="size-4" />
                      ) : (
                        <Wallet className="size-4" />
                      )}
                      {t('Open in {{name}}', { name: handler.openTargetName })}
                    </a>
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
