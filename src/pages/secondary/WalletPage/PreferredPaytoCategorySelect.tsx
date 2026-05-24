import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { usePreferredPaytoCategory } from '@/hooks/usePreferredPaytoCategory'
import {
  isPaytoCategory,
  PAYTO_CATEGORIES,
  paytoCategoryTranslationKey
} from '@/lib/payto-category-display'
import { SelectValue } from '@radix-ui/react-select'
import { useTranslation } from 'react-i18next'

const SHOW_ALL_VALUE = '__all__'

export default function PreferredPaytoCategorySelect() {
  const { t } = useTranslation()
  const { preferredPaytoCategory, setPreferredPaytoCategory } = usePreferredPaytoCategory()

  return (
    <div className="w-full space-y-1">
      <Label htmlFor="preferred-payto-category">{t('Preferred payto category')}</Label>
      <p className="text-sm text-muted-foreground">
        {t(
          'Show this category expanded on payment method lists; other categories collapse behind an accordion.'
        )}
      </p>
      <Select
        value={preferredPaytoCategory ?? SHOW_ALL_VALUE}
        onValueChange={(value) => {
          if (value === SHOW_ALL_VALUE) {
            setPreferredPaytoCategory(null)
            return
          }
          if (isPaytoCategory(value)) {
            setPreferredPaytoCategory(value)
          }
        }}
      >
        <SelectTrigger id="preferred-payto-category" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SHOW_ALL_VALUE}>{t('Show all categories')}</SelectItem>
          {PAYTO_CATEGORIES.map((category) => (
            <SelectItem key={category} value={category}>
              {t(paytoCategoryTranslationKey(category))}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
