import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  getCanonicalPaytoType,
  getPaytoAuthorityFieldHelp,
  getPaytoEditorTypeLabel,
  paytoEditorSelectTypes
} from '@/lib/payto'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type PaymentMethodRowValue = { type: string; authority: string }

type PaymentMethodRowProps = {
  row: PaymentMethodRowValue
  onChange: (row: PaymentMethodRowValue) => void
  onRemove: () => void
}

export default function PaymentMethodRow({ row, onChange, onRemove }: PaymentMethodRowProps) {
  const { t } = useTranslation()
  const selectTypes = paytoEditorSelectTypes(row.type)
  const canonicalType = getCanonicalPaytoType(row.type || 'lightning')
  const fieldHelp = getPaytoAuthorityFieldHelp(canonicalType)

  return (
    <div className="flex gap-2 items-start">
      <Select
        value={canonicalType}
        onValueChange={(type) => onChange({ ...row, type })}
      >
        <SelectTrigger className="w-[11.5rem] shrink-0 font-medium text-sm">
          <SelectValue placeholder={t('Payment type')} />
        </SelectTrigger>
        <SelectContent className="max-h-[min(20rem,70vh)]">
          {selectTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {getPaytoEditorTypeLabel(type)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1 min-w-0 space-y-1">
        <Input
          value={row.authority}
          onChange={(e) => onChange({ ...row, authority: e.target.value })}
          placeholder={t(`paytoEditor.placeholder.${canonicalType}`, {
            defaultValue: fieldHelp.placeholder
          })}
          className="font-mono text-sm"
          aria-describedby={`payto-hint-${canonicalType}`}
        />
        <p id={`payto-hint-${canonicalType}`} className="text-xs text-muted-foreground leading-snug">
          {t(`paytoEditor.hint.${canonicalType}`, { defaultValue: fieldHelp.hint })}
        </p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
        onClick={onRemove}
        aria-label={t('Remove')}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
