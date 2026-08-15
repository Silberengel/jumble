import { ExtendedKind, isMusicTrackKind, isNip71StyleVideoKind } from '@/constants'
import { getCalendarEventMeta, isCalendarEventKind } from '@/lib/calendar-event'
import { getKindDescription } from '@/lib/kind-description'
import { getMusicTrackFromEvent, musicTrackDisplayLine } from '@/lib/music-track'
import {
  getLiveEventMetadataFromEvent,
  getLongFormArticleMetadataFromEvent,
  getPublicationIndexMetadataFromEvent
} from '@/lib/event-metadata'
import { tagNameEquals } from '@/lib/tag'
import { formatNip32LabelSnippet } from '@/lib/nip32-label'
import { stripTrailingStringifiedNostrEvent } from '@/lib/nostr-event-json'
import { getWebBookmarkArticleUrl } from '@/lib/rss-article'
import { wikilinksToPlaintext } from '@/lib/wikilink'
import { Event, kinds } from 'nostr-tools'

export const PARENT_REPLY_BLURB_MAX = 150

/** Strip common markdown / asciidoc / HTML so parent reply strips stay one line (matches NotePage preview). */
export function stripMarkupForPreview(content: string): string {
  let text = stripTrailingStringifiedNostrEvent(content)
  text = wikilinksToPlaintext(text)
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/^=+\s+/gm, '')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

function truncateBlurb(s: string, max: number): string {
  const normalized = s.trim().replace(/\s+/g, ' ')
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max)}…`
}

/**
 * One-line preview for {@link ParentNotePreview}: prefer `title` / `subject` / kind metadata, else first
 * {@link PARENT_REPLY_BLURB_MAX} characters of markup-stripped `content`.
 */
export function getParentReplyBlurbDisplayText(
  event: Event,
  maxLen: number = PARENT_REPLY_BLURB_MAX
): string {
  const titleTag = event.tags.find(tagNameEquals('title'))?.[1]?.trim()
  if (titleTag) return truncateBlurb(stripMarkupForPreview(titleTag), maxLen)

  const subjectTag = event.tags.find(tagNameEquals('subject'))?.[1]?.trim()
  if (subjectTag) return truncateBlurb(stripMarkupForPreview(subjectTag), maxLen)

  if (event.kind === kinds.Label) {
    const labelSnippet = formatNip32LabelSnippet(event, maxLen)
    if (labelSnippet) return labelSnippet
  }

  if (
    event.kind === kinds.LongFormArticle ||
    event.kind === ExtendedKind.PUBLICATION ||
    event.kind === ExtendedKind.PUBLICATION_CONTENT ||
    event.kind === ExtendedKind.WIKI_ARTICLE ||
    event.kind === ExtendedKind.NOSTR_SPECIFICATION
  ) {
    const meta =
      event.kind === ExtendedKind.PUBLICATION
        ? getPublicationIndexMetadataFromEvent(event)
        : getLongFormArticleMetadataFromEvent(event)
    if (meta.title?.trim()) return truncateBlurb(stripMarkupForPreview(meta.title.trim()), maxLen)
    if (meta.summary?.trim()) {
      return truncateBlurb(stripMarkupForPreview(meta.summary), maxLen)
    }
  }

  if (
    event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT ||
    event.kind === ExtendedKind.GIT_ISSUE ||
    event.kind === ExtendedKind.GIT_RELEASE
  ) {
    const nameTag = event.tags.find(tagNameEquals('name'))?.[1]?.trim()
    if (nameTag) return truncateBlurb(stripMarkupForPreview(nameTag), maxLen)
    const releaseTag = event.tags.find((t) => t[0] === 'tag')?.[1]?.trim()
    if (releaseTag && event.kind === ExtendedKind.GIT_RELEASE) {
      return truncateBlurb(stripMarkupForPreview(releaseTag), maxLen)
    }
    const descriptionTag = event.tags.find(tagNameEquals('description'))?.[1]?.trim()
    if (descriptionTag && event.kind === ExtendedKind.GIT_REPO_ANNOUNCEMENT) {
      return truncateBlurb(stripMarkupForPreview(descriptionTag), maxLen)
    }
  }

  if (isCalendarEventKind(event.kind)) {
    const cal = getCalendarEventMeta(event)
    if (cal.title?.trim()) return truncateBlurb(stripMarkupForPreview(cal.title), maxLen)
    if (cal.summary?.trim()) return truncateBlurb(stripMarkupForPreview(cal.summary), maxLen)
  }

  if (event.kind === ExtendedKind.WEB_BOOKMARK) {
    const href = getWebBookmarkArticleUrl(event)
    if (href) return truncateBlurb(href, maxLen)
  }

  if (event.kind === ExtendedKind.LEARNING_RESOURCE) {
    const name = event.tags.find(tagNameEquals('name'))?.[1]?.trim()
    if (name) return truncateBlurb(stripMarkupForPreview(name), maxLen)
  }

  if (event.kind === ExtendedKind.GROUP_METADATA || event.kind === kinds.CommunityDefinition) {
    const name = event.tags.find(tagNameEquals('name'))?.[1]?.trim()
    if (name) return truncateBlurb(stripMarkupForPreview(name), maxLen)
  }

  if (event.kind === ExtendedKind.FOLLOW_PACK) {
    const name = event.tags.find(tagNameEquals('name'))?.[1]?.trim()
    if (name) return truncateBlurb(stripMarkupForPreview(name), maxLen)
  }

  if (event.kind === kinds.LiveEvent || event.kind === 30312 || event.kind === 30313) {
    const live = getLiveEventMetadataFromEvent(event)
    const rawTitle = live.title?.trim()
    if (rawTitle && rawTitle !== 'no title') return truncateBlurb(stripMarkupForPreview(rawTitle), maxLen)
    if (live.summary?.trim()) return truncateBlurb(stripMarkupForPreview(live.summary), maxLen)
  }

  if (isMusicTrackKind(event.kind)) {
    const track = getMusicTrackFromEvent(event)
    if (track) return truncateBlurb(musicTrackDisplayLine(track), maxLen)
  }

  if (event.kind === ExtendedKind.PICTURE || isNip71StyleVideoKind(event.kind)) {
    const cap = truncateBlurb(stripMarkupForPreview(event.content ?? ''), maxLen)
    return cap
  }

  return truncateBlurb(stripMarkupForPreview(event.content ?? ''), maxLen)
}

export function parentReplyPollQuestionBlurb(content: string, maxLen = PARENT_REPLY_BLURB_MAX): string {
  return truncateBlurb(stripMarkupForPreview(content ?? ''), maxLen)
}

/** Short kind label when no title/subject/content snippet is available. */
export function getParentReplyBlurbFallbackLabel(event: Event): string {
  return getKindDescription(event.kind, event).description
}
