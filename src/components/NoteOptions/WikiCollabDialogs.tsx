import { EmbeddedNote } from '@/components/Embedded/EmbeddedNote'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  createReactionDraftEvent,
  createWikiArticleDraftEvent,
  createWikiForkDraftEvent,
  createWikiMergeAcceptanceDraftEvent,
  createWikiMergeRequestFromForkDraftEvent,
  createWikiRedirectDraftEvent
} from '@/lib/draft-event'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { normalizeWikiDTag, parseWikiMergeRequest } from '@/lib/nip54'
import { showPublishingError } from '@/lib/publishing-feedback'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { Event } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Fork a wiki article: create a new kind:30818 with `fork` markers pointing at the source. */
export function WikiForkDialog({
  open,
  onOpenChange,
  sourceEvent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceEvent: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(sourceEvent), [sourceEvent])
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [content, setContent] = useState('')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(metadata.title ?? '')
      setSummary(metadata.summary ?? '')
      setContent(sourceEvent.content ?? '')
    }
  }, [open, metadata, sourceEvent])

  const handlePublish = () => {
    checkLogin(async () => {
      if (!content.trim()) {
        toast.error(t('Content cannot be empty'))
        return
      }
      setPublishing(true)
      try {
        const draft = await createWikiForkDraftEvent(sourceEvent, content, [], {
          title: title.trim() || undefined,
          summary: summary.trim() || undefined
        })
        await publish(draft, { addClientTag: storage.getAddClientTag() })
        toast.success(t('Fork published'))
        onOpenChange(false)
      } catch (err) {
        showPublishingError(err as Error)
      } finally {
        setPublishing(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Fork this article')}</DialogTitle>
          <DialogDescription>
            {t(
              'Create your own version of this article. It keeps the same name so it competes as an alternative version.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="wiki-fork-title">{t('Title')}</Label>
            <Input
              id="wiki-fork-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wiki-fork-summary">{t('Summary')}</Label>
            <Input
              id="wiki-fork-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="wiki-fork-content">{t('Content')}</Label>
            <Textarea
              id="wiki-fork-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[240px] font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={publishing}>
            {t('Cancel')}
          </Button>
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? t('Publishing…') : t('Publish fork')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Create a kind:818 merge request from the user's own fork (`sourceEvent` is that fork). */
export function WikiMergeRequestDialog({
  open,
  onOpenChange,
  sourceEvent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceEvent: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (open) setMessage('')
  }, [open])

  const handlePublish = () => {
    checkLogin(async () => {
      const draft = createWikiMergeRequestFromForkDraftEvent(sourceEvent, message.trim())
      if (!draft) {
        toast.error(t('This article is not a fork, so it cannot be merged anywhere.'))
        return
      }
      setPublishing(true)
      try {
        await publish(draft, { addClientTag: storage.getAddClientTag() })
        toast.success(t('Merge request sent'))
        onOpenChange(false)
      } catch (err) {
        showPublishingError(err as Error)
      } finally {
        setPublishing(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Create merge request')}</DialogTitle>
          <DialogDescription>
            {t('Ask the original author to merge your changes into their article.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="wiki-mr-message">{t('Message (optional)')}</Label>
          <Textarea
            id="wiki-mr-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('Describe what you changed…')}
            className="min-h-[120px]"
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={publishing}>
            {t('Cancel')}
          </Button>
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? t('Publishing…') : t('Send merge request')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Create a kind:30819 redirect that points a slug at `sourceEvent`'s article. */
export function WikiRedirectDialog({
  open,
  onOpenChange,
  sourceEvent
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceEvent: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const [slug, setSlug] = useState('')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (open) setSlug('')
  }, [open])

  const normalized = normalizeWikiDTag(slug)

  const handlePublish = () => {
    checkLogin(async () => {
      if (!normalized) {
        toast.error(t('Enter a name to redirect'))
        return
      }
      setPublishing(true)
      try {
        await publish(createWikiRedirectDraftEvent(normalized, sourceEvent), {
          addClientTag: storage.getAddClientTag()
        })
        toast.success(t('Redirect published'))
        onOpenChange(false)
      } catch (err) {
        showPublishingError(err as Error)
      } finally {
        setPublishing(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Create redirect to this article')}</DialogTitle>
          <DialogDescription>
            {t('Point an alternative name at this article so searches for it land here.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="wiki-redirect-slug">{t('Name to redirect')}</Label>
          <Input
            id="wiki-redirect-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={t('e.g. BTC')}
          />
          {normalized && (
            <p className="text-xs text-muted-foreground">
              {t('Normalized: {{slug}}', { slug: normalized })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={publishing}>
            {t('Cancel')}
          </Button>
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? t('Publishing…') : t('Publish redirect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Review a kind:818 merge request (owner only): accept (merge) or reject. */
export function WikiMergeReviewDialog({
  open,
  onOpenChange,
  mergeRequest
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mergeRequest: Event
}) {
  const { t } = useTranslation()
  const { publish, checkLogin } = useNostr()
  const [busy, setBusy] = useState(false)
  const mr = useMemo(() => parseWikiMergeRequest(mergeRequest), [mergeRequest])

  const reject = () => {
    checkLogin(async () => {
      setBusy(true)
      try {
        await publish(createReactionDraftEvent(mergeRequest, '-'), {
          addClientTag: storage.getAddClientTag()
        })
        toast.success(t('Merge request rejected'))
        onOpenChange(false)
      } catch (err) {
        showPublishingError(err as Error)
      } finally {
        setBusy(false)
      }
    })
  }

  const accept = () => {
    checkLogin(async () => {
      if (!mr?.forkEventId || !mr.destinationCoordinate) {
        toast.error(t('This merge request is incomplete.'))
        return
      }
      const dTag = mr.destinationCoordinate.split(':').slice(2).join(':')
      if (!dTag) {
        toast.error(t('This merge request is incomplete.'))
        return
      }
      setBusy(true)
      try {
        const fork = await client.fetchEvent(mr.forkEventId)
        if (!fork) {
          toast.error(t('Could not load the proposed version.'))
          return
        }
        const forkMeta = getLongFormArticleMetadataFromEvent(fork)
        // Adopt the fork's content as a new version of your own article (same d tag).
        const mergedDraft = await createWikiArticleDraftEvent(fork.content, [], {
          dTag,
          title: forkMeta.title || undefined,
          summary: forkMeta.summary || undefined,
          image: forkMeta.image || undefined,
          topics: forkMeta.tags
        })
        const mergedVersion = await publish(mergedDraft, {
          addClientTag: storage.getAddClientTag()
        })
        await publish(createWikiMergeAcceptanceDraftEvent(mergeRequest, mergedVersion), {
          addClientTag: storage.getAddClientTag()
        })
        // Lightweight positive signal in addition to kind:819.
        await publish(createReactionDraftEvent(mergeRequest, '+'), {
          addClientTag: storage.getAddClientTag()
        })
        toast.success(t('Merge request accepted'))
        onOpenChange(false)
      } catch (err) {
        showPublishingError(err as Error)
      } finally {
        setBusy(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('Review merge request')}</DialogTitle>
          <DialogDescription>
            {t(
              'Accepting publishes the proposed content as a new version of your article and records a kind:819 acceptance.'
            )}
          </DialogDescription>
        </DialogHeader>
        {mergeRequest.content.trim() && (
          <p className="whitespace-pre-wrap break-words text-sm">{mergeRequest.content.trim()}</p>
        )}
        {mr?.forkEventId && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">{t('Proposed version:')}</p>
            <EmbeddedNote noteId={mr.forkEventId} containingEvent={mergeRequest} />
          </div>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('Cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={reject}
            disabled={busy}
          >
            {t('Reject')}
          </Button>
          <Button onClick={accept} disabled={busy}>
            {busy ? t('Working…') : t('Accept & merge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
