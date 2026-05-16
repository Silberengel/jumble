import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

export default function NotFound({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()

  return (
    <div className="text-muted-foreground w-full h-full flex flex-col items-center justify-center gap-2 px-4">
      <div>{t('Lost in the void')} 🌌</div>
      <div>(404)</div>
      {children}
    </div>
  )
}
