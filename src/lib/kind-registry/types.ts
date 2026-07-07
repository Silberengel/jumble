import type { ReactNode } from 'react'
import type { Event } from 'nostr-tools'
import type { Manifest } from './manifest-types'

/** Where the event body is rendered. */
export type Surface = 'timeline' | 'focused' | 'embed' | 'preview' | 'reader'

export type PreviewDensity = 'default' | 'compact'

/** Engagement actions a kind declares for the stats bar. */
export type ActionId = 'reply' | 'repost' | 'like' | 'zap' | 'bookmark'

/** Context passed to every kind body renderer. */
export type RenderCtx = {
  event: Event
  /** Translated / short-note-edited view of {@link event}. */
  displayEvent: Event
  surface: Surface
  className?: string
  showFull: boolean
  embedded?: boolean
  hideMetadata?: boolean
  /** Suppress NIP-23 title headings when a parent (e.g. hero card) already shows the title. */
  hideTitle?: boolean
  autoLoadMedia: boolean
  fullCalendarInvite?: { event: Event; naddr: string }
  nip84HighlightEvents?: Event[]
  deferAuthorAvatar?: boolean
  hidePollOptions?: boolean
  showPaymentAttestationAction?: boolean
  previewDensity?: PreviewDensity
  forParentReplyBlurb?: boolean
  replyContext?: Event
  duplicateWebPreviewCleanedUrlHints?: string[]
  isShortNoteEdited?: boolean
  shortNoteEditOriginalContent?: string
  shortNoteEditRevisedContent?: string
  originalNoteId?: string
}

export type KindHandler = {
  kinds: readonly number[]
  /** Declarative read-only card — used when {@link render} is absent or returns undefined. */
  manifest?: Manifest
  /** Primary body renderer for timeline / focused / embed / reader surfaces. */
  render?: (ctx: RenderCtx) => ReactNode | null | undefined
  /** Preview surface (ContentPreview, embed blurb). Falls back to {@link render} then manifest. */
  renderPreview?: (ctx: RenderCtx) => ReactNode | null | undefined
  /** One-line parent-reply blurb; when set, ContentPreview uses this instead of full preview. */
  renderBlurb?: (ctx: RenderCtx) => string | null | undefined
  /** When true (default), kind appears in feed filters and embedded-note routing. */
  renderable?: boolean
  /** OP highlight selection on note page. */
  highlightable?: boolean
  /** Full-page reader route (long-form / wiki / publication). */
  reader?: boolean
  /** Body is intentionally empty (e.g. reactions rendered in header). */
  hideBody?: boolean
  actions?: readonly ActionId[]
  /** Human-readable type name for link previews and page titles. */
  typeName?: string
}

export function deriveSurface(opts: {
  embedded?: boolean
  showFull?: boolean
  forPreview?: boolean
}): Surface {
  if (opts.forPreview) return 'preview'
  if (opts.embedded) return 'embed'
  if (opts.showFull) return 'focused'
  return 'timeline'
}
