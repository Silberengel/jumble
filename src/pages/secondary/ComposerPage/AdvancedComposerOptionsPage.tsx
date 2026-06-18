import PostEditorAdvancedPanel from '@/components/PostEditor/PostEditorAdvancedPanel'
import { Button } from '@/components/ui/button'
import { useComposerSessionRequired } from '@/contexts/composer-session-context'
import { useTranslation } from 'react-i18next'

export default function AdvancedComposerOptionsPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const { advancedPanelPropsRef } = useComposerSessionRequired()
  const advancedPanelProps = advancedPanelPropsRef.current

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-base font-semibold">{t('Publishing options')}</h1>
        <Button type="button" size="sm" variant="secondary" onClick={onBack}>
          {t('Done')}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain popover-scroll-y p-4 pb-8">
        {advancedPanelProps ? (
          <PostEditorAdvancedPanel {...advancedPanelProps} show />
        ) : (
          <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
        )}
      </div>
    </div>
  )
}
