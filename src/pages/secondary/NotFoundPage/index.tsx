import NotFound from '@/components/NotFound'
import { RefreshButton } from '@/components/RefreshButton'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { forwardRef, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

const NotFoundPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const [contentKey, setContentKey] = useState(0)
  const bump = useCallback(() => setContentKey((k) => k + 1), [])
  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={t('Lost in the void')}
      hideBackButton={false}
      controls={<RefreshButton onClick={bump} />}
    >
      <div key={contentKey}>
        <NotFound />
      </div>
    </SecondaryPageLayout>
  )
})
NotFoundPage.displayName = 'NotFoundPage'
export default NotFoundPage
