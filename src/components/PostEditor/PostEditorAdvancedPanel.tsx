import { MAX_PUBLISH_RELAYS } from '@/constants'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import type { TPrePublishRelayCapPreview } from '@/lib/pre-publish-relay-cap'
import { cn } from '@/lib/utils'
import storage from '@/services/local-storage.service'
import type { Event } from 'nostr-tools'
import { Dispatch, SetStateAction, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Mentions from './Mentions'
import PostRelaySelector from './PostRelaySelector'

export type PostEditorAdvancedPanelProps = {
  show: boolean
  posting: boolean
  addClientTag: boolean
  setAddClientTag: Dispatch<SetStateAction<boolean>>
  isNsfw: boolean
  setIsNsfw: Dispatch<SetStateAction<boolean>>
  minPow: number
  setMinPow: Dispatch<SetStateAction<number>>
  /** Relay picker + cap hints (hidden for modes that do not pick relays). */
  showRelayPicker?: boolean
  setAdditionalRelayUrls?: Dispatch<SetStateAction<string[]>>
  onRelayPublishCapChange?: (preview: TPrePublishRelayCapPreview) => void
  relayParentEvent?: Event
  relayOpenFrom?: string[]
  relayContent?: string
  relayIsPublicMessage?: boolean
  relayMentions?: string[]
  relayCapBlockInfo?: {
    outboxSlotsInPublish: number
    selectedTotal: number
    selectedContacted: number
  } | null
  discussionThreadRelayError?: string | null
  isDiscussionThread?: boolean
  /** Reply / PM mention recipient picker. */
  showMentionsPicker?: boolean
  mentionsContent?: string
  mentionsParentEvent?: Event
  mentions?: string[]
  setMentions?: Dispatch<SetStateAction<string[]>>
}

export default function PostEditorAdvancedPanel({
  show,
  posting,
  addClientTag,
  setAddClientTag,
  isNsfw,
  setIsNsfw,
  minPow,
  setMinPow,
  showRelayPicker = false,
  setAdditionalRelayUrls,
  onRelayPublishCapChange,
  relayParentEvent,
  relayOpenFrom,
  relayContent = '',
  relayIsPublicMessage = false,
  relayMentions = [],
  relayCapBlockInfo = null,
  discussionThreadRelayError = null,
  isDiscussionThread = false,
  showMentionsPicker = false,
  mentionsContent = '',
  mentionsParentEvent,
  mentions = [],
  setMentions
}: PostEditorAdvancedPanelProps) {
  const { t } = useTranslation()

  useEffect(() => {
    setAddClientTag(storage.getAddClientTag())
  }, [setAddClientTag])

  if (!show) return null

  const onAddClientTagChange = (checked: boolean) => {
    storage.setAddClientTag(checked)
    setAddClientTag(checked)
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/25 p-3">
      <div>
        <p className="text-sm font-medium">{t('Advanced')}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('Post editor advanced hint')}</p>
      </div>

      {showMentionsPicker && setMentions ? (
        <div className="space-y-2">
          <Label className="text-sm font-normal">{t('Mentions')}</Label>
          <Mentions
            content={mentionsContent}
            parentEvent={mentionsParentEvent}
            mentions={mentions}
            setMentions={setMentions}
            compactTrigger
          />
        </div>
      ) : null}

      {showRelayPicker && setAdditionalRelayUrls ? (
        <div
          className={cn(
            'space-y-2',
            isDiscussionThread && discussionThreadRelayError && 'rounded-md ring-1 ring-destructive p-2'
          )}
        >
          <Label className="text-sm font-normal">{t('Post to')}</Label>
          <PostRelaySelector
            setAdditionalRelayUrls={setAdditionalRelayUrls}
            onRelayPublishCapChange={onRelayPublishCapChange}
            parentEvent={relayParentEvent}
            openFrom={relayOpenFrom}
            content={relayContent}
            isPublicMessage={relayIsPublicMessage}
            mentions={relayMentions}
          />
          {relayCapBlockInfo ? (
            <p className="text-sm text-amber-600 dark:text-amber-500" role="alert">
              {relayCapBlockInfo.outboxSlotsInPublish > 0
                ? t('Publish relay cap hint with outbox first', {
                    max: MAX_PUBLISH_RELAYS,
                    reservedSlots: relayCapBlockInfo.outboxSlotsInPublish,
                    selected: relayCapBlockInfo.selectedTotal,
                    selectedContacted: relayCapBlockInfo.selectedContacted
                  })
                : t('Publish relay cap hint', {
                    max: MAX_PUBLISH_RELAYS,
                    selected: relayCapBlockInfo.selectedTotal,
                    selectedContacted: relayCapBlockInfo.selectedContacted
                  })}
            </p>
          ) : null}
          {isDiscussionThread && discussionThreadRelayError ? (
            <p className="text-sm text-destructive">{discussionThreadRelayError}</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4 pt-1 border-t border-border">
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Label htmlFor="add-client-tag" className="text-sm font-normal">
              {t('Add client tag')}
            </Label>
            <Switch
              id="add-client-tag"
              checked={addClientTag}
              onCheckedChange={onAddClientTagChange}
              disabled={posting}
            />
          </div>
          <p className="text-muted-foreground text-xs">{t('Show others this was sent via Imwald')}</p>
        </div>

        <div className="flex items-center space-x-2">
          <Label htmlFor="add-nsfw-tag" className="text-sm font-normal">
            {t('NSFW')}
          </Label>
          <Switch
            id="add-nsfw-tag"
            checked={isNsfw}
            onCheckedChange={setIsNsfw}
            disabled={posting}
          />
        </div>

        <div className="grid gap-2">
          <Label className="text-sm font-normal">
            {t('Proof of Work (difficulty {{minPow}})', { minPow })}
          </Label>
          <Slider
            defaultValue={[0]}
            value={[minPow]}
            onValueChange={([pow]) => setMinPow(pow)}
            max={28}
            step={1}
            disabled={posting}
          />
        </div>
      </div>
    </div>
  )
}
