import { Button } from '@/components/ui/button'
import { BookOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Shown when local/relay search finished with zero events; opens Alexandria with a matching query. */
export function AlexandriaEventsSearchEmptyCta({ href }: { href: string }) {
  const { t } = useTranslation()
  return (
    <Button variant="outline" size="sm" className="mt-3 gap-2" asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <BookOpen className="h-4 w-4 shrink-0" aria-hidden />
        {t('Search on Alexandria')}
      </a>
    </Button>
  )
}
