import { MAX_PUBLISH_RELAYS } from '@/constants'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  CONTENT_WARNING_CUSTOM_SELECT_VALUE,
  CONTENT_WARNING_PRESETS,
  DEFAULT_CONTENT_WARNING_LABEL,
  isPresetContentWarningLabel,
  normalizeContentWarningLabel
} from '@/lib/content-warning'
import type { TPrePublishRelayCapPreview } from '@/lib/pre-publish-relay-cap'
import { cn } from '@/lib/utils'
import storage from '@/services/local-storage.service'
import type { Event } from 'nostr-tools'
import { Dispatch, SetStateAction, useEffect, useMemo } from 'react'
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
  contentWarningLabel: string
  setContentWarningLabel: Dispatch<SetStateAction<string>>
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
  contentWarningLabel,
  setContentWarningLabel,
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

  const onAddClientTagChange = (checked: boolean) => {
    storage.setAddClientTag(checked)
    setAddClientTag(checked)
  }

  const selectValue = useMemo(() => {
    const trimmed = contentWarningLabel.trim()
    if (!trimmed) return DEFAULT_CONTENT_WARNING_LABEL
    if (isPresetContentWarningLabel(trimmed)) return trimmed
    return CONTENT_WARNING_CUSTOM_SELECT_VALUE
  }, [contentWarningLabel])

  // Mentions + relay picker must stay mounted when Advanced is collapsed so auto-selection
  // effects still run (especially on mobile where users often post without opening Advanced).
  return (
    <div className={cn(!show && 'hidden')} aria-hidden={!show}>
      <div className="space-y-4 rounded-lg border border-border bg-muted/25 p-3">
        {show ? (
          <div>
            <p className="text-sm font-medium">{t('Advanced')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Post editor advanced hint')}</p>
          </div>
        ) : null}

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

      {show ? (
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

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Label htmlFor="add-content-warning-tag" className="text-sm font-normal">
                {t('Content warning')}
              </Label>
              <Switch
                id="add-content-warning-tag"
                checked={isNsfw}
                onCheckedChange={(checked) => {
                  setIsNsfw(checked)
                  if (checked) {
                    setContentWarningLabel((prev) => prev.trim() || DEFAULT_CONTENT_WARNING_LABEL)
                  } else {
                    setContentWarningLabel('')
                  }
                }}
                disabled={posting}
              />
            </div>
            <p className="text-muted-foreground text-xs">{t('Content warning hint')}</p>
            {isNsfw ? (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <Select
                  value={selectValue}
                  onValueChange={(value) => {
                    if (value === CONTENT_WARNING_CUSTOM_SELECT_VALUE) {
                      if (isPresetContentWarningLabel(contentWarningLabel.trim())) {
                        setContentWarningLabel('')
                      }
                      return
                    }
                    setContentWarningLabel(value)
                  }}
                  disabled={posting}
                >
                  <SelectTrigger aria-label={t('Content warning preset')}>
                    <SelectValue placeholder={t('Content warning preset')} />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_WARNING_PRESETS.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {preset}
                      </SelectItem>
                    ))}
                    <SelectItem value={CONTENT_WARNING_CUSTOM_SELECT_VALUE}>{t('Custom label…')}</SelectItem>
                  </SelectContent>
                </Select>
                {selectValue === CONTENT_WARNING_CUSTOM_SELECT_VALUE ? (
                  <Input
                    value={contentWarningLabel}
                    onChange={(e) => setContentWarningLabel(e.target.value)}
                    onBlur={() =>
                      setContentWarningLabel((prev) => normalizeContentWarningLabel(prev))
                    }
                    placeholder={t('Content warning custom placeholder')}
                    disabled={posting}
                    maxLength={80}
                  />
                ) : null}
              </div>
            ) : null}
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
      ) : null}
      </div>
    </div>
  )
}
