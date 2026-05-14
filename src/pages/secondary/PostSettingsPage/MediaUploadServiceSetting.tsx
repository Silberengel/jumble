import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  BLOSSOM_PRESET_SELECT_PREFIX,
  NIP_96_SERVICE,
  STANDARD_BLOSSOM_UPLOAD_HOSTS
} from '@/constants'
import { simplifyUrl, normalizeHttpUrl } from '@/lib/url'
import { useMediaUploadService } from '@/providers/MediaUploadServiceProvider'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import BlossomServerListSetting from './BlossomServerListSetting'

const BLOSSOM = 'blossom'

function blossomPresetSelectValue(url: string): string {
  return `${BLOSSOM_PRESET_SELECT_PREFIX}${encodeURIComponent(url)}`
}

function tryParseBlossomPresetSelectValue(value: string): string | undefined {
  if (!value.startsWith(BLOSSOM_PRESET_SELECT_PREFIX)) return undefined
  try {
    return decodeURIComponent(value.slice(BLOSSOM_PRESET_SELECT_PREFIX.length))
  } catch {
    return undefined
  }
}

export default function MediaUploadServiceSetting() {
  const { t } = useTranslation()
  const { serviceConfig, updateServiceConfig } = useMediaUploadService()
  const selectedValue = useMemo(() => {
    if (serviceConfig.type === 'blossom') {
      return BLOSSOM
    }
    if (serviceConfig.type === 'blossom-preset') {
      return blossomPresetSelectValue(serviceConfig.url)
    }
    return serviceConfig.service
  }, [serviceConfig])

  const handleSelectedValueChange = (value: string) => {
    if (value === BLOSSOM) {
      return updateServiceConfig({ type: 'blossom' })
    }
    if (value.startsWith(BLOSSOM_PRESET_SELECT_PREFIX)) {
      const presetUrl = tryParseBlossomPresetSelectValue(value)
      if (presetUrl !== undefined) {
        const normalized = normalizeHttpUrl(presetUrl)
        if (normalized) {
          return updateServiceConfig({ type: 'blossom-preset', url: normalized })
        }
      }
      return
    }
    return updateServiceConfig({ type: 'nip96', service: value })
  }

  const showBlossomServerList = selectedValue === BLOSSOM
  const isBlossomPreset = serviceConfig.type === 'blossom-preset'

  /** Radix Select reads item text from the closed portal; items are often unmounted, so the trigger stays blank unless we set this explicitly. */
  const selectTriggerLabel = useMemo(() => {
    if (serviceConfig.type === 'blossom') {
      return t('BlossomUploadYourListOption')
    }
    if (serviceConfig.type === 'blossom-preset') {
      const preset = STANDARD_BLOSSOM_UPLOAD_HOSTS.find((h) => h.url === serviceConfig.url)
      return preset ? t(preset.labelKey) : `${simplifyUrl(serviceConfig.url)} (${t('Blossom')})`
    }
    return simplifyUrl(serviceConfig.service)
  }, [serviceConfig, t])

  return (
    <div className="space-y-2">
      <Label htmlFor="media-upload-service-select">{t('Media upload service')}</Label>
      <Select value={selectedValue} onValueChange={handleSelectedValueChange}>
        <SelectTrigger id="media-upload-service-select" className="w-full max-w-sm min-w-[12rem]">
          <SelectValue placeholder={t('Media upload service')}>{selectTriggerLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BLOSSOM}>{t('BlossomUploadYourListOption')}</SelectItem>
          {STANDARD_BLOSSOM_UPLOAD_HOSTS.map(({ url, labelKey }) => (
            <SelectItem key={url} value={blossomPresetSelectValue(url)}>
              {t(labelKey)}
            </SelectItem>
          ))}
          {NIP_96_SERVICE.map((url) => (
            <SelectItem key={url} value={url}>
              {simplifyUrl(url)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedValue === BLOSSOM ? (
        <p className="text-xs text-muted-foreground leading-snug max-w-xl">{t('BlossomUploadServiceBlurb')}</p>
      ) : null}
      {isBlossomPreset && serviceConfig.type === 'blossom-preset' ? (
        <>
          <p className="text-xs text-muted-foreground leading-snug max-w-xl">{t('BlossomPresetUploadServiceBlurb')}</p>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs max-w-xl">
            <div className="text-muted-foreground mb-0.5">{t('BlossomPresetSelectedHostLabel')}</div>
            <div className="truncate font-mono text-foreground" title={serviceConfig.url}>
              {serviceConfig.url}
            </div>
          </div>
        </>
      ) : null}

      {showBlossomServerList ? <BlossomServerListSetting /> : null}
    </div>
  )
}
