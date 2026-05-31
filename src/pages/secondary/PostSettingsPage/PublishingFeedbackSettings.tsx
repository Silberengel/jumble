import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import storage from '@/services/local-storage.service'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PublishingFeedbackSettings() {
  const { t } = useTranslation()
  const [successToasts, setSuccessToasts] = useState(false)
  const [detailedToasts, setDetailedToasts] = useState(true)

  useEffect(() => {
    setSuccessToasts(storage.getShowPublishSuccessToasts())
    setDetailedToasts(storage.getShowDetailedPublishToasts())
  }, [])

  const onSuccessChange = (checked: boolean) => {
    setSuccessToasts(checked)
    storage.setShowPublishSuccessToasts(checked)
  }

  const onDetailedChange = (checked: boolean) => {
    setDetailedToasts(checked)
    storage.setShowDetailedPublishToasts(checked)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Label htmlFor="publish-success-toasts" className="text-base font-normal">
            {t('Publish success toasts')}
          </Label>
          <Switch id="publish-success-toasts" checked={successToasts} onCheckedChange={onSuccessChange} />
        </div>
        <p className="text-muted-foreground text-xs max-w-xl">
          {t('Publish success toasts hint')}
        </p>
      </div>

      {successToasts ? (
        <div className="space-y-2 pl-4 border-l-2 border-border">
          <div className="flex items-center space-x-2">
            <Label htmlFor="detailed-publish-toasts" className="text-base font-normal">
              {t('Publish toast per-relay details')}
            </Label>
            <Switch
              id="detailed-publish-toasts"
              checked={detailedToasts}
              onCheckedChange={onDetailedChange}
            />
          </div>
          <p className="text-muted-foreground text-xs max-w-xl">
            {t('Publish toast per-relay details hint')}
          </p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-xs max-w-xl border-t border-border pt-3">
        {t('Publishing feedback errors note')}
      </p>
    </div>
  )
}
