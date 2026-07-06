import { EmbeddedNote } from '@/components/Embedded/EmbeddedNote'
import { Button } from '@/components/ui/button'
import { FormattedTimestamp } from '@/components/FormattedTimestamp'
import Username from '@/components/Username'
import {
  useFetchWikiMergeRequests,
  useFetchWikiMergeStatus,
  useWikiMergeReviewActions
} from '@/hooks/useWikiCollab'
import {
  getReplaceableCoordinateFromEvent,
  normalizeReplaceableCoordinateString
} from '@/lib/event'
import { hexPubkeysEqual } from '@/lib/pubkey'
import {
  coordinateToNaddr,
  getWikiDeferTarget,
  getWikiForkSource,
  parseWikiMergeAcceptance,
  parseWikiMergeRequest,
  parseWikiRedirect,
  wikiMergeRequestResolution,
  type WikiReference
} from '@/lib/nip54'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import {
  Check,
  GitFork,
  GitMerge,
  GitPullRequest,
  Signpost,
  ThumbsDown,
  ThumbsUp
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Event } from 'nostr-tools'

function articleCoordinate(event: Event): string | undefined {
  const coord = getReplaceableCoordinateFromEvent(event)
  return coord ? normalizeReplaceableCoordinateString(coord) : undefined
}

/** Best embeddable pointer (naddr from coordinate, else event id) for a wiki reference. */
function referenceNoteId(ref: WikiReference): string | null {
  if (ref.coordinate) {
    const naddr = coordinateToNaddr(ref.coordinate, ref.relayHint)
    if (naddr) return naddr
  }
  return ref.eventId ?? null
}

function CardShell({
  icon,
  title,
  event,
  children,
  className
}: {
  icon: React.ReactNode
  title: React.ReactNode
  event: Event
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border p-3', className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span className="break-words">{title}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Username userId={event.pubkey} className="font-medium" />
        <span>·</span>
        <FormattedTimestamp timestamp={event.created_at} short />
      </div>
      {children}
    </div>
  )
}

/** kind:30819 — redirect/disambiguation: this slug points at another article. */
export function WikiRedirectCard({ event, className }: { event: Event; className?: string }) {
  const { t } = useTranslation()
  const redirect = useMemo(() => parseWikiRedirect(event), [event])
  const targetNaddr = useMemo(
    () =>
      redirect?.targetCoordinate
        ? coordinateToNaddr(redirect.targetCoordinate, redirect.relayHint)
        : null,
    [redirect]
  )
  return (
    <CardShell
      className={className}
      event={event}
      icon={<Signpost className="h-4 w-4 text-primary shrink-0" />}
      title={
        redirect?.slug
          ? t('Redirect: “{{slug}}”', { slug: redirect.slug })
          : t('Wiki Redirect')
      }
    >
      <p className="mt-2 text-sm text-muted-foreground">{t('This name redirects to:')}</p>
      {targetNaddr ? (
        <EmbeddedNote className="mt-2" noteId={targetNaddr} containingEvent={event} />
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t('Unknown target')}</p>
      )}
    </CardShell>
  )
}

/** kind:819 — records that a kind:818 merge request was accepted. */
export function WikiMergeAcceptanceCard({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const acceptance = useMemo(() => parseWikiMergeAcceptance(event), [event])
  return (
    <CardShell
      className={className}
      event={event}
      icon={<GitMerge className="h-4 w-4 text-green-600 shrink-0" />}
      title={t('Accepted a merge request')}
    >
      {acceptance?.resultEventId && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">{t('Merged version:')}</p>
          <EmbeddedNote
            className="mt-2"
            noteId={acceptance.resultEventId}
            containingEvent={event}
          />
        </>
      )}
    </CardShell>
  )
}

function MergeStatusBadge({ mergeRequest }: { mergeRequest: Event }) {
  const { t } = useTranslation()
  const { acceptances, reactions } = useFetchWikiMergeStatus(mergeRequest)
  const { accepts, rejects } = useMemo(() => {
    let accepts = 0
    let rejects = 0
    for (const r of reactions) {
      const c = r.content.trim()
      if (c === '-') rejects++
      else accepts++ // '+', '', emoji → treat as positive per NIP-25
    }
    return { accepts, rejects }
  }, [reactions])

  if (acceptances.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-600/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
        <Check className="h-3 w-3" />
        {t('Merged')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <ThumbsUp className="h-3 w-3" />
        {accepts}
      </span>
      <span className="inline-flex items-center gap-1">
        <ThumbsDown className="h-3 w-3" />
        {rejects}
      </span>
    </span>
  )
}

/** kind:818 — proposes merging a forked version into the original article. */
export function WikiMergeRequestCard({
  event,
  className,
  showFull = false,
  contextArticle
}: {
  event: Event
  className?: string
  showFull?: boolean
  /** When set (article note page), hides redundant “into article” embed for the open article. */
  contextArticle?: Event
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const mr = useMemo(() => parseWikiMergeRequest(event), [event])
  const { acceptances, reactions } = useFetchWikiMergeStatus(event)
  const { busy, reject, accept, localResolution } = useWikiMergeReviewActions(event)
  const resolution = useMemo(
    () =>
      localResolution ?? wikiMergeRequestResolution(event, acceptances, reactions),
    [event, acceptances, reactions, localResolution]
  )
  const isOwner = Boolean(
    pubkey && mr?.destinationPubkey && hexPubkeysEqual(mr.destinationPubkey, pubkey)
  )
  const destinationNaddr = useMemo(
    () =>
      mr?.destinationCoordinate ? coordinateToNaddr(mr.destinationCoordinate, mr.relayHint) : null,
    [mr]
  )
  const showDestinationEmbed = useMemo(() => {
    if (!destinationNaddr || !contextArticle) return Boolean(destinationNaddr)
    const destCoord = mr?.destinationCoordinate
      ? normalizeReplaceableCoordinateString(mr.destinationCoordinate)
      : undefined
    const ctxCoord = articleCoordinate(contextArticle)
    return !destCoord || !ctxCoord || destCoord !== ctxCoord
  }, [contextArticle, destinationNaddr, mr?.destinationCoordinate])

  if (resolution !== 'open') return null

  return (
    <CardShell
      className={className}
      event={event}
      icon={<GitPullRequest className="h-4 w-4 text-primary shrink-0" />}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {t('Merge request')}
          <MergeStatusBadge mergeRequest={event} />
        </span>
      }
    >
      {event.content.trim() && (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{event.content.trim()}</p>
      )}
      {showDestinationEmbed && destinationNaddr ? (
        <>
          <p className="mt-2 text-xs text-muted-foreground">{t('Into article:')}</p>
          <EmbeddedNote className="mt-1" noteId={destinationNaddr} containingEvent={event} />
        </>
      ) : null}
      {mr?.forkEventId && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">{t('Proposed version:')}</p>
          <EmbeddedNote
            className="mt-1"
            noteId={mr.forkEventId}
            containingEvent={event}
            showFull={showFull}
          />
        </>
      )}
      {isOwner ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              reject()
            }}
          >
            <ThumbsDown className="size-4 shrink-0" aria-hidden />
            {t('Reject')}
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              accept()
            }}
          >
            <ThumbsUp className="size-4 shrink-0" aria-hidden />
            {busy ? t('Working…') : t('Accept & merge')}
          </Button>
        </div>
      ) : null}
    </CardShell>
  )
}

/**
 * Collaboration chrome for a kind:30818 article page: a banner if this article is itself a fork or
 * a deference, plus the list of incoming kind:818 merge requests targeting it.
 */
export function WikiArticleCollabSection({
  event,
  className
}: {
  event: Event
  className?: string
}) {
  const { t } = useTranslation()
  const forkSource = useMemo(() => getWikiForkSource(event), [event])
  const deferTarget = useMemo(() => getWikiDeferTarget(event), [event])
  const forkSourceNoteId = forkSource ? referenceNoteId(forkSource) : null
  const deferTargetNoteId = deferTarget ? referenceNoteId(deferTarget) : null
  const { mergeRequests } = useFetchWikiMergeRequests(event)

  const hasAnything = forkSourceNoteId || deferTargetNoteId || mergeRequests.length > 0
  if (!hasAnything) return null

  return (
    <div className={cn('mt-2 space-y-3', className)}>
      {deferTargetNoteId && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <Signpost className="h-4 w-4 shrink-0" />
            {t('The author defers to another version:')}
          </div>
          <EmbeddedNote className="mt-2" noteId={deferTargetNoteId} containingEvent={event} />
        </div>
      )}
      {forkSourceNoteId && (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitFork className="h-4 w-4 text-primary shrink-0" />
            {t('Forked from:')}
          </div>
          <EmbeddedNote className="mt-2" noteId={forkSourceNoteId} containingEvent={event} />
        </div>
      )}
      {mergeRequests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitPullRequest className="h-4 w-4 text-primary shrink-0" />
            {t('Merge requests')}
          </div>
          {mergeRequests.map((mr) => (
            <WikiMergeRequestCard key={mr.id} event={mr} contextArticle={event} />
          ))}
        </div>
      )}
    </div>
  )
}
