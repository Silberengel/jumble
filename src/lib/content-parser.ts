import { isYouTubeUrl } from '@/lib/youtube-url'
import {
  HASHTAG_REGEX,
  LN_INVOICE_REGEX,
  WS_URL_REGEX
} from '@/constants'
import {
  EMBEDDED_EVENT_REGEX,
  EMBEDDED_MENTION_REGEX,
  EMOJI_SHORT_CODE_REGEX
} from '@/lib/content-patterns'
import { PAYTO_URI_REGEX } from '@/lib/payto'
import { parseAboutContentWithCoinPayto } from '@/lib/payto-about-coin-lines'
import { logContentSpacing, reprString } from '@/lib/content-spacing-debug'
import { findHttpUrlsInText, isBlossomBudBlobUrl, isHlsPlaylistUrl, isImage, isMedia } from '@/lib/url'
import { isSpotifyOpenUrl } from './spotify-url'
import { isFountainOpenUrl } from './fountain-url'
import { isWavlakeOpenUrl } from './wavlake-url'
import { isZapStreamWatchUrl } from './zap-stream-url'
import { WIKILINK_INLINE_REGEX, isCitationWikilink } from './wikilink'

export type TEmbeddedNodeType =
  | 'text'
  | 'image'
  | 'images'
  | 'media'
  | 'event'
  | 'mention'
  | 'legacy-mention'
  | 'hashtag'
  | 'websocket-url'
  | 'url'
  | 'emoji'
  | 'invoice'
  | 'youtube'
  | 'spotify'
  | 'wavlake'
  | 'fountain'
  | 'zapstream'
  | 'payto'
  | 'wikilink'

export type TEmbeddedNode =
  | {
      type: Exclude<TEmbeddedNodeType, 'images'>
      data: string
    }
  | {
      type: 'images'
      data: string[]
    }

type TContentParser =
  | { type: Exclude<TEmbeddedNodeType, 'images'>; regex: RegExp }
  | ((content: string) => TEmbeddedNode[])

export const EmbeddedHashtagParser: TContentParser = {
  type: 'hashtag',
  regex: HASHTAG_REGEX
}

export const EmbeddedMentionParser: TContentParser = {
  type: 'mention',
  regex: EMBEDDED_MENTION_REGEX
}

const EmbeddedEventParser: TContentParser = {
  type: 'event',
  regex: EMBEDDED_EVENT_REGEX
}

export const EmbeddedWebsocketUrlParser: TContentParser = {
  type: 'websocket-url',
  regex: WS_URL_REGEX
}

const EmbeddedEmojiParser: TContentParser = {
  type: 'emoji',
  regex: EMOJI_SHORT_CODE_REGEX
}

const EmbeddedLNInvoiceParser: TContentParser = {
  type: 'invoice',
  regex: LN_INVOICE_REGEX
}

/** payto:// URIs (RFC-8905 / NIP-A3) – e.g. in profile about or note content */
export const EmbeddedPaytoParser: TContentParser = {
  type: 'payto',
  regex: PAYTO_URI_REGEX
}

/** `XMR: 4abc…` lines in profile about (catalog coin labels). */
export const EmbeddedAboutCoinPaytoParser: TContentParser = parseAboutContentWithCoinPayto

/**
 * NIP-54-style wiki links: `[[Term]]` or `[[target|display]]`. The matched node stores the inner
 * content (without brackets); citations (`[[citation::…]]`) are left as plain text.
 */
export const EmbeddedWikilinkParser: TContentParser = (content: string) => {
  const result: TEmbeddedNode[] = []
  let lastIndex = 0
  const regex = new RegExp(WIKILINK_INLINE_REGEX.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const inner = match[1]
    if (isCitationWikilink(inner)) continue
    const matchStart = match.index
    if (matchStart > lastIndex) {
      result.push({ type: 'text', data: content.slice(lastIndex, matchStart) })
    }
    result.push({ type: 'wikilink', data: inner })
    lastIndex = matchStart + match[0].length
  }
  if (lastIndex < content.length) {
    result.push({ type: 'text', data: content.slice(lastIndex) })
  }
  return result
}

export const EmbeddedUrlParser: TContentParser = (content: string) => {
  const matches = findHttpUrlsInText(content)
  const result: TEmbeddedNode[] = []
  let lastIndex = 0
  
  for (const { url, index: matchStart } of matches) {
    // Add text before the match
    if (matchStart > lastIndex) {
      result.push({
        type: 'text',
        data: content.slice(lastIndex, matchStart)
      })
    }

    let type: TEmbeddedNodeType = 'url'
    if (isImage(url)) {
      type = 'image'
    } else if (isBlossomBudBlobUrl(url)) {
      type = 'image'
    } else if (isHlsPlaylistUrl(url)) {
      type = 'media'
    } else if (isMedia(url)) {
      type = 'media'
    } else if (isYouTubeUrl(url)) {
      type = 'youtube'
    } else if (isSpotifyOpenUrl(url)) {
      type = 'spotify'
    } else if (isWavlakeOpenUrl(url)) {
      type = 'wavlake'
    } else if (isFountainOpenUrl(url)) {
      type = 'fountain'
    } else if (isZapStreamWatchUrl(url)) {
      type = 'zapstream'
    }

    // Add the match as specific type
    result.push({
      type,
      data: url
    })

    lastIndex = matchStart + url.length
  }
  // Add text after the last match
  if (lastIndex < content.length) {
    result.push({
      type: 'text',
      data: content.slice(lastIndex)
    })
  }
  return result
}

/**
 * Shared pipeline for kind-1–style strings (note body, reply preview, profile fields using parseContent).
 * Order matters.
 */
export const PARSE_CONTENT_PARSERS_NOTE_TEXT: TContentParser[] = [
  EmbeddedUrlParser,
  EmbeddedWikilinkParser,
  EmbeddedLNInvoiceParser,
  EmbeddedPaytoParser,
  EmbeddedWebsocketUrlParser,
  EmbeddedEventParser,
  EmbeddedMentionParser,
  EmbeddedHashtagParser,
  EmbeddedEmojiParser
]

export function parseContent(content: string, parsers: TContentParser[]) {
  const trace = content.includes('nostr:')
  if (trace) {
    logContentSpacing('parseContent:input', {
      rawLength: content.length,
      afterTrimRepr: reprString(content.trim()),
      trimRemovedLeading: content.length - content.trimStart().length,
      trimRemovedTrailing: content.length - content.trimEnd().length
    })
  }

  let nodes: TEmbeddedNode[] = [{ type: 'text', data: content.trim() }]

  parsers.forEach((parser, parserIndex) => {
    const parserLabel =
      typeof parser === 'function' ? `fn[${parserIndex}]` : parser.type
    const beforeSummary = trace ? summarizeContentNodesForDebug(nodes) : null

    nodes = nodes
      .flatMap((node) => {
        if (node.type !== 'text') return [node]

        if (typeof parser === 'function') {
          return parser(node.data)
        }

        const matches = node.data.matchAll(parser.regex)
        const result: TEmbeddedNode[] = []
        let lastIndex = 0
        for (const match of matches) {
          const matchStart = match.index!
          // Add text before the match
          if (matchStart > lastIndex) {
            result.push({
              type: 'text',
              data: node.data.slice(lastIndex, matchStart)
            })
          }

          // Add the match as specific type
          result.push({
            type: parser.type,
            data: match[0] // The whole matched string
          })

          lastIndex = matchStart + match[0].length
        }

        // Add text after the last match
        if (lastIndex < node.data.length) {
          result.push({
            type: 'text',
            data: node.data.slice(lastIndex)
          })
        }

        return result
      })
      .filter((n) => n.data !== '')

    if (trace) {
      logContentSpacing('parseContent:after-parser', {
        parser: parserLabel,
        parserIndex,
        before: beforeSummary,
        after: summarizeContentNodesForDebug(nodes)
      })
    }
  })

  nodes = mergeConsecutiveTextNodes(nodes)
  nodes = mergeConsecutiveImageNodes(nodes)
  nodes = removeExtraNewlines(nodes)

  if (trace) {
    logContentSpacing('parseContent:final', {
      afterMergeNewlines: summarizeContentNodesForDebug(nodes)
    })
  }

  return nodes
}

function summarizeContentNodesForDebug(nodes: TEmbeddedNode[]): Array<{ type: string; repr?: string }> {
  return nodes.map((n) => {
    if (n.type === 'text') return { type: 'text', repr: reprString(n.data) }
    if (n.type === 'images') return { type: 'images', repr: `[${n.data.length} urls]` }
    return { type: n.type, repr: typeof n.data === 'string' ? reprString(n.data) : undefined }
  })
}

function mergeConsecutiveTextNodes(nodes: TEmbeddedNode[]) {
  const merged: TEmbeddedNode[] = []
  let currentText = ''

  nodes.forEach((node) => {
    if (node.type === 'text') {
      currentText += node.data
    } else {
      if (currentText) {
        merged.push({ type: 'text', data: currentText })
        currentText = ''
      }
      merged.push(node)
    }
  })

  if (currentText) {
    merged.push({ type: 'text', data: currentText })
  }

  return merged
}

function mergeConsecutiveImageNodes(nodes: TEmbeddedNode[]) {
  const merged: TEmbeddedNode[] = []
  nodes.forEach((node, i) => {
    if (node.type === 'image') {
      const lastNode = merged[merged.length - 1]
      if (lastNode && lastNode.type === 'images') {
        lastNode.data.push(node.data)
      } else {
        merged.push({ type: 'images', data: [node.data] })
      }
    } else if (node.type === 'text' && node.data.trim() === '') {
      // Only remove whitespace-only text nodes if they are sandwiched between image nodes.
      const prev = merged[merged.length - 1]
      const next = nodes[i + 1]
      if (prev && prev.type === 'images' && next && next.type === 'image') {
        return // skip this whitespace node
      } else {
        merged.push(node)
      }
    } else {
      merged.push(node)
    }
  })

  return merged
}

function removeExtraNewlines(nodes: TEmbeddedNode[]) {
  const isBlockNode = (node: TEmbeddedNode) => {
    return ['image', 'images', 'video', 'event'].includes(node.type)
  }

  const newNodes: TEmbeddedNode[] = []
  nodes.forEach((node, i) => {
    if (isBlockNode(node)) {
      newNodes.push(node)
      return
    }

    const prev = nodes[i - 1]
    const next = nodes[i + 1]
    let data = node.data as string
    if (prev && isBlockNode(prev)) {
      data = data.replace(/^[ ]*\n/, '')
    }
    if (next && isBlockNode(next)) {
      data = data.replace(/\n[ ]*$/, '')
    }
    newNodes.push({
      type: node.type as Exclude<TEmbeddedNodeType, 'images'>,
      data
    })
  })
  return newNodes
}
