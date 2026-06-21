import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ComposerKindField, ComposerKindFieldsShell } from '@/components/Composer'
import { cleanUrl } from '@/lib/url'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type WebBookmarkDraftData = {
  url: string
  title: string
}

export default function WebBookmarkEditor({
  webBookmarkData,
  setWebBookmarkData
}: {
  webBookmarkData: WebBookmarkDraftData
  setWebBookmarkData: (data: WebBookmarkDraftData) => void
}) {
  const { t } = useTranslation()
  const [urlInput, setUrlInput] = useState(webBookmarkData.url)
  const [titleInput, setTitleInput] = useState(webBookmarkData.title)

  useEffect(() => {
    const raw = urlInput.trim()
    if (!raw) {
      setWebBookmarkData({ url: '', title: titleInput.trim() })
      return
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const cleaned = cleanUrl(href) || href
    setWebBookmarkData({ url: cleaned, title: titleInput.trim() })
  }, [urlInput, titleInput, setWebBookmarkData])

  return (
    <ComposerKindFieldsShell intro={t('Web bookmarks NIP intro')}>
      <ComposerKindField label={<Label htmlFor="web-bookmark-url">{t('URL')}</Label>}>
        <Input
          id="web-bookmark-url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://example.com/article"
          autoComplete="url"
          inputMode="url"
        />
      </ComposerKindField>
      <ComposerKindField
        label={
          <Label htmlFor="web-bookmark-title">
            {t('Title')} ({t('optional', { defaultValue: 'optional' })})
          </Label>
        }
      >
        <Input
          id="web-bookmark-title"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder={t('Web bookmark')}
        />
      </ComposerKindField>
    </ComposerKindFieldsShell>
  )
}
