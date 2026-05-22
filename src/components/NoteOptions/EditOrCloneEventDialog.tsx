import storage from '@/services/local-storage.service'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import Content from '@/components/Content'
import ContentPreview from '@/components/ContentPreview'
import Highlight from '@/components/Note/Highlight'
import MarkdownArticle from '@/components/Note/MarkdownArticle/MarkdownArticle'
import AsciidocArticle from '@/components/Note/AsciidocArticle/AsciidocArticle'
import ClientTag from '@/components/ClientTag'
import {
  ExtendedKind,
  MAX_SIGNED_CUSTOM_EVENT_KIND,
  UNSIGNED_EXPERIMENTAL_KIND_MAX,
  UNSIGNED_EXPERIMENTAL_KIND_MIN,
  isUnsignedExperimentalKind
} from '@/constants'
import {
  applyImwaldAttributionTags,
  collectUploadImetaTagsForContentUrls,
  mergeUploadImetaTagsInto
} from '@/lib/draft-event'
import { createFakeEvent } from '@/lib/event'
import logger from '@/lib/logger'
import {
  showPublishingError,
  showPublishingFeedback,
  showSimplePublishSuccess
} from '@/lib/publishing-feedback'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import postEditorCache from '@/services/post-editor-cache.service'
import type { TDraftEvent } from '@/types'
import dayjs from 'dayjs'
import { AlertTriangle, Code2, Plus, Trash2 } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import AdvancedEventLabDialog from '@/components/AdvancedEventLab/AdvancedEventLabDialog'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import { isAsciidocMarkupKind } from '@/lib/advanced-event-lab-kinds'

function normalizeTagRow(row: string[]): string[] | null {
  const trimmed = row.map((c) => c.trim())
  if (!trimmed[0]) return null
  let end = trimmed.length
  while (end > 1 && trimmed[end - 1] === '') end--
  return trimmed.slice(0, end)
}

function tagsFromRows(rows: string[][]): string[][] {
  const out: string[][] = []
  for (const row of rows) {
    const n = normalizeTagRow(row)
    if (n) out.push(n)
  }
  return out
}

/** Integer kind in [0, MAX_SIGNED_CUSTOM_EVENT_KIND] or unsigned experimental range; null if invalid / empty. */
function parseEventKindInput(s: string): number | null {
  const trimmed = s.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isInteger(n) || n < 0) return null
  if (n <= MAX_SIGNED_CUSTOM_EVENT_KIND) return n
  if (isUnsignedExperimentalKind(n)) return n
  return null
}

function StaticEventPreview({ event, className }: { event: Event; className?: string }) {
  const k = event.kind
  const wrap = (node: ReactNode) => (
    <Card className={cn('p-3 select-text', className)}>{node}</Card>
  )
  if (k === ExtendedKind.POLL) {
    return wrap(<ContentPreview event={event} />)
  }
  if (k === kinds.Highlights) {
    return wrap(<Highlight event={event} />)
  }
  if (
    k === kinds.ShortTextNote ||
    k === ExtendedKind.COMMENT ||
    k === ExtendedKind.VOICE_COMMENT
  ) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === kinds.LongFormArticle) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === ExtendedKind.WIKI_ARTICLE) {
    return wrap(<AsciidocArticle event={event} hideImagesAndInfo={false} />)
  }
  if (k === ExtendedKind.NOSTR_SPECIFICATION) {
    return wrap(<MarkdownArticle event={event} hideMetadata />)
  }
  if (k === ExtendedKind.PUBLICATION_CONTENT) {
    return wrap(<AsciidocArticle event={event} hideImagesAndInfo={false} />)
  }
  return wrap(<Content event={event} className="h-full" mustLoadMedia />)
}

export type TEditOrCloneMode = 'edit' | 'clone'

export type EditOrCloneEventDialogProps =
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: 'create'
    }
  | {
      open: boolean
      onOpenChange: (open: boolean) => void
      mode: TEditOrCloneMode
      sourceEvent: Event
    }

export default function EditOrCloneEventDialog(props: EditOrCloneEventDialogProps) {
  const { open, onOpenChange, mode } = props
  const isCreate = mode === 'create'
  const sourceEvent = !isCreate ? props.sourceEvent : null

  const { t, i18n } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const [content, setContent] = useState(() => sourceEvent?.content ?? '')
  const [createKindInput, setCreateKindInput] = useState('1')
  const [tagRows, setTagRows] = useState<string[][]>([['', '']])
  const [activeTab, setActiveTab] = useState('edit')
  const [publishing, setPublishing] = useState(false)
  const [advancedLabOpen, setAdvancedLabOpen] = useState(false)
  const [advancedLabInitial, setAdvancedLabInitial] = useState<AdvancedEventLabSlice | null>(null)
  const prevOpenRef = useRef(false)

  const parsedCreateKind = useMemo(
    () => (isCreate ? parseEventKindInput(createKindInput) : null),
    [isCreate, createKindInput]
  )

  /** Stable lab draft bucket (separate from composer {@link postEditorCache.generateCacheKey}). */
  const advancedLabDraftPersistenceKey = useMemo(() => {
    if (isCreate) {
      if (parsedCreateKind === null) return null
      return `event-lab:ecc:create:${parsedCreateKind}`
    }
    const id = sourceEvent!.id.trim()
    const normalized = /^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : id
    return mode === 'edit'
      ? `event-lab:ecc:edit:${normalized}`
      : `event-lab:ecc:clone:${normalized}`
  }, [isCreate, parsedCreateKind, sourceEvent, mode])

  const kind = isCreate ? (parsedCreateKind ?? 0) : sourceEvent!.kind

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      if (isCreate) {
        setCreateKindInput('1')
        setContent('')
        setTagRows([['', '']])
      } else if (sourceEvent) {
        setContent(sourceEvent.content)
        setTagRows(
          sourceEvent.tags?.length
            ? sourceEvent.tags.map((row) => [...row])
            : [['', '']]
        )
      }
      setActiveTab('edit')
    }
    prevOpenRef.current = open
  }, [open, isCreate, sourceEvent])

  const normalizedTags = useMemo(() => tagsFromRows(tagRows), [tagRows])

  const tagsWithContentUploadImeta = useMemo(() => {
    const next = [...normalizedTags]
    mergeUploadImetaTagsInto(next, collectUploadImetaTagsForContentUrls(content))
    return next
  }, [normalizedTags, content])

  const previewEvent = useMemo(() => {
    if (isCreate && parsedCreateKind === null) return null
    const k = isCreate ? parsedCreateKind! : sourceEvent!.kind
    const now = Math.floor(Date.now() / 1000)
    const base: TDraftEvent = {
      kind: k,
      content,
      tags: tagsWithContentUploadImeta,
      created_at: now
    }
    const withAttribution = applyImwaldAttributionTags(base, {
      addClientTag: storage.getAddClientTag()
    })
    return createFakeEvent({
      kind: k,
      content,
      tags: withAttribution.tags,
      pubkey: pubkey ?? '',
      created_at: now
    })
  }, [isCreate, parsedCreateKind, sourceEvent, content, tagsWithContentUploadImeta, pubkey])

  const buildDraftJson = useCallback(() => {
    if (isCreate && parsedCreateKind === null) {
      return t(
        'Enter a valid event kind: integer 0–{{maxSigned}}, or {{unsignedMin}}–{{unsignedMax}} (unsigned experiment).',
        {
          maxSigned: MAX_SIGNED_CUSTOM_EVENT_KIND,
          unsignedMin: UNSIGNED_EXPERIMENTAL_KIND_MIN,
          unsignedMax: UNSIGNED_EXPERIMENTAL_KIND_MAX
        }
      )
    }
    const k = isCreate ? parsedCreateKind! : sourceEvent!.kind
    const base: TDraftEvent = {
      kind: k,
      content,
      tags: tagsWithContentUploadImeta,
      created_at: dayjs().unix()
    }
    const withAttribution = applyImwaldAttributionTags(base, {
      addClientTag: storage.getAddClientTag()
    })
    const unsignedNote = isUnsignedExperimentalKind(withAttribution.kind)
      ? t(
          'Unsigned experimental kind: `sig` will be empty at publish; `id` is still the standard event hash. Not accepted by normal relays. Relays that allow this should authenticate you (e.g. NIP-42 AUTH) before writes.'
        )
      : t('id and sig are assigned when you publish')
    const draft = {
      pubkey: pubkey ?? t('Log in to publish'),
      kind: withAttribution.kind,
      content: withAttribution.content,
      tags: withAttribution.tags,
      created_at: t('Set when you publish'),
      _note: unsignedNote
    }
    return JSON.stringify(draft, null, 2)
  }, [isCreate, parsedCreateKind, sourceEvent, pubkey, content, tagsWithContentUploadImeta, t])

  const draftJson = activeTab === 'json' ? buildDraftJson() : ''

  const updateRow = (i: number, j: number, value: string) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      if (!next[i]) return rows
      next[i][j] = value
      return next
    })
  }

  const addRow = () => setTagRows((rows) => [...rows, ['', '']])

  const removeRow = (i: number) => {
    setTagRows((rows) => (rows.length <= 1 ? [['', '']] : rows.filter((_, idx) => idx !== i)))
  }

  const addCell = (i: number) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      next[i] = [...next[i], '']
      return next
    })
  }

  const removeCell = (i: number, j: number) => {
    setTagRows((rows) => {
      const next = rows.map((r) => [...r])
      if (next[i].length <= 1) return rows
      next[i] = next[i].filter((_, idx) => idx !== j)
      return next
    })
  }

  const handlePublish = async () => {
    await checkLogin(async () => {
      if (!pubkey) return
      if (isCreate) {
        const k = parseEventKindInput(createKindInput)
        if (k === null) {
          showPublishingError(
            t(
              'Kind must be an integer from 0 to {{maxSigned}}, or from {{unsignedMin}} to {{unsignedMax}} (unsigned experiment).',
              {
                maxSigned: MAX_SIGNED_CUSTOM_EVENT_KIND,
                unsignedMin: UNSIGNED_EXPERIMENTAL_KIND_MIN,
                unsignedMax: UNSIGNED_EXPERIMENTAL_KIND_MAX
              }
            )
          )
          return
        }
      }
      setPublishing(true)
      try {
        const publishKind = isCreate ? parseEventKindInput(createKindInput)! : sourceEvent!.kind
        const draft = {
          kind: publishKind,
          content,
          tags: tagsWithContentUploadImeta,
          created_at: dayjs().unix()
        }
        const newEvent = await publish(draft, {
          addClientTag: storage.getAddClientTag()
        })
        if ((newEvent as any)?.relayStatuses) {
          const rs = (newEvent as any).relayStatuses
          showPublishingFeedback(
            {
              success: true,
              relayStatuses: rs,
              successCount: rs.filter((s: any) => s.success).length,
              totalCount: rs.length
            },
            { message: t('Post published'), duration: 6000 }
          )
        } else {
          showSimplePublishSuccess(t('Post published'))
        }
        onOpenChange(false)
      } catch (e) {
        if (e instanceof AggregateError && (e as any).relayStatuses) {
          const relayStatuses = (e as any).relayStatuses
          const successCount = relayStatuses.filter((s: any) => s.success).length
          const totalCount = relayStatuses.length
          showPublishingFeedback(
            {
              success: successCount > 0,
              relayStatuses,
              successCount,
              totalCount
            },
            {
              message:
                successCount > 0 ? t('Published to some relays only') : t('Failed to post'),
              duration: 6000
            }
          )
          if (successCount > 0) onOpenChange(false)
        } else {
          logger.error('Edit/clone publish failed', { error: e })
          showPublishingError(e instanceof Error ? e : String(e))
        }
      } finally {
        setPublishing(false)
      }
    })
  }

  const title =
    mode === 'edit'
      ? t('Edit this event')
      : mode === 'clone'
        ? t('Clone or fork this event')
        : t('Create custom event')

  const openAdvancedLab = useCallback(() => {
    if (isCreate && parsedCreateKind === null) return
    const k = isCreate ? parsedCreateKind! : sourceEvent!.kind
    const key = advancedLabDraftPersistenceKey
    const saved = key ? postEditorCache.getAdvancedLabDraft(key) : undefined
    if (saved && saved.kind === k) {
      setAdvancedLabInitial({
        kind: saved.kind,
        content: saved.content,
        tags: saved.tags.map((row) => [...row])
      })
    } else {
      setAdvancedLabInitial({
        kind: k,
        content,
        tags: normalizedTags.map((row) => [...row])
      })
    }
    setAdvancedLabOpen(true)
  }, [isCreate, parsedCreateKind, sourceEvent, content, normalizedTags, advancedLabDraftPersistenceKey])

  const labKind = isCreate ? (parsedCreateKind ?? 0) : sourceEvent?.kind ?? 0

  const labPreviewEmojiTags = useMemo(
    () =>
      !isCreate && sourceEvent?.tags?.length
        ? sourceEvent.tags.filter(([n]) => n === 'emoji').map((row) => [...row])
        : [],
    [isCreate, sourceEvent]
  )

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 pr-14">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {isCreate
              ? t('Set kind, content, and tags, then publish.')
              : t('Edit content and tags, then publish a new signed event.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0 gap-2">
            <TabsList className="w-auto justify-start shrink-0 flex flex-wrap gap-1">
              <TabsTrigger value="edit">{t('Edit')}</TabsTrigger>
              <TabsTrigger value="preview">{t('Preview')}</TabsTrigger>
              <TabsTrigger value="json">{t('Json')}</TabsTrigger>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 ml-1"
                onClick={openAdvancedLab}
                title={t('Advanced event lab')}
              >
                <Code2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{t('Advanced event lab')}</span>
              </Button>
            </TabsList>

            <TabsContent value="edit" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(58vh,520px)] min-h-[300px] pr-3">
                <div className="space-y-5 pb-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('Event kind')}</label>
                    {isCreate ? (
                      <>
                        <Input
                          type="number"
                          min={0}
                          max={UNSIGNED_EXPERIMENTAL_KIND_MAX}
                          step={1}
                          value={createKindInput}
                          onChange={(e) => setCreateKindInput(e.target.value)}
                          className="font-mono text-sm"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t(
                            'Signed: 0–{{maxSigned}}. Unsigned experiment (empty sig): {{unsignedMin}}–{{unsignedMax}}.',
                            {
                              maxSigned: MAX_SIGNED_CUSTOM_EVENT_KIND,
                              unsignedMin: UNSIGNED_EXPERIMENTAL_KIND_MIN,
                              unsignedMax: UNSIGNED_EXPERIMENTAL_KIND_MAX
                            }
                          )}
                        </p>
                        {parsedCreateKind !== null && isUnsignedExperimentalKind(parsedCreateKind) ? (
                          <div
                            role="alert"
                            className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100"
                          >
                            <AlertTriangle
                              className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                              aria-hidden
                            />
                            <div>
                              <p className="font-medium">{t('Unsigned experimental kind')}</p>
                              <p className="mt-1 text-xs leading-relaxed opacity-90">
                                {t(
                                  'This kind is published with an empty signature. Normal Nostr relays will reject it, and these events are not portable on the open network. Only use relays that explicitly support this experiment and authenticate you (for example with NIP-42 AUTH) before accepting writes.'
                                )}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <Input
                        type="number"
                        value={kind}
                        disabled
                        readOnly
                        className="font-mono text-sm"
                        aria-readonly
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">{t('Note content')}</label>
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      rows={5}
                      className="font-mono text-sm min-h-[120px] resize-y max-h-[40vh]"
                    />
                  </div>
                  <div className="space-y-3 rounded-lg border border-border/80 bg-muted/15 p-3 sm:p-4">
                    <div className="text-sm font-medium">{t('Tags')}</div>
                    <div className="space-y-3">
                      {tagRows.map((row, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-border/60 bg-background/80 p-3 shadow-sm"
                        >
                          <div className="space-y-2.5">
                            <Input
                              value={row[0] ?? ''}
                              onChange={(e) => updateRow(i, 0, e.target.value)}
                              placeholder={t('Tag name')}
                              className="h-9 font-mono text-sm"
                              autoComplete="off"
                            />
                            {row.length > 1 ? (
                              <div className="space-y-2 border-l-2 border-muted pl-3">
                                {row.slice(1).map((cell, j) => (
                                  <div key={j + 1} className="flex gap-2 items-center min-w-0">
                                    <Input
                                      value={cell}
                                      onChange={(e) => updateRow(i, j + 1, e.target.value)}
                                      placeholder={t('Value')}
                                      className="h-9 min-w-0 flex-1 font-mono text-sm"
                                      autoComplete="off"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 shrink-0"
                                      onClick={() => removeCell(i, j + 1)}
                                      aria-label={t('Remove value')}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => addCell(i)}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1.5" />
                              {t('Add field')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 text-muted-foreground hover:text-destructive"
                              onClick={() => removeRow(i)}
                              aria-label={t('Remove tag')}
                            >
                              <Trash2 className="h-4 w-4 mr-1.5" />
                              {t('Remove tag')}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={addRow}>
                      <Plus className="h-4 w-4 mr-1" />
                      {t('Add tag')}
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="preview" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(58vh,520px)] min-h-[300px] pr-3">
                <div className="space-y-1.5">
                  {previewEvent ? (
                    <>
                      {storage.getAddClientTag() ? (
                        <div className="flex min-h-[1.125rem] items-center px-0.5">
                          <ClientTag event={previewEvent} />
                        </div>
                      ) : null}
                      <StaticEventPreview event={previewEvent} />
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t(
                        'Enter a valid event kind: 0–{{maxSigned}}, or {{unsignedMin}}–{{unsignedMax}}.',
                        {
                          maxSigned: MAX_SIGNED_CUSTOM_EVENT_KIND,
                          unsignedMin: UNSIGNED_EXPERIMENTAL_KIND_MIN,
                          unsignedMax: UNSIGNED_EXPERIMENTAL_KIND_MAX
                        }
                      )}
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="json" className="flex-1 min-h-0 mt-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-[min(58vh,520px)] min-h-[300px] pr-3">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words border rounded-md p-3 bg-muted/40 select-text">
                  {draftJson}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="shrink-0 px-6 py-4 border-t gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={publishing || !pubkey || (isCreate && parsedCreateKind === null)}
          >
            {publishing ? t('Loading...') : t('Publish')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AdvancedEventLabDialog
      open={advancedLabOpen}
      onOpenChange={(o) => {
        setAdvancedLabOpen(o)
        if (!o) setAdvancedLabInitial(null)
      }}
      initial={advancedLabInitial}
      kindEditable={isCreate}
      markupMode={isAsciidocMarkupKind(labKind) ? 'asciidoc' : 'markdown'}
      i18nLanguage={i18n.language}
      contextEventId={!isCreate && sourceEvent ? sourceEvent.id : null}
      previewAuthorPubkey={pubkey ?? null}
      previewEmojiTags={labPreviewEmojiTags}
      draftPersistenceKey={
        advancedLabOpen && advancedLabDraftPersistenceKey ? advancedLabDraftPersistenceKey : null
      }
      onApply={(payload) => {
        if (advancedLabDraftPersistenceKey) {
          postEditorCache.setAdvancedLabDraft(advancedLabDraftPersistenceKey, {
            kind: payload.kind,
            content: payload.content,
            tags: payload.tags.map((r) => [...r])
          })
          postEditorCache.flushPersist()
        }
        setContent(payload.content)
        setTagRows(payload.tags.length > 0 ? payload.tags.map((r) => [...r]) : [['', '']])
        if (isCreate) {
          setCreateKindInput(String(payload.kind))
        }
        setAdvancedLabOpen(false)
        setAdvancedLabInitial(null)
      }}
    />
    </>
  )
}
