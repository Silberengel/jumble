import { ExtendedKind } from '@/constants'
import {
  notificationReactionSummaryKey,
  useNotificationReactionDisplay
} from '@/hooks/useNotificationReactionDisplay'
import { isMentioningMutedUsers, isNip25ReactionKind } from '@/lib/event'
import {
  getReplyShortNoteEditId,
  mergeEditedShortNote,
  resolveShortNoteParentForReplyBlurb
} from '@/lib/short-note-edits'
import { mergeTranslatedNote, useNoteTranslation } from '@/lib/note-translation-display'
import { useShortNoteEdits } from '@/hooks/useShortNoteEdits'
import { useFetchEvent } from '@/hooks'
import { cn } from '@/lib/utils'
import { useContentPolicyOptional } from '@/providers/ContentPolicyProvider'
import { useMuteListOptional } from '@/contexts/mute-list-context'
import { muteSetHas } from '@/lib/mute-set'
import { KindEventPreview } from '@/lib/kind-registry/render'
import { deriveSurface, type RenderCtx } from '@/lib/kind-registry/types'
import { handlerFor } from '@/lib/kind-registry/registry'
import { resolveBlurbLine } from '@/lib/kind-registry/handlers/custom-blurbs'
import { Event, kinds } from 'nostr-tools'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import NoteKindLabel from '../Note/NoteKindLabel'
import EventPowLabel from '../EventPowLabel'

/** Inert event so hooks can run before `event` is defined. */
const CONTENT_PREVIEW_HOOK_PLACEHOLDER = {
  kind: kinds.ShortTextNote,
  id: '',
  pubkey: '',
  content: '',
  tags: [],
  created_at: 0,
  sig: ''
} as Event

/** Keep spacing/margins on the outer wrapper; put line-clamp on the preview body so it still clamps text. */
function splitPreviewLayoutClasses(className?: string) {
  if (!className?.trim()) return { outer: undefined, body: undefined }
  const tokens = className.trim().split(/\s+/)
  const body: string[] = []
  const outer: string[] = []
  for (const tok of tokens) {
    if (tok.startsWith('line-clamp')) body.push(tok)
    else outer.push(tok)
  }
  return {
    outer: outer.length ? outer.join(' ') : undefined,
    body: body.length ? body.join(' ') : undefined
  }
}

export default function ContentPreview({
  event,
  className,
  previewDensity,
  forParentReplyBlurb = false,
  replyContext,
  hidePollOptions = false
}: {
  event?: Event
  className?: string
  previewDensity?: 'default' | 'compact'
  forParentReplyBlurb?: boolean
  replyContext?: Event
  hidePollOptions?: boolean
}) {
  const { t } = useTranslation()
  const noteTr = useNoteTranslation(event?.id ?? '')
  const replyEditId =
    forParentReplyBlurb && replyContext ? getReplyShortNoteEditId(replyContext) : undefined
  const { event: pinnedReplyEdit } = useFetchEvent(replyEditId)
  const shortNoteEditState = useShortNoteEdits(
    !forParentReplyBlurb && event?.kind === kinds.ShortTextNote ? event : undefined
  )
  const reactionDisplay = useNotificationReactionDisplay(event ?? CONTENT_PREVIEW_HOOK_PLACEHOLDER)
  const muteList = useMuteListOptional()
  const mutePubkeySet = muteList?.mutePubkeySet ?? new Set<string>()
  const contentPolicy = useContentPolicyOptional()
  const hideContentMentioningMutedUsers = contentPolicy?.hideContentMentioningMutedUsers ?? false
  const isMuted = useMemo(
    () => (event ? muteSetHas(mutePubkeySet, event.pubkey) : false),
    [mutePubkeySet, event]
  )
  const isMentioningMuted = useMemo(
    () =>
      hideContentMentioningMutedUsers && event
        ? isMentioningMutedUsers(event, mutePubkeySet)
        : false,
    [event, mutePubkeySet, hideContentMentioningMutedUsers]
  )

  const previewEvent = useMemo(() => {
    if (!event) return null
    let base = event
    if (event.kind === kinds.ShortTextNote) {
      if (forParentReplyBlurb) {
        if (replyContext) {
          base = resolveShortNoteParentForReplyBlurb(event, replyContext, pinnedReplyEdit)
        }
      } else if (shortNoteEditState?.latestAuthorEdit) {
        base = mergeEditedShortNote(event, shortNoteEditState.latestAuthorEdit)
      }
    }
    return mergeTranslatedNote(base, noteTr)
  }, [
    event,
    noteTr,
    forParentReplyBlurb,
    replyContext,
    pinnedReplyEdit,
    shortNoteEditState?.latestAuthorEdit
  ])

  if (!event) {
    return <div className={cn('pointer-events-none', className)}>{`[${t('Note not found')}]`}</div>
  }

  if (isMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>[{t('This user has been muted')}]</div>
    )
  }

  if (isMentioningMuted) {
    return (
      <div className={cn('pointer-events-none', className)}>
        [{t('This note mentions a user you muted')}]
      </div>
    )
  }

  const resolvedPreviewEvent = previewEvent ?? event
  const { outer: previewOuter, body: previewBody } = splitPreviewLayoutClasses(className)

  const previewCtx: RenderCtx = {
    event,
    displayEvent: resolvedPreviewEvent,
    surface: deriveSurface({ forPreview: true }),
    showFull: false,
    autoLoadMedia: true,
    previewDensity,
    hidePollOptions,
    forParentReplyBlurb,
    replyContext
  }

  const withKindRow = (node: React.ReactNode) => (
    <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <NoteKindLabel kind={resolvedPreviewEvent.kind} event={resolvedPreviewEvent} size="small" />
        <EventPowLabel event={resolvedPreviewEvent} />
      </div>
      <div className={cn('min-w-0', previewBody)}>{node}</div>
    </div>
  )

  if (forParentReplyBlurb) {
    const line = resolveBlurbLine(
      previewCtx,
      t,
      isNip25ReactionKind(event.kind)
        ? notificationReactionSummaryKey(reactionDisplay)
        : undefined
    )
    return (
      <div className={cn('pointer-events-none min-w-0 text-muted-foreground', previewOuter)}>
        <div className={cn('min-w-0 truncate text-sm', previewBody)}>{line}</div>
      </div>
    )
  }

  const handler = handlerFor(event.kind)
  const previewNode = <KindEventPreview {...previewCtx} />

  if (!handler) {
    return withKindRow(
      <div className="text-sm text-muted-foreground">
        [{t('Cannot handle event of kind k', { k: resolvedPreviewEvent.kind })}]
      </div>
    )
  }

  if (event.kind === ExtendedKind.DISCUSSION) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', previewOuter)}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <NoteKindLabel kind={resolvedPreviewEvent.kind} event={resolvedPreviewEvent} size="small" />
          <EventPowLabel event={resolvedPreviewEvent} />
        </div>
        <div className={cn('min-w-0', previewBody)}>{previewNode}</div>
      </div>
    )
  }

  return withKindRow(previewNode)
}
