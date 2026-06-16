import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { getNoteBech32Id } from '@/lib/event'
import {
  buildCitationWikiMacro,
  citationDisplayTypesForKind,
  defaultCitationDisplayType,
  type CitationDisplayType
} from '@/lib/citation-macro'
import {
  buildCitationDraftEvent,
  emptyCitationFormValues,
  isCitationFormValid,
  todayIsoDate,
  type CitationFormType,
  type CitationFormValues
} from '@/lib/citation-form'
import { LoginRequiredError } from '@/lib/nostr-errors'
import { showPublishingError, showSimplePublishSuccess } from '@/lib/publishing-feedback'
import { getPrivateRelayUrls, hasPrivateRelays } from '@/lib/private-relays'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type CitationCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with `[[citation::type::nevent…]]` after publish. */
  onInsert: (citationMacro: string) => void
}

export default function CitationCreateDialog({
  open,
  onOpenChange,
  onInsert
}: CitationCreateDialogProps) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin, canSignEvents } = useNostr()
  const [citationType, setCitationType] = useState<CitationFormType>('external')
  const [displayType, setDisplayType] = useState<CitationDisplayType>(() =>
    defaultCitationDisplayType('external')
  )
  const [excerpt, setExcerpt] = useState('')
  const [values, setValues] = useState<CitationFormValues>(() => emptyCitationFormValues())
  const [publishing, setPublishing] = useState(false)
  const [privateRelaysOk, setPrivateRelaysOk] = useState<boolean | null>(null)

  const patchValues = useCallback((patch: Partial<CitationFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }))
  }, [])

  useEffect(() => {
    if (!open) return
    setCitationType('external')
    setDisplayType(defaultCitationDisplayType('external'))
    setExcerpt('')
    setValues(emptyCitationFormValues())
    setPublishing(false)
  }, [open])

  useEffect(() => {
    if (!open || !pubkey) {
      setPrivateRelaysOk(null)
      return
    }
    let cancelled = false
    void hasPrivateRelays(pubkey)
      .then((ok) => {
        if (!cancelled) setPrivateRelaysOk(ok)
      })
      .catch(() => {
        if (!cancelled) setPrivateRelaysOk(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, pubkey])

  useEffect(() => {
    const allowed = citationDisplayTypesForKind(citationType)
    if (!allowed.includes(displayType)) {
      setDisplayType(defaultCitationDisplayType(citationType))
    }
  }, [citationType, displayType])

  useEffect(() => {
    if (!open) return
    if (
      citationType !== 'internal' &&
      !values.accessedOn &&
      (citationType === 'external' || citationType === 'hardcopy' || citationType === 'prompt')
    ) {
      patchValues({ accessedOn: todayIsoDate() })
    }
  }, [open, citationType, values.accessedOn, patchValues])

  const canSubmit =
    canSignEvents &&
    privateRelaysOk === true &&
    isCitationFormValid(citationType, values) &&
    !publishing

  const handleCreate = async () => {
    if (!canSubmit) return
    checkLogin(async () => {
      if (!pubkey) return
      setPublishing(true)
      try {
        const privateRelayUrls = await getPrivateRelayUrls(pubkey)
        if (privateRelayUrls.length === 0) {
          showPublishingError(new Error(t('Citations require private relays (NIP-65).')))
          return
        }
        const draft = buildCitationDraftEvent(citationType, excerpt.trim(), values)
        const published = await publish(draft, {
          specifiedRelayUrls: privateRelayUrls,
          additionalRelayUrls: privateRelayUrls,
          disableFallbacks: true
        })
        client.addEventToCache(published)
        const bech32 = getNoteBech32Id(published)
        onInsert(`${buildCitationWikiMacro(displayType, bech32)} `)
        showSimplePublishSuccess(t('Citation published'))
        onOpenChange(false)
      } catch (error) {
        if (error instanceof LoginRequiredError) return
        showPublishingError(error instanceof Error ? error : new Error(String(error)))
      } finally {
        setPublishing(false)
      }
    })
  }

  const isPrompt = citationType === 'prompt'
  const isInternal = citationType === 'internal'
  const isExternal = citationType === 'external'
  const isHardcopy = citationType === 'hardcopy'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'z-[280] !flex w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0',
          'max-h-[min(90dvh,720px)] sm:w-full'
        )}
        overlayClassName="z-[275]"
      >
        <DialogHeader className="shrink-0 space-y-1 px-4 pt-4 pb-2 sm:px-6 sm:pt-6">
          <DialogTitle>{t('Create citation dialog title')}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t('Create citation dialog hint')}</p>
        </DialogHeader>

        {privateRelaysOk === false ? (
          <p className="shrink-0 px-4 pb-4 text-sm text-muted-foreground sm:px-6">
            {t('Citations require private relays (NIP-65).')}
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 sm:px-6">
            <div className="space-y-4 pb-4">
              <div className="space-y-2">
                <Label htmlFor="citation-create-type">{t('Citation')}</Label>
                <Select
                  value={citationType}
                  onValueChange={(v) => {
                    const next = v as CitationFormType
                    setCitationType(next)
                    setDisplayType(defaultCitationDisplayType(next))
                  }}
                >
                  <SelectTrigger id="citation-create-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    <SelectItem value="internal">{t('Internal Citation')}</SelectItem>
                    <SelectItem value="external">{t('External Citation')}</SelectItem>
                    <SelectItem value="hardcopy">{t('Hardcopy Citation')}</SelectItem>
                    <SelectItem value="prompt">{t('Prompt Citation')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="citation-create-display-type">{t('Citation display')}</Label>
                <Select value={displayType} onValueChange={(v) => setDisplayType(v as CitationDisplayType)}>
                  <SelectTrigger id="citation-create-display-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[300]">
                    {citationDisplayTypesForKind(citationType).map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(
                          type === 'inline'
                            ? 'Advanced lab citation type inline'
                            : type === 'quote'
                              ? 'Advanced lab citation type quote'
                              : type === 'end'
                                ? 'Advanced lab citation type end'
                                : type === 'foot'
                                  ? 'Advanced lab citation type foot'
                                  : type === 'foot-end'
                                    ? 'Advanced lab citation type footEnd'
                                    : type === 'prompt-inline'
                                      ? 'Advanced lab citation type promptInline'
                                      : 'Advanced lab citation type promptEnd'
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="citation-create-excerpt">{t('Cited excerpt')}</Label>
                <Textarea
                  id="citation-create-excerpt"
                  value={excerpt}
                  onChange={(e) => setExcerpt(e.target.value)}
                  placeholder={t('Quoted or referenced text (optional)')}
                  rows={3}
                />
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                {isPrompt && (
                  <>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="citation-create-llm">
                        {t('Language Model')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="citation-create-llm"
                        value={values.promptLlm}
                        onChange={(e) => patchValues({ promptLlm: e.target.value })}
                        placeholder={t('e.g., GPT-4, Claude, etc. (required)')}
                        className={cn(!values.promptLlm.trim() && 'border-destructive')}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="citation-create-prompt-url">{t('URL')}</Label>
                      <Input
                        id="citation-create-prompt-url"
                        value={values.externalUrl}
                        onChange={(e) => patchValues({ externalUrl: e.target.value })}
                        placeholder={t('Website where LLM was accessed (optional)')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-version">{t('Version')}</Label>
                      <Input
                        id="citation-create-version"
                        value={values.version}
                        onChange={(e) => patchValues({ version: e.target.value })}
                        placeholder={t('Version number (optional)')}
                      />
                    </div>
                  </>
                )}

                {isInternal && (
                  <>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="citation-create-ctag">
                        {t('C-Tag')} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="citation-create-ctag"
                        value={values.internalCTag}
                        onChange={(e) => patchValues({ internalCTag: e.target.value })}
                        placeholder={t('kind:pubkey:hex format (required)')}
                        className={cn(!values.internalCTag.trim() && 'border-destructive')}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="citation-create-relay-hint">{t('Relay Hint')}</Label>
                      <Input
                        id="citation-create-relay-hint"
                        value={values.internalRelayHint}
                        onChange={(e) => patchValues({ internalRelayHint: e.target.value })}
                        placeholder={t('Relay URL (optional)')}
                      />
                    </div>
                  </>
                )}

                {isExternal && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="citation-create-url">
                      {t('URL')} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="citation-create-url"
                      value={values.externalUrl}
                      onChange={(e) => patchValues({ externalUrl: e.target.value })}
                      placeholder="https://…"
                      className={cn(!values.externalUrl.trim() && 'border-destructive')}
                    />
                  </div>
                )}

                {!isPrompt && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-title">{t('Title')}</Label>
                      <Input
                        id="citation-create-title"
                        value={values.title}
                        onChange={(e) => patchValues({ title: e.target.value })}
                        placeholder={t('Citation title (optional)')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-author">{t('Author')}</Label>
                      <Input
                        id="citation-create-author"
                        value={values.author}
                        onChange={(e) => patchValues({ author: e.target.value })}
                        placeholder={t('Author name (optional)')}
                      />
                    </div>
                  </>
                )}

                {isHardcopy && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-pages">{t('Page Range')}</Label>
                      <Input
                        id="citation-create-pages"
                        value={values.hardcopyPageRange}
                        onChange={(e) => patchValues({ hardcopyPageRange: e.target.value })}
                        placeholder="pp. 42–48"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-chapter">{t('Chapter Title')}</Label>
                      <Input
                        id="citation-create-chapter"
                        value={values.hardcopyChapterTitle}
                        onChange={(e) => patchValues({ hardcopyChapterTitle: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-editor">{t('Editor')}</Label>
                      <Input
                        id="citation-create-editor"
                        value={values.hardcopyEditor}
                        onChange={(e) => patchValues({ hardcopyEditor: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-published-in">{t('Published In')}</Label>
                      <Input
                        id="citation-create-published-in"
                        value={values.hardcopyPublishedIn}
                        onChange={(e) => patchValues({ hardcopyPublishedIn: e.target.value })}
                        placeholder={t('Journal/Publication name (optional)')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-volume">{t('Volume')}</Label>
                      <Input
                        id="citation-create-volume"
                        value={values.hardcopyVolume}
                        onChange={(e) => patchValues({ hardcopyVolume: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-doi">{t('DOI')}</Label>
                      <Input
                        id="citation-create-doi"
                        value={values.hardcopyDoi}
                        onChange={(e) => patchValues({ hardcopyDoi: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-published-by">{t('Published By')}</Label>
                      <Input
                        id="citation-create-published-by"
                        value={values.publishedBy}
                        onChange={(e) => patchValues({ publishedBy: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {isExternal && (
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="citation-create-published-by-ext">{t('Published By')}</Label>
                    <Input
                      id="citation-create-published-by-ext"
                      value={values.publishedBy}
                      onChange={(e) => patchValues({ publishedBy: e.target.value })}
                    />
                  </div>
                )}

                {!isPrompt && (
                  <div className="space-y-2">
                    <Label htmlFor="citation-create-published-on">{t('Published On')}</Label>
                    <Input
                      id="citation-create-published-on"
                      type="date"
                      value={values.publishedOn}
                      onChange={(e) => patchValues({ publishedOn: e.target.value })}
                    />
                  </div>
                )}

                {(isExternal || isHardcopy || isPrompt) && (
                  <div className="space-y-2">
                    <Label htmlFor="citation-create-accessed-on">
                      {t('Accessed On')} <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="citation-create-accessed-on"
                      type="date"
                      value={values.accessedOn}
                      onChange={(e) => patchValues({ accessedOn: e.target.value })}
                      className={cn(!values.accessedOn.trim() && 'border-destructive')}
                    />
                  </div>
                )}

                {!isPrompt && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-location">{t('Location')}</Label>
                      <Input
                        id="citation-create-location"
                        value={values.location}
                        onChange={(e) => patchValues({ location: e.target.value })}
                        placeholder={t('Location (optional)')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="citation-create-geohash">{t('Geohash')}</Label>
                      <Input
                        id="citation-create-geohash"
                        value={values.geohash}
                        onChange={(e) => patchValues({ geohash: e.target.value })}
                        placeholder={t('Geohash (optional)')}
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="citation-create-summary">
                    {isPrompt ? t('Prompt Conversation Script') : t('Summary')}
                  </Label>
                  <Textarea
                    id="citation-create-summary"
                    value={values.summary}
                    onChange={(e) => patchValues({ summary: e.target.value })}
                    placeholder={
                      isPrompt
                        ? t('The full prompt conversation (optional)')
                        : t('Brief summary (optional)')
                    }
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:justify-end sm:gap-0 sm:px-6 sm:py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={!canSubmit}>
            {publishing ? t('Loading...') : t('Create and insert citation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
