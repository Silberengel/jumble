import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useZap } from '@/providers/ZapProvider'
import { useTranslation } from 'react-i18next'

export default function IncludePublicZapReceiptSwitch() {
  const { t } = useTranslation()
  const { includePublicZapReceipt, updateIncludePublicZapReceipt } = useZap()

  return (
    <div className="flex w-full items-center justify-between gap-3">
      <Label htmlFor="include-public-zap-receipt-switch" className="flex-1">
        <div className="text-base font-medium">{t('Include public zap receipt')}</div>
        <div className="text-sm font-normal text-muted-foreground">
          {t('When off, your zap may still succeed but a public receipt may not be published to relays')}
        </div>
      </Label>
      <Switch
        id="include-public-zap-receipt-switch"
        checked={includePublicZapReceipt}
        onCheckedChange={updateIncludePublicZapReceipt}
      />
    </div>
  )
}
