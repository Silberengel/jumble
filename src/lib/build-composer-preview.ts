import { ExtendedKind, POLL_TYPE } from '@/constants'
import {
  buildClientTag,
  stripImwaldAttributionTags,
  transformCustomEmojisInContent
} from '@/lib/draft-event'
import { normalizeTopic } from '@/lib/discussion-topics'
import { createFakeEvent } from '@/lib/event'
import { randomString } from '@/lib/random'
import { cleanUrl, rewritePlainTextHttpUrls } from '@/lib/url'
import { mergeContentWarningTagsFromDraftOptions, type TContentWarningDraftOptions } from '@/lib/content-warning'
import { serializePublishPreviewLabJson } from '@/lib/advanced-event-lab-slice'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { canonicalizeRssArticleUrl } from '@/lib/rss-article'
import { urlToWebBookmarkDTag } from '@/lib/web-bookmark-nip'
import type { HighlightData } from '@/components/PostEditor/HighlightEditor'
import type { WebBookmarkDraftData } from '@/components/PostEditor/WebBookmarkEditor'
import { TPollCreateData } from '@/types'
import { Event, kinds, nip19 } from 'nostr-tools'

export type ComposerArticlePreviewMetadata = {
  title?: string
  summary?: string
  image?: string
  dTag?: string
  topics?: string[]
  /** Kind 30817: each number becomes a `k` tag. */
  affectedKinds?: number[]
}

export type ComposerMusicTrackPreviewMetadata = {
  dTag?: string
  title?: string
  audioUrl?: string
  artist?: string
  imageUrl?: string
  album?: string
  durationSec?: number
  format?: string
  language?: string
  genres?: string[]
}

export type ComposerPreviewInput = {
  content: string
  kind?: number
  highlightData?: HighlightData
  webBookmarkData?: WebBookmarkDraftData
  pollCreateData?: TPollCreateData
  mediaImetaTags?: string[][]
  mediaUrl?: string
  articleMetadata?: ComposerArticlePreviewMetadata
  musicTrackMetadata?: ComposerMusicTrackPreviewMetadata
  extraPreviewTags?: string[][]
  addClientTag?: boolean
  contentWarning?: TContentWarningDraftOptions
}

export function processComposerPreviewContent({
  content,
  kind = 1,
  highlightData,
  pollCreateData
}: Pick<ComposerPreviewInput, 'content' | 'kind' | 'highlightData' | 'pollCreateData'>) {
  const cleanedContent = rewritePlainTextHttpUrls(content)
  const { content: processed, emojiTags: tags } = transformCustomEmojisInContent(cleanedContent)
  const customShortcodes = tags.map((t) => t[1]).filter(Boolean)
  const withNativeEmojis = replaceStandardEmojiShortcodesInContent(processed, customShortcodes)

  let highlightTags: string[][] = []
  if (kind === kinds.Highlights && highlightData) {
    if (highlightData.sourceType === 'url') {
      try {
        highlightTags.push([
          'r',
          cleanUrl(highlightData.sourceValue) || highlightData.sourceValue,
          'source'
        ])
      } catch {
        highlightTags.push(['r', highlightData.sourceValue, 'source'])
      }
    } else if (highlightData.sourceType === 'nostr') {
      if (highlightData.sourceHexId) {
        highlightTags.push(['e', highlightData.sourceHexId])
      } else if (highlightData.sourceValue) {
        try {
          const decoded = nip19.decode(highlightData.sourceValue)
          if (decoded.type === 'note' || decoded.type === 'nevent') {
            const hexId = decoded.type === 'note' ? decoded.data : decoded.data.id
            highlightTags.push(['e', hexId])
          } else if (decoded.type === 'naddr') {
            const { kind: addrKind, pubkey, identifier } = decoded.data
            highlightTags.push(['a', `${addrKind}:${pubkey}:${identifier}`])
          }
        } catch {
          highlightTags.push(['r', highlightData.sourceValue])
        }
      }
    }
    if (highlightData.context) {
      highlightTags.push(['context', highlightData.context])
    }
  }

  let pollTags: string[][] = []
  if (kind === ExtendedKind.POLL && pollCreateData) {
    const validOptions = pollCreateData.options.filter((opt) => opt.trim())
    pollTags.push(...validOptions.map((option) => ['option', randomString(9), option.trim()]))
    pollTags.push([
      'polltype',
      pollCreateData.isMultipleChoice ? POLL_TYPE.MULTIPLE_CHOICE : POLL_TYPE.SINGLE_CHOICE
    ])
    if (pollCreateData.endsAt) {
      pollTags.push(['endsAt', pollCreateData.endsAt.toString()])
    }
    if (pollCreateData.relays.length > 0) {
      pollCreateData.relays.forEach((relay) => {
        pollTags.push(['relay', relay])
      })
    }
  }

  return {
    content: withNativeEmojis,
    emojiTags: tags,
    highlightTags,
    pollTags
  }
}

export function buildComposerPreviewBaseTags(
  input: ComposerPreviewInput,
  processed: ReturnType<typeof processComposerPreviewContent>
): string[][] {
  const {
    kind = 1,
    mediaImetaTags,
    articleMetadata,
    musicTrackMetadata,
    webBookmarkData,
    extraPreviewTags
  } = input
  const { emojiTags, highlightTags, pollTags } = processed
  const tags = [...emojiTags, ...highlightTags, ...pollTags]

  if (mediaImetaTags && mediaImetaTags.length > 0) {
    tags.push(...mediaImetaTags)
  }

  if (
    articleMetadata &&
    (kind === kinds.LongFormArticle ||
      kind === ExtendedKind.WIKI_ARTICLE ||
      kind === ExtendedKind.NOSTR_SPECIFICATION ||
      kind === ExtendedKind.PUBLICATION_CONTENT)
  ) {
    if (articleMetadata.dTag) tags.push(['d', articleMetadata.dTag])
    if (articleMetadata.title) tags.push(['title', articleMetadata.title])
    if (articleMetadata.summary) tags.push(['summary', articleMetadata.summary])
    if (kind !== ExtendedKind.NOSTR_SPECIFICATION && articleMetadata.image) {
      tags.push(['image', articleMetadata.image])
    }
    if (kind === ExtendedKind.NOSTR_SPECIFICATION && articleMetadata.affectedKinds?.length) {
      for (const k of articleMetadata.affectedKinds) {
        tags.push(['k', String(k)])
      }
    }
    if (articleMetadata.topics && articleMetadata.topics.length > 0) {
      const normalizedTopics = articleMetadata.topics
        .map((topic) => normalizeTopic(topic.trim()))
        .filter((topic) => topic.length > 0)
      tags.push(...normalizedTopics.map((topic) => ['t', topic]))
    }
  }

  if (musicTrackMetadata && kind === ExtendedKind.MUSIC_TRACK) {
    if (musicTrackMetadata.dTag) tags.push(['d', musicTrackMetadata.dTag])
    if (musicTrackMetadata.title) tags.push(['title', musicTrackMetadata.title])
    if (musicTrackMetadata.audioUrl) tags.push(['url', musicTrackMetadata.audioUrl])
    tags.push(['t', 'music'])
    if (musicTrackMetadata.artist) tags.push(['artist', musicTrackMetadata.artist])
    if (musicTrackMetadata.imageUrl) tags.push(['image', musicTrackMetadata.imageUrl])
    if (musicTrackMetadata.album) tags.push(['album', musicTrackMetadata.album])
    if (musicTrackMetadata.durationSec) {
      tags.push(['duration', String(musicTrackMetadata.durationSec)])
    }
    if (musicTrackMetadata.format) tags.push(['format', musicTrackMetadata.format])
    if (musicTrackMetadata.language) tags.push(['language', musicTrackMetadata.language])
    if (musicTrackMetadata.genres?.length) {
      for (const g of musicTrackMetadata.genres) {
        const topic = normalizeTopic(g.trim())
        if (topic && topic !== 'music') tags.push(['t', topic])
      }
    }
  }

  if (webBookmarkData?.url && kind === ExtendedKind.WEB_BOOKMARK) {
    const canonical = canonicalizeRssArticleUrl(webBookmarkData.url)
    const d = urlToWebBookmarkDTag(canonical)
    if (d) tags.push(['d', d])
    if (webBookmarkData.title) tags.push(['title', webBookmarkData.title])
  }

  if (extraPreviewTags?.length) {
    tags.push(...extraPreviewTags)
  }

  return tags
}

export function buildComposerPreviewEventContent(
  input: ComposerPreviewInput,
  processedContent: string
): string {
  const { kind = 1, mediaUrl } = input
  if (
    (kind === ExtendedKind.VOICE_COMMENT || kind === ExtendedKind.VOICE) &&
    mediaUrl &&
    !processedContent.includes(mediaUrl)
  ) {
    return mediaUrl + (processedContent ? '\n\n' + processedContent : '')
  }
  return processedContent
}

export function buildComposerPreviewEvent(input: ComposerPreviewInput): Event {
  const kind = input.kind ?? 1
  const processed = processComposerPreviewContent(input)
  const baseTags = buildComposerPreviewBaseTags(input, processed)
  const tags = stripImwaldAttributionTags(baseTags.map((row) => [...row]))
  if (input.contentWarning) {
    mergeContentWarningTagsFromDraftOptions(tags, input.contentWarning)
  }
  if (input.addClientTag !== false) {
    tags.push(buildClientTag())
  }
  return createFakeEvent({
    kind,
    content: buildComposerPreviewEventContent(input, processed.content),
    tags
  })
}

/** Publish-shaped JSON draft (`kind`, `content`, `created_at`, `tags`) for the composer. */
export function serializeComposerPreviewJson(input: ComposerPreviewInput): string {
  const kind = input.kind ?? 1
  const processed = processComposerPreviewContent(input)
  const baseTags = buildComposerPreviewBaseTags(input, processed)
  return serializePublishPreviewLabJson(
    {
      kind,
      content: buildComposerPreviewEventContent(input, processed.content),
      tags: baseTags.map((row) => [...row])
    },
    {
      addClientTag: input.addClientTag,
      contentWarning: input.contentWarning
    }
  )
}

export function composerPreviewHasBody(input: ComposerPreviewInput): boolean {
  const processed = processComposerPreviewContent(input)
  const {
    kind = 1,
    mediaUrl,
    articleMetadata,
    musicTrackMetadata,
    pollCreateData,
    highlightData,
    webBookmarkData,
    mediaImetaTags
  } = input

  if (processed.content.trim()) return true
  if (mediaUrl?.trim()) return true
  if (articleMetadata?.title?.trim()) return true
  if (articleMetadata?.summary?.trim()) return true
  if (musicTrackMetadata?.title?.trim()) return true
  if (musicTrackMetadata?.audioUrl?.trim()) return true
  if (kind === ExtendedKind.POLL && pollCreateData?.options.some((o) => o.trim())) return true
  if (kind === kinds.Highlights && highlightData?.sourceValue?.trim()) return true
  if (kind === ExtendedKind.WEB_BOOKMARK && webBookmarkData?.url?.trim()) return true
  if ((mediaImetaTags?.length ?? 0) > 0) return true
  return false
}
