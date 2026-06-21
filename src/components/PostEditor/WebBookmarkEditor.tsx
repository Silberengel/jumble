import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    <div className="space-y-3 rounded-lg border border-border bg-muted/15 px-3 py-3">
      <p className="text-xs text-muted-foreground">{t('Web bookmarks NIP intro')}</p>
      <div className="space-y-2">
        <Label htmlFor="web-bookmark-url" className="text-sm font-medium">
          {t('URL')}
        </Label>
        <Input
          id="web-bookmark-url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://example.com/article"
          autoComplete="url"
          inputMode="url"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="web-bookmark-title" className="text-sm font-medium">
          {t('Title')} ({t('optional', { defaultValue: 'optional' })})
        </Label>
        <Input
          id="web-bookmark-title"
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          placeholder={t('Web bookmark')}
        />
      </div>
    </div>
  )
}
