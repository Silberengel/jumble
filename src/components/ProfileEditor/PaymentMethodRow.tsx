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
  isPaytoEditorCustomType,
  PAYTO_EDITOR_OTHER_OPTION,
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
  const selectTypes = paytoEditorSelectTypes()
  const isCustomType = isPaytoEditorCustomType(row.type)
  const canonicalType =
    isCustomType && row.type !== PAYTO_EDITOR_OTHER_OPTION
      ? getCanonicalPaytoType(row.type)
      : isCustomType
        ? 'other'
        : getCanonicalPaytoType(row.type || 'lightning')
  const fieldHelp = getPaytoAuthorityFieldHelp(isCustomType ? '' : canonicalType)
  const selectValue = isCustomType ? PAYTO_EDITOR_OTHER_OPTION : canonicalType
  const customTypeInputValue = row.type === PAYTO_EDITOR_OTHER_OPTION ? '' : row.type

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      {isCustomType ? (
        <div className="w-full sm:w-[11.5rem] shrink-0 space-y-1">
          <Input
            value={customTypeInputValue}
            onChange={(e) => onChange({ ...row, type: e.target.value })}
            placeholder={t('paytoEditor.customTypePlaceholder', {
              defaultValue: 'Custom type (e.g. mycoin)'
            })}
            className="text-sm font-medium"
            aria-label={t('paytoEditor.customTypeLabel', { defaultValue: 'Custom payment type' })}
          />
          <p className="text-xs text-muted-foreground leading-snug">
            {t('paytoEditor.customTypeHint', {
              defaultValue:
                'This is for custom options not in the list. Use lowercase letters, numbers, and hyphens in the type name.'
            })}
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-muted-foreground"
            onClick={() => onChange({ ...row, type: 'lightning' })}
          >
            {t('paytoEditor.choosePresetType', { defaultValue: 'Choose from list' })}
          </Button>
        </div>
      ) : (
        <Select
          value={selectValue}
          onValueChange={(type) => {
            if (type === PAYTO_EDITOR_OTHER_OPTION) {
              onChange({ ...row, type: PAYTO_EDITOR_OTHER_OPTION })
            } else {
              onChange({ ...row, type })
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-[11.5rem] shrink-0 font-medium text-sm">
            <SelectValue placeholder={t('Payment type')} />
          </SelectTrigger>
          <SelectContent className="max-h-[min(20rem,70vh)]">
            {selectTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type === PAYTO_EDITOR_OTHER_OPTION
                  ? t('paytoEditor.other', { defaultValue: 'Other' })
                  : getPaytoEditorTypeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="w-full min-w-0 flex-1 space-y-1">
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
        className="shrink-0 self-end text-muted-foreground hover:text-destructive sm:mt-0.5"
        onClick={onRemove}
        aria-label={t('Remove')}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
