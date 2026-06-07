import { Button } from '@/components/ui/button'
import { DEFAULT_CONTENT_WARNING_LABEL } from '@/lib/content-warning'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function NsfwNote({
  show,
  label
}: {
  show: () => void
  label?: string | null
}) {
  const { t } = useTranslation()
  const normalized = label?.trim() || DEFAULT_CONTENT_WARNING_LABEL
  const heading =
    normalized.toLowerCase() === DEFAULT_CONTENT_WARNING_LABEL.toLowerCase()
      ? t('🔞 NSFW 🔞')
      : t('Content warning label', { label: normalized })

  return (
    <div className="flex flex-col gap-2 items-center text-muted-foreground font-medium my-4">
      <div className="text-center px-4">{heading}</div>
      <Button
        onClick={(e) => {
          e.stopPropagation()
          show()
        }}
        variant="outline"
      >
        <Eye />
        {t('Temporarily display this note')}
      </Button>
    </div>
  )
}
