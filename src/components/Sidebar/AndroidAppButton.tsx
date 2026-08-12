import { IMWALD_ANDROID_ZAPSTORE_URL } from '@/constants'
import { Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Compact Zapstore link — keep out of the main nav row height. */
export default function AndroidAppButton() {
  const { t } = useTranslation()
  const label = t('Download the Android app')

  return (
    <a
      href={IMWALD_ANDROID_ZAPSTORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="mt-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-muted-foreground xl:justify-start xl:px-3"
    >
      <Smartphone className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="max-xl:hidden truncate text-[11px] font-medium leading-tight">{label}</span>
    </a>
  )
}
