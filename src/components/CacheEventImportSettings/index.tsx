import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  CACHE_IMPORT_MAX_JSONL_FILE_BYTES,
  formatCacheImportLimits,
  parseJsonlCacheImportText,
  parsePastedCacheImportJson
} from '@/lib/cache-event-import'
import { showPublishingError, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import type { Event } from 'nostr-tools'
import { Upload } from 'lucide-react'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

async function ingestImportedEvents(
  events: Event[],
  broadcast: boolean,
  accountPubkey: string | null,
  t: (key: string) => string
): Promise<{ imported: number; broadcastOk: number; broadcastFailed: number }> {
  const unique: Event[] = []
  const seen = new Set<string>()
  for (const ev of events) {
    const id = ev.id.toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(ev)
    client.addEventToCache(ev, { explicitNoteLookupHexId: id })
  }

  let broadcastOk = 0
  let broadcastFailed = 0
  if (broadcast && accountPubkey && unique.length > 0) {
    const urls = await client.getMailboxStackWriteUrlsForRepublish(accountPubkey)
    if (!urls.length) {
      throw new Error(t('No mailbox cache or HTTP write relays configured'))
    }
    for (const ev of unique) {
      try {
        const result = await client.publishEvent(urls, ev, { skipOutboxRetry: true })
        if (result.successCount >= 1) broadcastOk++
        else broadcastFailed++
      } catch {
        broadcastFailed++
      }
    }
  }

  return { imported: unique.length, broadcastOk, broadcastFailed }
}

export default function CacheEventImportSettings() {
  const { t } = useTranslation()
  const { pubkey: accountPubkey } = useNostr()
  const broadcastId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pasteText, setPasteText] = useState('')
  const [broadcastAfterImport, setBroadcastAfterImport] = useState(false)
  const [busy, setBusy] = useState(false)

  const runImport = useCallback(
    async (events: Event[], issueCount: number) => {
      if (events.length === 0) {
        toast.error(t('cacheImport.noValidEvents'))
        return
      }
      if (broadcastAfterImport && !accountPubkey) {
        toast.error(t('Log in to broadcast'))
        return
      }
      setBusy(true)
      const loadingId = toast.loading(t('cacheImport.importing'))
      try {
        const stats = await ingestImportedEvents(events, broadcastAfterImport, accountPubkey ?? null, t)
        if (issueCount > 0) {
          toast.warning(
            t('cacheImport.partialWithIssues', {
              imported: stats.imported,
              skipped: issueCount
            })
          )
        }
        const successMessage =
          broadcastAfterImport && accountPubkey
            ? t('cacheImport.doneWithBroadcast', {
                imported: stats.imported,
                broadcastOk: stats.broadcastOk,
                broadcastFailed: stats.broadcastFailed
              })
            : t('cacheImport.done', { count: stats.imported })
        toast.dismiss(loadingId)
        showSimplePublishSuccess(successMessage)
        setPasteText('')
      } catch (err) {
        toast.dismiss(loadingId)
        showPublishingError(
          t('cacheImport.failed', {
            error: err instanceof Error ? err.message : String(err)
          })
        )
      } finally {
        setBusy(false)
      }
    },
    [accountPubkey, broadcastAfterImport, t]
  )

  const handleImportPaste = () => {
    const { events, issues } = parsePastedCacheImportJson(pasteText)
    void runImport(events, issues.length)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.jsonl')) {
      toast.error(t('cacheImport.jsonlOnly'))
      return
    }
    if (file.size > CACHE_IMPORT_MAX_JSONL_FILE_BYTES) {
      toast.error(
        t('cacheImport.fileTooLarge', {
          mb: Math.round(CACHE_IMPORT_MAX_JSONL_FILE_BYTES / (1024 * 1024))
        })
      )
      return
    }
    void (async () => {
      setBusy(true)
      try {
        const text = await file.text()
        const { events, issues } = parseJsonlCacheImportText(text)
        await runImport(events, issues.length)
      } catch (err) {
        toast.error(
          t('cacheImport.failed', {
            error: err instanceof Error ? err.message : String(err)
          })
        )
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <h3 className="text-base font-medium">{t('cacheImport.sectionTitle')}</h3>
      <p className="text-sm text-muted-foreground">{t('cacheImport.sectionBlurb')}</p>
      <p className="text-xs text-muted-foreground">{formatCacheImportLimits()}</p>

      <div className="flex items-start gap-2">
        <Checkbox
          id={broadcastId}
          checked={broadcastAfterImport}
          onCheckedChange={(v) => setBroadcastAfterImport(v === true)}
          disabled={!accountPubkey || busy}
        />
        <Label htmlFor={broadcastId} className="text-sm font-normal leading-snug cursor-pointer">
          {t('cacheImport.broadcastLabel')}
          {!accountPubkey ? (
            <span className="block text-xs text-muted-foreground">{t('Log in to broadcast')}</span>
          ) : null}
        </Label>
      </div>

      <Tabs defaultValue="paste" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="paste" className="flex-1">
            {t('cacheImport.tabPaste')}
          </TabsTrigger>
          <TabsTrigger value="file" className="flex-1">
            {t('cacheImport.tabFile')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="space-y-3 mt-3">
          <Textarea
            className="min-h-[140px] font-mono text-xs"
            placeholder={t('cacheImport.pastePlaceholder')}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={busy}
          />
          <Button type="button" disabled={busy || !pasteText.trim()} onClick={handleImportPaste}>
            {t('cacheImport.importButton')}
          </Button>
        </TabsContent>
        <TabsContent value="file" className="space-y-3 mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".jsonl,application/jsonl,text/jsonl"
            className="hidden"
            onChange={handleFileChange}
            disabled={busy}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('cacheImport.chooseJsonl')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('cacheImport.fileHint')}</p>
        </TabsContent>
      </Tabs>
    </div>
  )
}
