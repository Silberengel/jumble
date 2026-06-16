import OrphanedImetaMediaSection from '@/components/OrphanedImetaMedia/OrphanedImetaMediaSection'
import { useSecondaryPageOptional, useSmartHashtagNavigationOptional, useSmartRelayNavigationOptional } from '@/PageManager'
import Image from '@/components/Image'
import UserAvatar from '@/components/UserAvatar'
import { MediaAutoLoadEventProvider } from '@/providers/MediaAutoLoadEventContext'
import MediaPlayer from '@/components/MediaPlayer'
import Wikilink from '@/components/UniversalContent/Wikilink'
import { HttpUrlOpenGraphOrLink } from '@/components/Embedded'
import SpotifyEmbeddedPlayer from '@/components/SpotifyEmbeddedPlayer'
import FountainEmbeddedPlayer from '@/components/FountainEmbeddedPlayer'
import WavlakeEmbeddedPlayer from '@/components/WavlakeEmbeddedPlayer'
import ZapStreamLiveEventEmbed from '@/components/ZapStreamLiveEventEmbed'
import YoutubeEmbeddedPlayer from '@/components/YoutubeEmbeddedPlayer'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { useEmojiInfosForEvent, useMediaExtraction } from '@/hooks'
import {
  cleanUrl,
  isImage,
  isMedia,
  isVideo,
  isAudio,
  isWebsocketUrl,
  isPseudoNostrHttpsUrl,
  isSafeMediaUrl,
  isHlsPlaylistUrl,
  isBlossomBudBlobUrl,
  findHttpUrlsInText
} from '@/lib/url'
import { getHttpUrlFromITags, getImetaInfosFromEvent } from '@/lib/event'
import { getSuppressedImetaMedia, shouldHideOrphanedImetaInAccordion, suppressImetaUrlSet } from '@/lib/imeta-content-match'
import { buildImetaDimMap, type ImetaDim } from '@/lib/imeta-display'
import { canonicalizeRssArticleUrl } from '@/lib/rss-article'
import { URI_LINK_CLASS } from '@/lib/link-styles'
import { cn } from '@/lib/utils'
import { Event, kinds } from 'nostr-tools'
import Emoji, { EMOJI_IMG_INLINE_CLASS } from '@/components/Emoji'
import {
  ExtendedKind,
  isNip52CalendarCardKind,
  SPOTIFY_OPEN_URL_REGEX,
  FOUNTAIN_OPEN_URL_REGEX,
  WAVLAKE_OPEN_URL_REGEX,
  WS_URL_REGEX,
  YOUTUBE_URL_REGEX,
  ZAP_STREAM_WATCH_URL_REGEX
} from '@/constants'
import { isSpotifyOpenUrl } from '@/lib/spotify-url'
import { isFountainOpenUrl } from '@/lib/fountain-url'
import { isWavlakeOpenUrl } from '@/lib/wavlake-url'
import { canonicalZapStreamWatchUrl, isZapStreamWatchUrl } from '@/lib/zap-stream-url'
import { isEmbeddableYoutubeUrl, isYouTubeUrl } from '@/lib/youtube-url'
import { EMOJI_SHORT_CODE_REGEX, NOSTR_URI_INLINE_REGEX } from '@/lib/content-patterns'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { TEmoji, TImetaInfo } from '@/types'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import React, { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { lightboxSlideFromImeta } from '@/lib/lightbox-slides'
import Lightbox from 'yet-another-react-lightbox'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import CalendarEventContent from '@/components/CalendarEventContent'
import { EmbeddedNote, EmbeddedMention, HttpNostrAwareUrl } from '@/components/Embedded'
import EmbeddedCitation from '@/components/EmbeddedCitation'
import { preprocessMarkdownMediaLinks } from './preprocessMarkup'
import { PAYTO_URI_REGEX, parsePaytoUri } from '@/lib/payto'
import PaytoLink from '@/components/PaytoLink'
import { marked } from 'marked'
import katex from 'katex'
import '@/styles/katex-bundle.css'
import { isContentSpacingDebug, reprString } from '@/lib/content-spacing-debug'
import logger from '@/lib/logger'
import { stripTrailingStringifiedNostrEvent } from '@/lib/nostr-event-json'

/**
 * Inline/block image metadata: use merged rows from {@link extractAllMediaFromEvent} first
 * (imeta + content + upload cache), then raw `imeta` tags on the event with URL / filename fallback.
 */
function resolveImetaForMarkdownImageUrl(
  cleaned: string,
  eventPubkey: string,
  args: {
    resolveFromExtractedMedia?: (cleaned: string) => TImetaInfo | undefined
    containingEvent?: Event
    getImageIdentifier?: (url: string) => string | null
  }
): TImetaInfo {
  const fromExtracted = args.resolveFromExtractedMedia?.(cleaned)
  if (fromExtracted) return { ...fromExtracted, url: cleaned }

  if (args.containingEvent) {
    const infos = getImetaInfosFromEvent(args.containingEvent)
    const hit = infos.find((i) => cleanUrl(i.url) === cleaned)
    if (hit) return { ...hit, url: cleaned }
    if (args.getImageIdentifier) {
      const id = args.getImageIdentifier(cleaned)
      if (id) {
        const byId = infos.find((i) => {
          const ic = cleanUrl(i.url)
          return !!ic && args.getImageIdentifier!(ic) === id
        })
        if (byId) return { ...byId, url: cleaned }
      }
    }
  }
  return { url: cleaned, pubkey: eventPubkey }
}

/**
 * Host for marked paragraph bodies that may include block-level nodes from {@link renderInlineTokens}
 * (e.g. `![](https://…mp4)` → {@link MediaPlayer}). `<p>` cannot wrap `<div>`; use flow
 * `<div role="paragraph">` so the DOM stays valid and React stops `validateDOMNesting` warnings.
 */
const MD_PARAGRAPH_FLOW_CLASS = 'mb-1 last:mb-0'

/** Paragraph that is only a single `:shortcode:` (custom or native) — often a trailing reaction emoji. */
const EMOJI_ONLY_PARAGRAPH_RE = new RegExp(`^${EMOJI_SHORT_CODE_REGEX.source}$`)

function isEmojiOnlyParagraphText(text: string): boolean {
  return EMOJI_ONLY_PARAGRAPH_RE.test(text.trim())
}

/** Author custom emoji image URL → slide index in the note lightbox ({@link lightboxSlideFromImeta}). */
type TInlineEmojiLightbox = {
  imageIndexMap: Map<string, number>
  openLightbox: (index: number) => void
}

/**
 * Truncate link display text to 200 characters, adding ellipsis if truncated
 */
function truncateLinkText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.substring(0, maxLength) + '...'
}

type ParsedMathDelimiter = { expression: string; displayMode: boolean } | null

/**
 * Marked's inline lexer treats `\\{`, `\\}`, `\\#`, `\\%`, `\\_`, etc. as markdown escapes and
 * removes the backslash. That breaks TeX inside `$...$` / `$$...$$` (e.g. set literals `\\{...\\}`).
 * We swap `\\` for this private-use character only inside math spans before lexInline, then
 * restore in {@link normalizeLatexExpression} before KaTeX.
 */
const MATH_BACKSLASH_SENTINEL = '\uE15C'

function normalizeLatexExpression(input: string): string {
  let s = input.trim()
  if (s.includes(MATH_BACKSLASH_SENTINEL)) {
    s = s.split(MATH_BACKSLASH_SENTINEL).join('\\')
  }
  return s
}

function isLikelyCurrency(value: string): boolean {
  return /^\d+(?:[.,]\d+)?$/.test(value.trim())
}

/** Inline `$…$` that is clearly shell/code/CSS/prose, not TeX — avoids KaTeX error styling on junk spans. */
function isLikelyNonTexInlineDollar(expression: string): boolean {
  const t = expression.trim()
  if (t.includes('`')) return true
  if (t.includes('${')) return true
  if (t.includes('"')) return true
  // Long “math” with none of \^_{} — e.g. CSS vars paired across a line break, or shell prose
  if (!/[\\^_{}]/.test(t) && t.length > 18 && !/^[\d.,\s]+$/.test(t)) return true
  return false
}

function parseDelimitedMath(value: string): ParsedMathDelimiter {
  const trimmed = value.trim()
  if (trimmed.length < 3) return null

  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
    const expression = trimmed.slice(2, -2).trim()
    if (!expression) return null
    return { expression, displayMode: true }
  }

  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 2) {
    const expression = trimmed.slice(1, -1).trim()
    if (!expression || isLikelyCurrency(expression)) return null
    return { expression, displayMode: false }
  }

  return null
}

/**
 * Marked often emits **one** paragraph token for several consecutive `$$…$$` blocks (only newline between
 * closings and openings). {@link parseDelimitedMath} only handles a single span that fills the whole string,
 * so split here and render each display block with KaTeX.
 */
function splitParagraphByDisplayMath(
  raw: string
): Array<{ kind: 'math'; expression: string } | { kind: 'markdown'; text: string }> | null {
  if (!raw.includes('$$')) return null
  const out: Array<{ kind: 'math'; expression: string } | { kind: 'markdown'; text: string }> = []
  let i = 0
  while (i < raw.length) {
    const open = raw.indexOf('$$', i)
    if (open === -1) {
      const rest = raw.slice(i)
      if (rest.trim()) out.push({ kind: 'markdown', text: rest })
      break
    }
    if (open > i) {
      const before = raw.slice(i, open)
      if (before.trim()) out.push({ kind: 'markdown', text: before })
    }
    const close = raw.indexOf('$$', open + 2)
    if (close === -1) {
      const tail = raw.slice(open)
      if (tail.trim()) out.push({ kind: 'markdown', text: tail })
      break
    }
    const expression = raw.slice(open + 2, close).trim()
    if (expression) out.push({ kind: 'math', expression })
    i = close + 2
    while (i < raw.length && /\s/.test(raw[i]!)) i++
  }
  if (!out.some((s) => s.kind === 'math')) return null
  return out
}

function collectMathInlinePatterns(text: string): Array<{ index: number; end: number; type: 'math-inline' | 'math-block'; data: string }> {
  const patterns: Array<{ index: number; end: number; type: 'math-inline' | 'math-block'; data: string }> = []

  let i = 0
  while (i < text.length) {
    if (text[i] !== '$' || (i > 0 && text[i - 1] === '\\')) {
      i++
      continue
    }

    const isDouble = text[i + 1] === '$'
    const openLen = isDouble ? 2 : 1
    const type = isDouble ? 'math-block' : 'math-inline'
    const start = i
    let j = i + openLen
    let foundEnd = -1

    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2
        continue
      }

      if (isDouble) {
        if (text[j] === '$' && text[j + 1] === '$') {
          foundEnd = j
          break
        }
        j++
      } else {
        if (text[j] === '$') {
          foundEnd = j
          break
        }
        j++
      }
    }

    if (foundEnd === -1) {
      i++
      continue
    }

    const end = foundEnd + openLen
    const expression = text.slice(start + openLen, foundEnd).trim()
    if (!expression || (!isDouble && isLikelyCurrency(expression))) {
      i = end
      continue
    }
    if (!isDouble && isLikelyNonTexInlineDollar(expression)) {
      i = start + 1
      continue
    }

    patterns.push({ index: start, end, type, data: expression })
    i = end
  }

  return patterns
}

function protectTeXBackslashesInMathForMarkdown(content: string): string {
  const patterns = collectMathInlinePatterns(content)
  if (patterns.length === 0) return content
  let result = ''
  let cursor = 0
  for (const p of patterns) {
    const openLen = p.type === 'math-block' ? 2 : 1
    const innerStart = p.index + openLen
    const innerEnd = p.end - openLen
    result += content.slice(cursor, innerStart)
    result += content.slice(innerStart, innerEnd).replace(/\\/g, MATH_BACKSLASH_SENTINEL)
    cursor = innerEnd
  }
  result += content.slice(cursor)
  return result
}

function lexInlineProtected(source: string): any[] {
  return marked.Lexer.lexInline(protectTeXBackslashesInMathForMarkdown(source), {
    gfm: true,
    breaks: true
  }) as any[]
}

function isMathLanguage(language: string): boolean {
  const normalized = language.trim().toLowerCase()
  return normalized === 'latex' ||
    normalized === 'tex' ||
    normalized === 'math' ||
    normalized === 'asciimath'
}

function MathExpression({
  expression,
  displayMode,
  keyPrefix,
  className
}: {
  expression: string
  displayMode: boolean
  keyPrefix: string
  /** Merged after base display/inline classes (e.g. layout when wrapped with trailing punctuation). */
  className?: string
}) {
  try {
    const rendered = katex.renderToString(normalizeLatexExpression(expression), {
      throwOnError: false,
      displayMode
    })
    const baseClass = displayMode ? 'block my-2 overflow-x-auto' : 'inline'
    return (
      <span
        key={keyPrefix}
        className={[baseClass, className].filter(Boolean).join(' ')}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    )
  } catch (error) {
    logger.error('Error rendering TeX expression:', error)
    const delimiters = displayMode ? ['$$', '$$'] : ['$', '$']
    return <span key={keyPrefix}>{`${delimiters[0]}${expression}${delimiters[1]}`}</span>
  }
}

/**
 * Prevent invalid nested <a> trees by downgrading anchor descendants to spans.
 */
function stripNestedAnchors(node: React.ReactNode, keyPrefix: string): React.ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') return node
  if (Array.isArray(node)) {
    return node.map((child, idx) => stripNestedAnchors(child, `${keyPrefix}-${idx}`))
  }
  if (!React.isValidElement(node)) return node

  const element = node as React.ReactElement<{ children?: React.ReactNode }>
  const children = element.props?.children
  const sanitizedChildren =
    children === undefined
      ? children
      : React.Children.map(children, (child, idx) => stripNestedAnchors(child, `${keyPrefix}-${idx}`))

  if (typeof element.type === 'string' && element.type.toLowerCase() === 'a') {
    return (
      <span key={(element.key as string) ?? `${keyPrefix}-anchor`} className="break-words">
        {sanitizedChildren}
      </span>
    )
  }

  return React.cloneElement(element, undefined, sanitizedChildren)
}

function stripNestedAnchorsFromNodes(nodes: React.ReactNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, idx) => stripNestedAnchors(node, `${keyPrefix}-${idx}`))
}

/**
 * Unescape JSON-encoded escape sequences in content
 * Handles cases where content has been JSON-encoded multiple times or has escaped characters
 * Examples: \\n -> \n, \" -> ", \\\n -> \n
 * 
 * The content may have patterns like:
 * - \\\n (three backslashes + n) which should become \n (newline)
 * - \" (escaped quote) which should become " (quote)
 * - \\\" (escaped backslash + escaped quote) which should become \" (backslash + quote)
 */
function unescapeJsonContent(content: string): string {
  // The content may have been JSON-encoded multiple times, resulting in escape sequences.
  // When content is stored in JSON and then parsed, escape sequences can become literal strings.
  // For example, a newline stored as "\\n" in JSON becomes the string "\n" (backslash + n) after parsing.
  // If double-encoded, "\\\\n" in JSON becomes "\\n" (two backslashes + n) after parsing.
  
  // Process in order from most escaped to least escaped to avoid double-processing
  
  // Handle triple-escaped newlines: \\\n -> \n
  // In the actual string, this appears as backslash + backslash + backslash + 'n'
  // Regex: /\\\\\\n/g (in source: four backslashes + backslash + n)
  let unescaped = content.replace(/\\\\\\n/g, '\n')
  
  // Handle double-escaped newlines: \\n -> \n  
  // In the actual string, this appears as backslash + backslash + 'n'
  // Regex: /\\\\n/g (in source: four backslashes + n)
  unescaped = unescaped.replace(/\\\\n/g, '\n')
  
  // Do NOT replace bare \n, \t, or \r here: those two-character sequences are normal in
  // LaTeX (\nabla, \neq, \text, \right, \rho, etc.). JSON.parse already turns JSON \n into
  // real newlines; remaining backslash-n in the string is almost always TeX, not a stray escape.
  
  // Handle escaped quotes: \" -> "
  unescaped = unescaped.replace(/\\"/g, '"')
  
  // Decode any HTML entities that might have been incorrectly encoded
  // This handles cases where content has HTML entities like &#x43; (which is 'C')
  // We'll decode common numeric entities
  unescaped = unescaped.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
    return String.fromCharCode(parseInt(hex, 16))
  })
  unescaped = unescaped.replace(/&#(\d+);/g, (_match, dec) => {
    return String.fromCharCode(parseInt(dec, 10))
  })
  
  return unescaped
}

function isSpotifyUrl(url: string): boolean {
  const flags = SPOTIFY_OPEN_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(SPOTIFY_OPEN_URL_REGEX.source, flags)
  return regex.test(url)
}

function isWavlakeUrl(url: string): boolean {
  return isWavlakeOpenUrl(url)
}

function isFountainUrl(url: string): boolean {
  return isFountainOpenUrl(url)
}

function isZapStreamUrl(url: string): boolean {
  const flags = ZAP_STREAM_WATCH_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(ZAP_STREAM_WATCH_URL_REGEX.source, flags)
  return regex.test(url)
}

/** Uppercase label for fenced code blocks in the article preview (e.g. TYPESCRIPT, C#). */
function formatFenceLanguageLabel(lang: string): string {
  const raw = lang.trim()
  if (!raw) return ''
  const id = raw.toLowerCase()
  const map: Record<string, string> = {
    csharp: 'C#',
    cpp: 'C++',
    'c++': 'C++',
    javascript: 'JAVASCRIPT',
    js: 'JAVASCRIPT',
    typescript: 'TYPESCRIPT',
    ts: 'TYPESCRIPT',
    tsx: 'TSX',
    jsx: 'JSX',
    bash: 'BASH',
    shell: 'SHELL',
    sh: 'SHELL',
    dockerfile: 'DOCKERFILE'
  }
  return map[id] ?? id.toUpperCase()
}

/**
 * CodeBlock component that renders code with syntax highlighting using highlight.js
 */
function CodeBlock({ id, code, language }: { id: string; code: string; language: string }) {
  const codeRef = useRef<HTMLDivElement>(null)
  const label = formatFenceLanguageLabel(language)

  useEffect(() => {
    let cancelled = false
    const initHighlight = async () => {
      if (typeof window === 'undefined') return
      try {
        const hljs = await import('@/lib/highlight')
        if (cancelled) return
        const root = codeRef.current
        if (!root) return
        const codeElement = root.querySelector('code')
        if (codeElement) {
          hljs.default.highlightElement(codeElement)
        }
      } catch (error) {
        if (!cancelled) {
          logger.error('Error loading highlight.js:', error)
        }
      }
    }

    const timeoutId = window.setTimeout(initHighlight, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [code, language])

  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
      {label ? (
        <div
          className="rounded-t-lg border-b border-gray-200 dark:border-gray-700 bg-muted/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          aria-hidden
        >
          {label}
        </div>
      ) : null}
      <pre
        className={`bg-gray-50 dark:bg-gray-900 p-4 whitespace-pre-wrap ${
          label ? 'rounded-b-lg' : 'rounded-lg'
        }`}
      >
        <div ref={codeRef}>
          <code
            id={id}
            className={`hljs language-${language || 'plaintext'} text-gray-900 dark:text-gray-100`}
          >
            {code}
          </code>
        </div>
      </pre>
    </div>
  )
}

/**
 * InlineCode component that renders inline code, with LaTeX math detection
 * If the code content is LaTeX math (starts and ends with $), render it with KaTeX
 */
function InlineCode({ code, keyPrefix }: { code: string; keyPrefix: string }) {
  const parsedMath = parseDelimitedMath(code)
  if (parsedMath) {
    return (
      <MathExpression
        keyPrefix={keyPrefix}
        expression={parsedMath.expression}
        displayMode={parsedMath.displayMode}
      />
    )
  }

  // Regular inline code
  return (
    <code key={keyPrefix} className="bg-muted px-1 py-0.5 rounded text-sm font-mono text-foreground">
      {code}
    </code>
  )
}

/**
 * Normalize backticks in markdown content:
 * - Inline code: normalize to single backtick (`code`)
 * - Code blocks: normalize to triple backticks (```code```)
 * This handles cases where content uses 2, 3, or 4 backticks inconsistently
 */
function normalizeBackticks(content: string): string {
  let normalized = content
  
  // First, protect code blocks by temporarily replacing them
  // Match code blocks with 3 or 4 backticks - need to handle multiline content
  const codeBlockPlaceholders: string[] = []
  const lines = normalized.split('\n')
  const processedLines: string[] = []
  let i = 0
  
  while (i < lines.length) {
    const line = lines[i]
    // Check if this line starts a code block (3 or 4 backticks, optionally with language)
    const codeBlockStartMatch = line.match(/^(`{3,4})(\w*)\s*$/)
    
    if (codeBlockStartMatch) {
      const language = codeBlockStartMatch[2] || ''
      const codeLines: string[] = [line]
      i++
      let foundEnd = false
      
      // Look for the closing backticks
      while (i < lines.length) {
        const codeLine = lines[i]
        codeLines.push(codeLine)
        
        // Check if this line has the closing backticks
        if (codeLine.match(/^`{3,4}\s*$/)) {
          foundEnd = true
          i++
          break
        }
        
        i++
      }
      
      if (foundEnd) {
        // Normalize to triple backticks
        const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`
        const normalizedBlock = `\`\`\`${language}\n${codeLines.slice(1, -1).join('\n')}\n\`\`\``
        codeBlockPlaceholders.push(normalizedBlock)
        processedLines.push(placeholder)
        continue
      }
    }
    
    processedLines.push(line)
    i++
  }
  
  normalized = processedLines.join('\n')
  
  // Normalize inline code: replace double backticks with single backticks
  // But only if they're not part of a code block (which we've already protected)
  // Use a more precise regex that doesn't match triple+ backticks
  normalized = normalized.replace(/``([^`\n]+?)``/g, '`$1`')
  
  // Restore code blocks
  codeBlockPlaceholders.forEach((block, index) => {
    normalized = normalized.replace(`__CODE_BLOCK_${index}__`, block)
  })
  
  return normalized
}

/**
 * Convert Setext-style headers to markdown format
 * H1: "Text\n======\n" -> "# Text\n"
 * H2: "Text\n------\n" -> "## Text\n"
 * This handles the Setext-style header format (both equals and dashes)
 * 
 * Note: Only converts if the text line has at least 2 characters to avoid
 * creating headers from fragments like "D\n------" which would become "## D"
 */
/**
 * Normalize single newlines within bold/italic spans to spaces
 * This allows bold/italic formatting to work across single line breaks
 */
function normalizeInlineFormattingNewlines(content: string): string {
  let normalized = content
  
  // Match bold spans: **text** that may contain single newlines
  // Replace single newlines (but not double newlines) within these spans with spaces
  normalized = normalized.replace(/\*\*([^*]*?)\*\*/g, (match, innerContent) => {
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match // Keep original if it has paragraph breaks
    }
    // Replace single newlines with spaces
    return '**' + innerContent.replace(/\n/g, ' ') + '**'
  })
  
  // Match bold spans: __text__ that may contain single newlines
  normalized = normalized.replace(/__([^_]*?)__/g, (match, innerContent) => {
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match // Keep original if it has paragraph breaks
    }
    // Replace single newlines with spaces
    return '__' + innerContent.replace(/\n/g, ' ') + '__'
  })
  
  // Match italic spans: _text_ (single underscore, not part of __bold__)
  // Use a more careful pattern to avoid matching __bold__
  normalized = normalized.replace(/(?<![_*])(?<!__)_([^_\n]+?)_(?!_)/g, (match, innerContent, offset, string) => {
    // Check if preceded by another underscore (would be __bold__)
    if (offset > 0 && string[offset - 1] === '_') {
      return match // Don't modify if part of __bold__
    }
    // Check if this span contains double newlines (paragraph break) - if so, don't modify
    if (innerContent.includes('\n\n')) {
      return match
    }
    // Replace single newlines with spaces (though italic shouldn't have newlines due to [^_\n])
    return '_' + innerContent.replace(/\n/g, ' ') + '_'
  })
  
  return normalized
}

function normalizeSetextHeaders(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let i = 0
  
  while (i < lines.length) {
    const currentLine = lines[i]
    const nextLine = i + 1 < lines.length ? lines[i + 1] : ''
    const currentLineTrimmed = currentLine.trim()
    
    // Check if next line is all equals signs (at least 3) - H1
    const equalsMatch = nextLine.match(/^={3,}\s*$/)
    if (equalsMatch && currentLineTrimmed.length > 0) {
      // Only convert if the text has at least 2 characters (avoid fragments like "D")
      if (currentLineTrimmed.length >= 2) {
        // Convert to markdown H1
        result.push(`# ${currentLineTrimmed}`)
        i += 2 // Skip both lines
        continue
      }
    }
    
    // Check if next line is all dashes (at least 3) - H2
    // But make sure it's not a horizontal rule (which would be on its own line)
    const dashesMatch = nextLine.match(/^-{3,}\s*$/)
    if (dashesMatch && currentLineTrimmed.length > 0) {
      // Only convert if the text has at least 2 characters (avoid fragments like "D")
      if (currentLineTrimmed.length >= 2) {
        // Convert to markdown H2
        result.push(`## ${currentLineTrimmed}`)
        i += 2 // Skip both lines
        continue
      }
    }
    
    result.push(currentLine)
    i++
  }
  
  return result.join('\n')
}

/**
 * Parse markdown content and render with post-processing for nostr: links and hashtags
 * Post-processes:
 * - nostr: links -> EmbeddedNote or EmbeddedMention
 * - #hashtags -> green hyperlinks to /notes?t=hashtag
 * - wss:// and ws:// URLs -> hyperlinks to /relays/{url}
 * Returns both rendered nodes and a set of hashtags found in content (for deduplication)
 */
// Deprecated legacy parser kept only as a fallback reference during migration.
function parseMarkdownContentLegacy(
  content: string,
  options: {
    eventPubkey: string
    imageIndexMap: Map<string, number>
    openLightbox: (index: number) => void
    navigateToHashtag: (href: string) => void
    navigateToRelay: (url: string) => void
    videoPosterMap?: Map<string, string>
    /** Cleaned media URL → blurhash (from any imeta with `blurhash` / `bh`, incl. video/audio). */
    mediaBlurHashMap?: Map<string, string>
    /** Cleaned media URL → NIP-94 `dim` for aspect-ratio placeholders. */
    mediaDimMap?: Map<string, ImetaDim>
    imageThumbnailMap?: Map<string, string>
    getImageIdentifier?: (url: string) => string | null
    emojiInfos?: TEmoji[]
    /** When viewing a kind-24 invite, render full calendar card with RSVP instead of EmbeddedNote for this naddr */
    fullCalendarInvite?: { naddr: string; event: Event }
    /** Cleaned URL variants: standalone markdown links matching any render as inline (OG elsewhere). */
    suppressStandaloneWebPreviewCleanedUrls?: ReadonlySet<string>
    /** Event whose body is being rendered (embedded notes / HTTP nostr links). */
    containingEvent?: Event
    /** Hold images as placeholders until clicked (lightbox). False in detail/full views. */
    lazyMedia?: boolean
    /** Prefer rows from {@link useMediaExtraction} / {@link extractAllMediaFromEvent} for blurHash etc. */
    resolveImetaForImageUrl?: (cleaned: string) => TImetaInfo | undefined
  }
): { nodes: React.ReactNode[]; hashtagsInContent: Set<string>; footnotes: Map<string, string>; citations: Array<{ id: string; type: string; citationId: string }> } {
  const {
    eventPubkey,
    imageIndexMap,
    openLightbox,
    navigateToHashtag,
    navigateToRelay,
    videoPosterMap,
    mediaBlurHashMap,
    mediaDimMap,
    imageThumbnailMap,
    getImageIdentifier,
    emojiInfos = [],
    fullCalendarInvite,
    suppressStandaloneWebPreviewCleanedUrls,
    containingEvent,
    lazyMedia = true,
    resolveImetaForImageUrl
  } = options
  const emojiLightbox: TInlineEmojiLightbox = { imageIndexMap, openLightbox }
  const parts: React.ReactNode[] = []
  const hashtagsInContent = new Set<string>()
  const footnotes = new Map<string, string>()
  const citations: Array<{ id: string; type: string; citationId: string }> = []
  let lastIndex = 0

  const imetaInfoForUrl = (cleaned: string): TImetaInfo =>
    resolveImetaForMarkdownImageUrl(cleaned, eventPubkey, {
      resolveFromExtractedMedia: resolveImetaForImageUrl,
      containingEvent,
      getImageIdentifier
    })

  // Helper function to check if an index range falls within any block-level pattern
  const isWithinBlockPattern = (start: number, end: number, blockPatterns: Array<{ index: number; end: number }>): boolean => {
    return blockPatterns.some(blockPattern =>
      (start >= blockPattern.index && start < blockPattern.end) ||
      (end > blockPattern.index && end <= blockPattern.end) ||
      (start <= blockPattern.index && end >= blockPattern.end)
    )
  }
  
  // STEP 1: First detect all block-level patterns (headers, lists, blockquotes, tables, etc.)
  // Block-level patterns must be detected first so we can exclude inline patterns within them
  const lines = content.split('\n')
  let currentIndex = 0
  const blockPatterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // First pass: extract footnote definitions
  lines.forEach((line) => {
    const footnoteDefMatch = line.match(/^\[\^([^\]]+)\]:\s+(.+)$/)
    if (footnoteDefMatch) {
      const footnoteId = footnoteDefMatch[1]
      const footnoteText = footnoteDefMatch[2]
      footnotes.set(footnoteId, footnoteText)
    }
  })
  
  // Second pass: detect tables and other block-level elements
  let lineIdx = 0
  while (lineIdx < lines.length) {
    const line = lines[lineIdx]
    const lineStartIndex = currentIndex
    const lineEndIndex = currentIndex + line.length
    
    // Tables: detect table rows (must have | characters)
    // GitHub markdown table format: header row, separator row (|---|), data rows
    if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Check if this is a table by looking at the next line (separator)
      if (lineIdx + 1 < lines.length) {
        const nextLine = lines[lineIdx + 1]
        const nextLineTrimmed = nextLine.trim()
        // Table separator looks like: |---|---| or |:---|:---:|---:| or | -------- | ------- |
        // Must start and end with |, and contain only spaces, dashes, colons, and pipes
        const isSeparator = nextLineTrimmed.startsWith('|') && 
                           nextLineTrimmed.endsWith('|') &&
                           /^[\|\s\:\-]+$/.test(nextLineTrimmed) &&
                           nextLineTrimmed.includes('-')
        
        if (isSeparator) {
          // This is a table! Collect all table rows
          const tableRows: string[] = []
          const tableStartIndex = lineStartIndex
          let tableEndIndex = lineEndIndex
          let tableLineIdx = lineIdx
          
          // Collect header row
          tableRows.push(line)
          tableLineIdx++
          tableEndIndex += nextLine.length + 1
          tableLineIdx++ // Skip separator
          
          // Collect data rows until we hit a non-table line
          while (tableLineIdx < lines.length) {
            const tableLine = lines[tableLineIdx]
            const tableLineTrimmed = tableLine.trim()
            // Check if it's a table row (starts and ends with |)
            if (tableLineTrimmed.startsWith('|') && tableLineTrimmed.endsWith('|')) {
              // Check if it's another separator row (skip it)
              const isAnotherSeparator = /^[\|\s\:\-]+$/.test(tableLineTrimmed) && tableLineTrimmed.includes('-')
              if (!isAnotherSeparator) {
                tableRows.push(tableLine)
                tableEndIndex += tableLine.length + 1
              }
              tableLineIdx++
            } else {
              break
            }
          }
          
          // Parse table rows into cells
          const parsedRows: string[][] = []
          tableRows.forEach((row) => {
            // Split by |, trim each cell, filter out empty edge cells
            const rawCells = row.split('|')
            const cells = rawCells
              .map(cell => cell.trim())
              .filter((cell, idx) => {
                // Remove empty cells at the very start and end (from leading/trailing |)
                if (idx === 0 && cell === '') return false
                if (idx === rawCells.length - 1 && cell === '') return false
                return true
              })
            if (cells.length > 0) {
              parsedRows.push(cells)
            }
          })
          
          if (parsedRows.length > 0) {
            blockPatterns.push({
              index: tableStartIndex,
              end: tableEndIndex,
              type: 'table',
              data: { rows: parsedRows, lineNum: lineIdx }
            })
            // Update currentIndex to position at the start of the line after the table
            // Calculate by summing all lines up to (but not including) tableLineIdx
            let newCurrentIndex = 0
            for (let i = 0; i < tableLineIdx && i < lines.length; i++) {
              newCurrentIndex += lines[i].length + 1 // +1 for newline
            }
            currentIndex = newCurrentIndex
            lineIdx = tableLineIdx
            continue
          }
        }
      }
    }
    
    // Fenced code blocks (```code```) - detect before headers
    // Check if this line starts a fenced code block
    const codeBlockStartMatch = line.match(/^(`{3,})(\w*)\s*$/)
    if (codeBlockStartMatch) {
      const language = codeBlockStartMatch[2] || ''
      const codeBlockStartIndex = lineStartIndex
      let codeBlockLineIdx = lineIdx + 1
      // Start with the end of the opening line (including newline)
      let codeBlockEndIndex = lineEndIndex + 1 // +1 for newline after opening line
      const codeLines: string[] = []
      let foundEnd = false
      
      // Look for the closing backticks
      while (codeBlockLineIdx < lines.length) {
        const codeLine = lines[codeBlockLineIdx]
        
        // Check if this line has the closing backticks
        if (codeLine.match(/^`{3,}\s*$/)) {
          foundEnd = true
          // Include the closing line and its newline
          codeBlockEndIndex += codeLine.length + 1
          codeBlockLineIdx++
          break
        }
        
        // Add this line to code content
        codeLines.push(codeLine)
        // Add line length + newline to end index
        codeBlockEndIndex += codeLine.length + 1
        codeBlockLineIdx++
      }
      
      if (foundEnd) {
        const codeContent = codeLines.join('\n')
        blockPatterns.push({
          index: codeBlockStartIndex,
          end: codeBlockEndIndex,
          type: 'fenced-code-block',
          data: { code: codeContent, language: language, lineNum: lineIdx }
        })
        // Update currentIndex to position at the start of the line after the code block
        // Calculate by summing all lines up to (but not including) codeBlockLineIdx
        // This way, the next iteration will process codeBlockLineIdx and update currentIndex correctly
        let newCurrentIndex = 0
        for (let i = 0; i < codeBlockLineIdx && i < lines.length; i++) {
          newCurrentIndex += lines[i].length + 1 // +1 for newline
        }
        currentIndex = newCurrentIndex
        lineIdx = codeBlockLineIdx
        continue
      }
    }
    
    // Headers (# Header, ## Header, etc.)
    // Must be at start of line (after any leading whitespace is handled)
    // Require at least one space after # and non-empty text after that
    // Skip if we're inside a code block or table (those are handled separately)
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      // Check if this line is inside any existing block pattern (code block, table, etc.)
      const isInsideBlock = blockPatterns.some(blockPattern =>
        lineStartIndex >= blockPattern.index && lineStartIndex < blockPattern.end
      )
      
      if (!isInsideBlock) {
        const headerLevel = headerMatch[1].length
        const headerText = headerMatch[2].trim() // Trim the header text to remove trailing whitespace
        // Only create header if we have actual text (not just whitespace)
        // Also require at least 2 characters to avoid matching fragments like "## D" when "D" is part of other text
        if (headerText.length > 1) {
          blockPatterns.push({
            index: lineStartIndex,
            end: lineEndIndex,
            type: 'header',
            data: { level: headerLevel, text: headerText, lineNum: lineIdx }
          })
        }
      }
    }
    // Horizontal rule (***, ---, or ___, at least 3 asterisks/dashes/underscores)
    else if (line.match(/^[\*\-\_]{3,}\s*$/)) {
      blockPatterns.push({
        index: lineStartIndex,
        end: lineEndIndex,
        type: 'horizontal-rule',
        data: { lineNum: lineIdx }
      })
    }
    // Bullet list (* item or - item)
    else if (line.match(/^[\*\-\+]\s+.+$/)) {
      const listMatch = line.match(/^([\*\-\+])\s+(.+)$/)
      if (listMatch) {
        blockPatterns.push({
          index: lineStartIndex,
          end: lineEndIndex,
          type: 'bullet-list-item',
          data: { text: listMatch[2], marker: listMatch[1], lineNum: lineIdx, originalLine: line }
        })
      }
    }
    // Numbered list (1. item, 2. item, etc.)
    else if (line.match(/^\d+\.\s+.+$/)) {
      const listMatch = line.match(/^(\d+\.)\s+(.+)$/)
      if (listMatch) {
        blockPatterns.push({
          index: lineStartIndex,
          end: lineEndIndex,
          type: 'numbered-list-item',
          data: { text: listMatch[2], marker: listMatch[1], lineNum: lineIdx, number: line.match(/^(\d+)/)?.[1], originalLine: line }
        })
      }
    }
    // Blockquotes (> text or >) and Greentext (>text with no space)
    else if (line.match(/^>\s*/)) {
      const isGreentext = isMarkdownGreentextLine(line.trim())
      
      // Collect consecutive blockquote/greentext lines
      const blockquoteLines: string[] = []
      const blockquoteStartIndex = lineStartIndex
      let blockquoteLineIdx = lineIdx
      let tempIndex = lineStartIndex
      let allGreentext = isGreentext
      
      while (blockquoteLineIdx < lines.length) {
        const blockquoteLine = lines[blockquoteLineIdx]
        const lineIsGreentext = isMarkdownGreentextLine(blockquoteLine.trim())
        
        if (blockquoteLine.match(/^>\s*/)) {
          // If we started with greentext, only continue if this line is also greentext
          // If we started with regular blockquote, only continue if this line is also regular blockquote
          if (isGreentext && !lineIsGreentext) {
            break
          }
          if (!isGreentext && lineIsGreentext) {
            break
          }
          
          const content = lineIsGreentext
            ? stripMarkdownGreentextMarker(blockquoteLine.trim())
            : blockquoteLine.replace(/^>\s?/, '')
          blockquoteLines.push(content)
          blockquoteLineIdx++
          tempIndex += blockquoteLine.length + 1 // +1 for newline
          
          // Update allGreentext flag (all lines must be greentext for it to be a greentext block)
          allGreentext = allGreentext && lineIsGreentext
        } else if (blockquoteLine.trim() === '') {
          // Empty line without > - this ALWAYS ends the blockquote/greentext
          // Even if the next line is another blockquote, we want separate blockquotes
          break
        } else {
          // Non-empty line that doesn't start with > - ends the blockquote/greentext
          break
        }
      }
      
      if (blockquoteLines.length > 0) {
        // Filter out trailing empty lines (but keep internal empty lines for spacing)
        while (blockquoteLines.length > 0 && blockquoteLines[blockquoteLines.length - 1].trim() === '') {
          blockquoteLines.pop()
          blockquoteLineIdx--
          // Recalculate tempIndex by subtracting the last line's length
          if (blockquoteLineIdx >= lineIdx) {
            tempIndex -= (lines[blockquoteLineIdx].length + 1)
          }
        }
        
        if (blockquoteLines.length > 0) {
          // Calculate end index: tempIndex - 1 (subtract 1 because we don't want the trailing newline)
          const blockquoteEndIndex = tempIndex - 1
          
          // Use greentext type if all lines are greentext, otherwise use blockquote
          const patternType = allGreentext ? 'greentext' : 'blockquote'
          
          blockPatterns.push({
            index: blockquoteStartIndex,
            end: blockquoteEndIndex,
            type: patternType,
            data: { lines: blockquoteLines, lineNum: lineIdx }
          })
          // Update currentIndex to position at the start of the line after the blockquote
          // Calculate by summing all lines up to (but not including) blockquoteLineIdx
          let newCurrentIndex = 0
          for (let i = 0; i < blockquoteLineIdx && i < lines.length; i++) {
            newCurrentIndex += lines[i].length + 1 // +1 for newline
          }
          currentIndex = newCurrentIndex
          lineIdx = blockquoteLineIdx
          continue
        }
      }
    }
    // Footnote definition (already extracted, but mark it so we don't render it in content)
    else if (line.match(/^\[\^([^\]]+)\]:\s+.+$/)) {
      blockPatterns.push({
        index: lineStartIndex,
        end: lineEndIndex,
        type: 'footnote-definition',
        data: { lineNum: lineIdx }
      })
    }
    
    currentIndex += line.length + 1 // +1 for newline
    lineIdx++
  }
  
  // STEP 2: Now detect inline patterns (images, links, URLs, hashtags, etc.)
  // But exclude any that fall within block-level patterns
  const patterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // Add block patterns to main patterns array first
  blockPatterns.forEach(pattern => {
    patterns.push(pattern)
  })
  
  // Markdown image links: [![](image_url)](link_url) - detect FIRST with a specific regex
  // This must be detected before regular markdown links to avoid incorrect parsing of nested brackets
  const linkPatterns: Array<{ index: number; end: number; type: string; data: any }> = []
  
  // Regex to match image links: [![](image_url)](link_url)
  // This matches the full pattern including the nested image syntax
  const imageLinkRegex = /\[(!\[[^\]]*\]\([^)]+\))\]\(([^)]+)\)/g
  const imageLinkMatches = Array.from(content.matchAll(imageLinkRegex))
  
  imageLinkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (!isWithinBlockPattern(start, end, blockPatterns)) {
        linkPatterns.push({
          index: start,
          end: end,
          type: 'markdown-image-link',
          data: { text: match[1], url: match[2] }
        })
      }
    }
  })
  
  // Regular markdown links: [text](url) - but exclude those already captured as image links
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const linkMatches = Array.from(content.matchAll(markdownLinkRegex))
  
  linkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (isWithinBlockPattern(start, end, blockPatterns)) {
        return
      }
      
      // Skip if this link is already captured as an image link
      const isImageLink = linkPatterns.some(imgLink =>
        start >= imgLink.index && end <= imgLink.end
      )
      if (isImageLink) {
        return
      }
      
      // Check if link is standalone (on its own line, not part of a sentence/list/quote)
      const isStandalone = (() => {
        // Get the line containing this link
        const lineStart = content.lastIndexOf('\n', start) + 1
        const lineEnd = content.indexOf('\n', end)
        const lineEndIndex = lineEnd === -1 ? content.length : lineEnd
        const line = content.substring(lineStart, lineEndIndex)
        
        // Check if the line is just whitespace + the link (possibly with trailing whitespace)
        const lineTrimmed = line.trim()
        const linkMatch = lineTrimmed.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (linkMatch) {
          // Link is on its own line - check if it's in a list or blockquote
          // Check if previous line starts with list marker or blockquote
          const prevLineStart = content.lastIndexOf('\n', lineStart - 1) + 1
          const prevLine = content.substring(prevLineStart, lineStart - 1).trim()
          
          // Not standalone if it's part of a list or blockquote
          if (prevLine.match(/^[\*\-\+]\s/) || prevLine.match(/^\d+\.\s/) || prevLine.match(/^>\s/)) {
            return false
          }
          
          // Check if there's content immediately before or after on adjacent lines
          // If there's text on the previous line (not blank, not list/blockquote), it's probably not standalone
          if (prevLineStart > 0 && prevLine.length > 0 && !prevLine.match(/^[\*\-\+]\s/) && !prevLine.match(/^\d+\.\s/) && !prevLine.match(/^>\s/)) {
            // Previous line has content and it's not a list/blockquote - probably part of a paragraph
            return false
          }
          
          // Check next line - if it has content immediately after, it's probably not standalone
          if (lineEnd !== -1 && lineEnd < content.length) {
            const nextLineStart = lineEnd + 1
            const nextLineEnd = content.indexOf('\n', nextLineStart)
            const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
            const nextLine = content.substring(nextLineStart, nextLineEndIndex).trim()
            if (nextLine.length > 0 && !nextLine.match(/^[\*\-\+]\s/) && !nextLine.match(/^\d+\.\s/) && !nextLine.match(/^>\s/)) {
              // Next line has content and it's not a list/blockquote - probably part of a paragraph
              return false
            }
          }
          
          // Standalone if it's on its own line, not in list/blockquote, and surrounded by blank lines or list items
          return true
        }
        
        // Not standalone if it's part of a sentence
        return false
      })()
      
      // Only render as WebPreview if it's a standalone HTTP/HTTPS link (not YouTube, not relay)
      // But be more conservative - only treat as standalone if it's clearly separated
      const url = match[2]
      const shouldRenderAsWebPreview = isStandalone && 
        !isYouTubeUrl(url) && 
        !isSpotifyOpenUrl(url) &&
        !isZapStreamWatchUrl(url) &&
        !isWebsocketUrl(url) &&
        (url.startsWith('http://') || url.startsWith('https://'))
      
      linkPatterns.push({
        index: start,
        end: end,
        type: shouldRenderAsWebPreview ? 'markdown-link-standalone' : 'markdown-link',
        data: { text: match[1], url: match[2] }
      })
    }
  })
  
  // Markdown images: ![](url) or ![alt](url) - but not if they're inside a markdown link
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const imageMatches = Array.from(content.matchAll(markdownImageRegex))
  imageMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Skip if within a block-level pattern
      if (isWithinBlockPattern(start, end, blockPatterns)) {
        return
      }
      // Skip if this image is inside a markdown link
      const isInsideLink = linkPatterns.some(linkPattern =>
        start >= linkPattern.index && end <= linkPattern.end
      )
      if (!isInsideLink) {
        patterns.push({
          index: start,
          end: end,
          type: 'markdown-image',
          data: { alt: match[1], url: match[2] }
        })
      }
    }
  })
  
  // Add markdown links to patterns
  linkPatterns.forEach(linkPattern => {
    patterns.push(linkPattern)
  })
  
  // YouTube URLs - not in markdown links
  const youtubeUrlMatches = Array.from(content.matchAll(YOUTUBE_URL_REGEX))
  youtubeUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by a markdown link/image-link/image and not in block pattern
      const isInMarkdown = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isYouTubeUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'youtube-url',
          data: { url }
        })
      }
    }
  })

  const spotifyUrlMatches = Array.from(content.matchAll(SPOTIFY_OPEN_URL_REGEX))
  spotifyUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      const isInMarkdown = patterns.some(p =>
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'youtube-url') &&
        start >= p.index &&
        start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isSpotifyUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'spotify-url',
          data: { url }
        })
      }
    }
  })

  const wavlakeUrlMatches = Array.from(content.matchAll(WAVLAKE_OPEN_URL_REGEX))
  wavlakeUrlMatches.forEach((match) => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      const isInMarkdown = patterns.some(
        (p) =>
          (p.type === 'markdown-link' ||
            p.type === 'markdown-image-link' ||
            p.type === 'markdown-image' ||
            p.type === 'youtube-url' ||
            p.type === 'spotify-url') &&
          start >= p.index &&
          start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isWavlakeUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'wavlake-url',
          data: { url }
        })
      }
    }
  })

  const fountainUrlMatches = Array.from(content.matchAll(FOUNTAIN_OPEN_URL_REGEX))
  fountainUrlMatches.forEach((match) => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      const isInMarkdown = patterns.some(
        (p) =>
          (p.type === 'markdown-link' ||
            p.type === 'markdown-image-link' ||
            p.type === 'markdown-image' ||
            p.type === 'youtube-url' ||
            p.type === 'spotify-url' ||
            p.type === 'wavlake-url') &&
          start >= p.index &&
          start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isFountainUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'fountain-url',
          data: { url }
        })
      }
    }
  })

  const zapstreamUrlMatches = Array.from(content.matchAll(ZAP_STREAM_WATCH_URL_REGEX))
  zapstreamUrlMatches.forEach((match) => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      const isInMarkdown = patterns.some(
        (p) =>
          (p.type === 'markdown-link' ||
            p.type === 'markdown-image-link' ||
            p.type === 'markdown-image' ||
            p.type === 'youtube-url' ||
            p.type === 'spotify-url' ||
            p.type === 'wavlake-url' ||
            p.type === 'fountain-url') &&
          start >= p.index &&
          start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isZapStreamUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'zapstream-url',
          data: { url }
        })
      }
    }
  })
  
  // Relay URLs (wss:// or ws://) - not in markdown links
  const relayUrlMatches = Array.from(content.matchAll(WS_URL_REGEX))
  relayUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by a markdown link/image-link/image or YouTube URL and not in block pattern
      const isInMarkdown = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'youtube-url' || p.type === 'spotify-url' || p.type === 'wavlake-url' || p.type === 'fountain-url' || p.type === 'zapstream-url') &&
        start >= p.index && 
        start < p.end
      )
      if (!isInMarkdown && !isWithinBlockPattern(start, end, blockPatterns) && isWebsocketUrl(url)) {
        patterns.push({
          index: start,
          end: end,
          type: 'relay-url',
          data: { url }
        })
      }
    }
  })
  
  // Citation markup: [[citation::type::nevent...]]
  const citationRegex = /\[\[citation::(end|foot|foot-end|inline|quote|prompt-end|prompt-inline)::([^\]]+)\]\]/g
  const citationMatches = Array.from(content.matchAll(citationRegex))
  citationMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by other patterns and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'relay-url' || p.type === 'youtube-url' || p.type === 'spotify-url' || p.type === 'zapstream-url' || p.type === 'nostr') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        const citationType = match[1]
        let citationId = match[2]
        // Strip nostr: prefix if present
        if (citationId.startsWith('nostr:')) {
          citationId = citationId.substring(6) // Remove 'nostr:' prefix
        }
        const citationIndex = citations.length
        citations.push({ id: `citation-${citationIndex}`, type: citationType, citationId })
        patterns.push({
          index: start,
          end: end,
          type: 'citation',
          data: { type: citationType, citationId, index: citationIndex }
        })
      }
    }
  })

  // Nostr addresses (nostr:npub1..., nostr:note1..., etc.)
  const nostrRegex = new RegExp(NOSTR_URI_INLINE_REGEX.source, NOSTR_URI_INLINE_REGEX.flags)
  const nostrMatches = Array.from(content.matchAll(nostrRegex))
  nostrMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by other patterns and not in block pattern
      const isInOther = patterns.some(p => 
        (p.type === 'markdown-link' || p.type === 'markdown-image-link' || p.type === 'markdown-image' || p.type === 'relay-url' || p.type === 'youtube-url' || p.type === 'spotify-url' || p.type === 'zapstream-url' || p.type === 'citation') && 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'nostr',
          data: match[1]
        })
      }
    }
  })
  
  // Hashtags (#tag) - but not inside markdown links, relay URLs, or nostr addresses
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g
  const hashtagMatches = Array.from(content.matchAll(hashtagRegex))
  hashtagMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by another pattern and not in block pattern
      // Note: hashtags inside block patterns will be handled by parseInlineMarkdown
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'hashtag',
          data: match[1]
        })
      }
    }
  })
  
  // Wikilinks ([[link]] or [[link|display]]) - but not inside markdown links
  // Exclude citations ([[citation::...]]) from wikilink processing
  const wikilinkRegex = /\[\[([^\]]+)\]\]/g
  const wikilinkMatches = Array.from(content.matchAll(wikilinkRegex))
  wikilinkMatches.forEach(match => {
    if (match.index !== undefined) {
      const start = match.index
      const end = match.index + match[0].length
      const linkContent = match[1]
      
      // Skip citations - they're already processed above
      if (linkContent.startsWith('citation::')) {
        return
      }
      
      // Only add if not already covered by another pattern and not in block pattern
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'wikilink',
          data: linkContent
        })
      }
    }
  })
  
  // Footnote references ([^1], [^note], etc.) - but not definitions
  const footnoteRefRegex = /\[\^([^\]]+)\]/g
  const footnoteRefMatches = Array.from(content.matchAll(footnoteRefRegex))
  footnoteRefMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if this is a footnote definition (has : after the closing bracket)
      const afterMatch = content.substring(match.index + match[0].length, match.index + match[0].length + 2)
      if (afterMatch.startsWith(']:')) {
        return // This is a definition, not a reference
      }
      
      const start = match.index
      const end = match.index + match[0].length
      // Only add if not already covered by another pattern and not in block pattern
      const isInOther = patterns.some(p => 
        start >= p.index && 
        start < p.end
      )
      if (!isInOther && !isWithinBlockPattern(start, end, blockPatterns)) {
        patterns.push({
          index: start,
          end: end,
          type: 'footnote-ref',
          data: match[1] // footnote ID
        })
      }
    }
  })
  
  // Sort patterns by index
  patterns.sort((a, b) => a.index - b.index)
  
  // Remove overlapping patterns (keep the first one)
  // Block-level patterns (headers, lists, horizontal rules, tables, blockquotes, greentext, code blocks) take priority
  const filteredPatterns: typeof patterns = []
  const blockLevelTypes = ['header', 'horizontal-rule', 'bullet-list-item', 'numbered-list-item', 'table', 'blockquote', 'greentext', 'footnote-definition', 'fenced-code-block']
  const blockLevelPatternsFromAll = patterns.filter(p => blockLevelTypes.includes(p.type))
  const otherPatterns = patterns.filter(p => !blockLevelTypes.includes(p.type))
  
  // First add all block-level patterns
  blockLevelPatternsFromAll.forEach(pattern => {
    filteredPatterns.push(pattern)
  })
  
  // Then add other patterns that don't overlap with block-level patterns
  otherPatterns.forEach(pattern => {
    const overlapsWithBlock = blockLevelPatternsFromAll.some(blockPattern =>
      (pattern.index >= blockPattern.index && pattern.index < blockPattern.end) ||
      (pattern.end > blockPattern.index && pattern.end <= blockPattern.end) ||
      (pattern.index <= blockPattern.index && pattern.end >= blockPattern.end)
    )
    if (!overlapsWithBlock) {
      // Check for overlaps with existing filtered patterns
      const overlaps = filteredPatterns.some(p => 
        (pattern.index >= p.index && pattern.index < p.end) ||
        (pattern.end > p.index && pattern.end <= p.end) ||
        (pattern.index <= p.index && pattern.end >= p.end)
      )
      if (!overlaps) {
        filteredPatterns.push(pattern)
      }
    }
  })
  
  // Re-sort by index
  filteredPatterns.sort((a, b) => a.index - b.index)
  
  // Create a map to store original line data for list items (for single-item list rendering)
  const listItemOriginalLines = new Map<number, string>()
  // Track patterns that have been merged into paragraphs (so we don't render them separately)
  const mergedPatterns = new Set<number>()
  
  // Build React nodes from patterns
  filteredPatterns.forEach((pattern, patternIdx) => {
    // Skip if this pattern was already merged (check early to avoid processing)
    // This is critical to prevent duplicate rendering
    if (mergedPatterns.has(patternIdx)) {
      return
    }
    
    // Additional safety check: if pattern index is before lastIndex, it was already processed
    // (unless it's a block-level pattern that should be rendered)
    if (pattern.index < lastIndex && 
        pattern.type !== 'header' && 
        pattern.type !== 'horizontal-rule' && 
        pattern.type !== 'bullet-list-item' && 
        pattern.type !== 'numbered-list-item' && 
        pattern.type !== 'table' && 
        pattern.type !== 'blockquote' &&
        pattern.type !== 'greentext' &&
        pattern.type !== 'footnote-definition' &&
        pattern.type !== 'fenced-code-block') {
      // This pattern was already processed as part of merged text
      // Skip it to avoid duplicate rendering
      return
    }
    
    // Store original line for list items
    if ((pattern.type === 'bullet-list-item' || pattern.type === 'numbered-list-item') && pattern.data.originalLine) {
      listItemOriginalLines.set(patternIdx, pattern.data.originalLine)
    }
    
    // Add text before pattern
    // Handle both cases: pattern.index > lastIndex (normal) and pattern.index === lastIndex (pattern at start)
    if (pattern.index >= lastIndex) {
      let text = pattern.index > lastIndex ? content.slice(lastIndex, pattern.index) : ''
      let textEndIndex = pattern.index
      
      // Check if this pattern is an inline markdown link, hashtag, relay URL, or nostr address that should be included in the paragraph
      // If so, extend the text to include the pattern so it gets processed as part of the paragraph
      // This ensures links, hashtags, relay URLs, and nostr addresses stay inline with their surrounding text instead of being separated
      // Note: Only profile types (npub/nprofile) should be merged inline; event types (note/nevent/naddr) remain block-level
      if (pattern.type === 'markdown-link' || pattern.type === 'hashtag' || pattern.type === 'relay-url' || pattern.type === 'nostr') {
        // Get the line containing the pattern
        const lineStart = content.lastIndexOf('\n', pattern.index) + 1
        const lineEnd = content.indexOf('\n', pattern.end)
        const lineEndIndex = lineEnd === -1 ? content.length : lineEnd
        const line = content.substring(lineStart, lineEndIndex)
        
        // Check if there's text on the same line before the pattern (indicates it's part of a sentence)
        const textBeforeOnSameLine = content.substring(lineStart, pattern.index)
        const hasTextOnSameLine = textBeforeOnSameLine.trim().length > 0
        
        // Check if there's text before the pattern (even on previous lines, as long as no paragraph break)
        const hasTextBefore = text.trim().length > 0 && !text.includes('\n\n')
        // For hashtags at start of line: text after on same line (e.g. "#pyramid 1.1 has..." - merge so no hard break)
        let hasTextAfterOnSameLine = false
        
        // For hashtags: check if the line contains only hashtags (and spaces)
        // This handles cases like "#orly #devstr #progressreport" on one line
        // Hashtags should ALWAYS be merged if they're part of text or on a line with other hashtags
        let shouldMergeHashtag = false
        let hasHashtagsOnAdjacentLines = false
        if (pattern.type === 'hashtag') {
          // Check if line contains only hashtags and whitespace
          const lineWithoutHashtags = line.replace(/#[a-zA-Z0-9_]+/g, '').trim()
          const lineHasOnlyHashtags = lineWithoutHashtags.length === 0 && line.trim().length > 0
          
          // Also check if there are other hashtags on the same line (after this one)
          const hasOtherHashtagsOnLine = filteredPatterns.some((p, idx) => 
            idx > patternIdx && 
            p.type === 'hashtag' && 
            p.index >= lineStart && 
            p.index < lineEndIndex
          )
          
          // Check if there are hashtags on adjacent lines (separated by single newlines)
          // This handles cases where hashtags are on separate lines but should stay together
          if (!hasOtherHashtagsOnLine) {
            // Check next line for hashtags
            const nextLineStart = lineEndIndex + 1
            if (nextLineStart < content.length) {
              const nextLineEnd = content.indexOf('\n', nextLineStart)
              const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
              
              // Check if next line has hashtags and no double newline before it
              const hasHashtagOnNextLine = filteredPatterns.some((p, idx) => 
                idx > patternIdx && 
                p.type === 'hashtag' && 
                p.index >= nextLineStart && 
                p.index < nextLineEndIndex
              )
              
              // Also check previous line for hashtags
              const prevLineStart = content.lastIndexOf('\n', lineStart - 1) + 1
              const hasHashtagOnPrevLine = prevLineStart < lineStart && filteredPatterns.some((p, idx) => 
                idx < patternIdx && 
                p.type === 'hashtag' && 
                p.index >= prevLineStart && 
                p.index < lineStart
              )
              
              // If there's a hashtag on next or previous line, and no double newline between them, merge
              if ((hasHashtagOnNextLine || hasHashtagOnPrevLine) && !content.substring(Math.max(0, prevLineStart), nextLineEndIndex).includes('\n\n')) {
                hasHashtagsOnAdjacentLines = true
              }
            }
          }
          
          // Merge hashtag if:
          // 1. Line has only hashtags (so they stay together)
          // 2. There are other hashtags on the same line
          // 3. There are hashtags on adjacent lines (separated by single newlines)
          // 4. There's text on the same line before it (part of a sentence)
          // 5. There's text before it (even on previous lines, as long as no paragraph break)
          shouldMergeHashtag = lineHasOnlyHashtags || hasOtherHashtagsOnLine || hasHashtagsOnAdjacentLines || hasTextOnSameLine || hasTextBefore

          // Always compute — merge branch 2 below needs this even when shouldMergeHashtag was already
          // true from hasOtherHashtagsOnLine (e.g. "#a #b word" is not "only hashtags" so branch 1 skips,
          // and without hasTextAfterOnSameLine branch 2 would not run → spurious line break before <p>).
          const textAfterOnSameLineRaw = content.substring(pattern.end, lineEndIndex)
          hasTextAfterOnSameLine = textAfterOnSameLineRaw.trim().length > 0
          if (!shouldMergeHashtag && hasTextAfterOnSameLine) {
            shouldMergeHashtag = true
          }
        }
        
        // Merge if:
        // 1. There's text on the same line before the pattern (e.g., "via [TFTC](url)" or "things that #AI")
        // 2. OR there's text before the pattern and no double newline (paragraph break)
        // 3. OR (for hashtags) the line contains only hashtags, so they should stay together
        // This ensures links and hashtags in sentences stay together with their text
        if (pattern.type === 'hashtag' && shouldMergeHashtag) {
          // For hashtags on a line with only hashtags, or hashtags on adjacent lines, merge them together
          if (line.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0 && line.trim().length > 0) {
            // Line contains only hashtags - merge the entire line
            // Also check if we need to merge adjacent lines with hashtags
            let mergeEndIndex = lineEndIndex
            let mergeStartIndex = lineStart
            
            // If there are hashtags on adjacent lines, extend the merge range
            if (hasHashtagsOnAdjacentLines) {
              // Find the start of the first hashtag line in this sequence
              let checkStart = lineStart
              while (checkStart > 0) {
                const prevLineStart = content.lastIndexOf('\n', checkStart - 2) + 1
                if (prevLineStart >= 0 && prevLineStart < checkStart) {
                  const prevLineEnd = checkStart - 1
                  const prevLine = content.substring(prevLineStart, prevLineEnd)
                  const hasHashtagOnPrevLine = filteredPatterns.some((p, idx) => 
                    idx < patternIdx && 
                    p.type === 'hashtag' && 
                    p.index >= prevLineStart && 
                    p.index < prevLineEnd
                  )
                  if (hasHashtagOnPrevLine && prevLine.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0) {
                    mergeStartIndex = prevLineStart
                    checkStart = prevLineStart
                  } else {
                    break
                  }
                } else {
                  break
                }
              }
              
              // Find the end of the last hashtag line in this sequence
              let checkEnd = lineEndIndex
              while (checkEnd < content.length) {
                const nextLineStart = checkEnd + 1
                if (nextLineStart < content.length) {
                  const nextLineEnd = content.indexOf('\n', nextLineStart)
                  const nextLineEndIndex = nextLineEnd === -1 ? content.length : nextLineEnd
                  const nextLine = content.substring(nextLineStart, nextLineEndIndex)
                  const hasHashtagOnNextLine = filteredPatterns.some((p, idx) => 
                    idx > patternIdx && 
                    p.type === 'hashtag' && 
                    p.index >= nextLineStart && 
                    p.index < nextLineEndIndex
                  )
                  if (hasHashtagOnNextLine && nextLine.replace(/#[a-zA-Z0-9_]+/g, '').trim().length === 0) {
                    mergeEndIndex = nextLineEndIndex
                    checkEnd = nextLineEndIndex
                  } else {
                    break
                  }
                } else {
                  break
                }
              }
            }
            
            // Reconstruct text to include everything from lastIndex to the end of the merged range
            const textBeforeMerge = content.slice(lastIndex, mergeStartIndex)
            const mergedContent = content.substring(mergeStartIndex, mergeEndIndex)
            // Replace single newlines with spaces in the merged content to keep hashtags together
            const normalizedMergedContent = mergedContent.replace(/\n(?!\n)/g, ' ')
            text = textBeforeMerge + normalizedMergedContent
            textEndIndex = mergeEndIndex === content.length ? content.length : mergeEndIndex + 1
            
            // Mark all hashtags in the merged range as merged (so they don't render separately)
            filteredPatterns.forEach((p, idx) => {
              if (p.type === 'hashtag' && p.index >= mergeStartIndex && p.index < mergeEndIndex) {
                const tag = p.data
                const tagLower = tag.toLowerCase()
                hashtagsInContent.add(tagLower)
                mergedPatterns.add(idx)
              }
            })
            
            // Also update lastIndex immediately to prevent processing of patterns in this range
            lastIndex = textEndIndex
          } else if (hasTextOnSameLine || hasTextBefore || hasTextAfterOnSameLine) {
            // Hashtag is part of text - merge this hashtag and all following hashtags/text on same line (avoids hard break between #hashtag #other)
            const patternMarkdown = content.substring(pattern.index, pattern.end)
            const textAfterPattern = content.substring(pattern.end, lineEndIndex)
            text = text + patternMarkdown + textAfterPattern
            textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
            
            // Mark every hashtag in this merged range so we don't render them as separate blocks
            const mergeStartIndex = pattern.index
            const mergeEndIndex = lineEndIndex
            filteredPatterns.forEach((p, idx) => {
              if (p.type === 'hashtag' && p.index >= mergeStartIndex && p.index < mergeEndIndex) {
                const tag = p.data
                hashtagsInContent.add(tag.toLowerCase())
                mergedPatterns.add(idx)
              }
            })
          }
        } else if (
          (pattern.type === 'markdown-link' || pattern.type === 'relay-url') &&
          (hasTextOnSameLine ||
            hasTextBefore ||
            content.substring(pattern.end, lineEndIndex).trim().length > 0)
        ) {
          // Leading link/relay + text on the same line (e.g. autolink preprocess → "[url](url) rest"):
          // merge so parseInlineMarkdown emits one <p>; otherwise we render bare <a> then <p> for the tail
          // and the block <p> forces a visual line break.
          // Get the original pattern syntax from the content
          const patternMarkdown = content.substring(pattern.index, pattern.end)
          
          // Get text after the pattern on the same line
          const textAfterPattern = content.substring(pattern.end, lineEndIndex)
          
          // Extend the text to include the pattern and any text after it on the same line
          text = text + patternMarkdown + textAfterPattern
          textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
          
          // Mark this pattern as merged so we don't render it separately later
          mergedPatterns.add(patternIdx)
        } else if (pattern.type === 'nostr') {
          // Only merge profile types (npub/nprofile) inline; event types (note/nevent/naddr) remain block-level.
          // Same idea as hashtags: if the mention is first on the line but more text follows on that line,
          // merge into the paragraph — otherwise we emit a bare <span> and the rest in <p>, which looks
          // like a spurious hard return (block <p> after inline-block mention).
          const bech32Id = pattern.data
          const isProfileType = bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')
          const hasTextAfterNostrOnSameLine =
            isProfileType && content.substring(pattern.end, lineEndIndex).trim().length > 0

          if (isProfileType && (hasTextOnSameLine || hasTextBefore || hasTextAfterNostrOnSameLine)) {
            const patternMarkdown = content.substring(pattern.index, pattern.end)
            const textAfterPattern = content.substring(pattern.end, lineEndIndex)
            text = text + patternMarkdown + textAfterPattern
            textEndIndex = lineEndIndex === content.length ? content.length : lineEndIndex + 1
            mergedPatterns.add(patternIdx)
          }
        }
      }
      
      if (text) {
        // Skip if this text is part of a table (tables are handled as block patterns)
        const isInTable = blockLevelPatternsFromAll.some(p => 
          p.type === 'table' &&
          lastIndex >= p.index && 
          lastIndex < p.end
        )
        if (!isInTable) {
          // Split text into paragraphs (double newlines create paragraph breaks)
          // Single newlines within paragraphs should be converted to spaces
          const paragraphs = text.split(/\n\n+/)
          
          paragraphs.forEach((paragraph, paraIdx) => {
            // Check for markdown images in this paragraph and extract them
            const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
            const imageMatches = Array.from(paragraph.matchAll(markdownImageRegex))
            
            if (imageMatches.length > 0) {
              // Process text and images separately
              let paraLastIndex = 0
              imageMatches.forEach((match, imgIdx) => {
                if (match.index !== undefined) {
                  const imgStart = match.index
                  const imgEnd = match.index + match[0].length
                  const imgUrl = match[2]
                  const cleaned = cleanUrl(imgUrl)
                  
                  // Add text before this image
                  if (imgStart > paraLastIndex) {
                    const textBefore = paragraph.slice(paraLastIndex, imgStart)
                    let normalizedText = textBefore.replace(/\n/g, ' ')
                    normalizedText = normalizedText.replace(/[ \t]{2,}/g, ' ')
                    normalizedText = normalizedText.trim()
                    if (normalizedText) {
                      const textContent = parseInlineMarkdown(normalizedText, `text-${patternIdx}-para-${paraIdx}-img-${imgIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
                      parts.push(
                        <div
                          key={`text-${patternIdx}-para-${paraIdx}-img-${imgIdx}`}
                          role="paragraph"
                          className={MD_PARAGRAPH_FLOW_CLASS}
                        >
                          {textContent}
                        </div>
                      )
                    }
                  }
                  
                  // Render the image
                  if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
                    let imageIndex = imageIndexMap.get(cleaned)
                    if (imageIndex === undefined && getImageIdentifier) {
                      const identifier = getImageIdentifier(cleaned)
                      if (identifier) {
                        imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
                      }
                    }
                    
                    let thumbnailUrl: string | undefined
                    if (imageThumbnailMap) {
                      thumbnailUrl = imageThumbnailMap.get(cleaned)
                      if (!thumbnailUrl && getImageIdentifier) {
                        const identifier = getImageIdentifier(cleaned)
                        if (identifier) {
                          thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
                        }
                      }
                    }
                    // Don't use thumbnails in notes - use original URL
                    const displayUrl = imgUrl
                    
                    parts.push(
                      <div key={`img-${patternIdx}-para-${paraIdx}-${imgIdx}`} className="my-2 block max-w-[400px] mx-auto">
                        <Image
                          image={{ url: displayUrl, pubkey: eventPubkey }}
                          className="w-full rounded-lg cursor-zoom-in"
                          classNames={{
                            wrapper: 'rounded-lg block w-full',
                            errorPlaceholder: 'aspect-square h-[30vh]'
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (imageIndex !== undefined) {
                              openLightbox(imageIndex)
                            }
                          }}
                        />
                      </div>
                    )
                  }
                  
                  paraLastIndex = imgEnd
                }
              })
              
              // Add any remaining text after the last image
              if (paraLastIndex < paragraph.length) {
                const remainingText = paragraph.slice(paraLastIndex)
                let normalizedText = remainingText.replace(/\n/g, ' ')
                normalizedText = normalizedText.replace(/[ \t]{2,}/g, ' ')
                normalizedText = normalizedText.trim()
                if (normalizedText) {
                  const textContent = parseInlineMarkdown(normalizedText, `text-${patternIdx}-para-${paraIdx}-final`, footnotes, emojiInfos, undefined, emojiLightbox)
                  parts.push(
                    <div
                      key={`text-${patternIdx}-para-${paraIdx}-final`}
                      role="paragraph"
                      className={MD_PARAGRAPH_FLOW_CLASS}
                    >
                      {textContent}
                    </div>
                  )
                }
              }
            } else {
              // No images, process normally
              // Convert single newlines to spaces within the paragraph
              // This prevents hard breaks within sentences
              // Also collapse multiple spaces into one
              let normalizedPara = paragraph.replace(/\n/g, ' ')
              // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
              normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
              // Trim only leading/trailing whitespace, not internal spaces
              normalizedPara = normalizedPara.trim()
              if (normalizedPara) {
                // Process paragraph for inline formatting (which will handle markdown links)
                const paraContent = parseInlineMarkdown(normalizedPara, `text-${patternIdx}-para-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
                // Wrap in paragraph tag (no whitespace-pre-wrap, let normal text wrapping handle it)
                parts.push(
                  <div
                    key={`text-${patternIdx}-para-${paraIdx}`}
                    role="paragraph"
                    className={MD_PARAGRAPH_FLOW_CLASS}
                  >
                    {paraContent}
                  </div>
                )
              } else if (paraIdx > 0) {
                // Empty paragraph between non-empty paragraphs - add spacing
                // This handles cases where there are multiple consecutive newlines
                parts.push(<br key={`text-${patternIdx}-para-break-${paraIdx}`} />)
              }
            }
          })
          
          // Update lastIndex to the end of the processed text (including link if merged)
          // Only update if we haven't already updated it (e.g., for hashtag-only lines)
          if (textEndIndex > lastIndex) {
            lastIndex = textEndIndex
          }
        } else {
          // Still update lastIndex even if in table
          lastIndex = textEndIndex
        }
      } else {
        // No text before pattern, but still update lastIndex if we merged a pattern
        if (mergedPatterns.has(patternIdx)) {
          // textEndIndex should have been set during the merge logic above
          if (textEndIndex > lastIndex) {
            lastIndex = textEndIndex
          }
          // Skip rendering since it was merged
          return
        }
      }
    } else {
      // Pattern starts at or before lastIndex - check if it was merged
      // This can happen if a previous pattern's merge extended past this pattern
      if (mergedPatterns.has(patternIdx)) {
        // This pattern was already merged (e.g., as part of a hashtag-only line)
        // Skip it and don't update lastIndex (it was already updated)
        return
      }
    }
    
    // Skip rendering if this pattern was merged into a paragraph
    // (lastIndex was already updated when we merged it above)
    // This is a final safety check
    if (mergedPatterns.has(patternIdx)) {
      return
    }
    
    // Render pattern
    if (pattern.type === 'markdown-image') {
      const { url } = pattern.data
      const cleaned = cleanUrl(url)
      // Look up image index - try by URL first, then by identifier for cross-domain matching
      let imageIndex = imageIndexMap.get(cleaned)
      if (imageIndex === undefined && getImageIdentifier) {
        const identifier = getImageIdentifier(cleaned)
        if (identifier) {
          imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
        }
      }
      
      if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
        parts.push(
          <div key={`img-${patternIdx}`} className="my-2 block max-w-[400px]">
            <Image
              image={imetaInfoForUrl(cleaned)}
              className="w-full rounded-lg cursor-zoom-in"
              classNames={{
                wrapper: 'rounded-lg block w-full',
                errorPlaceholder: 'aspect-square h-[30vh]'
              }}
              holdUntilClick={lazyMedia}
              onClick={(e) => {
                e.stopPropagation()
                if (imageIndex !== undefined) {
                  openLightbox(imageIndex)
                }
              }}
            />
          </div>
        )
      } else if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
        const poster = videoPosterMap?.get(cleaned)
        parts.push(
          <div key={`media-${patternIdx}`} className="my-2">
            <MediaPlayer
              src={cleaned}
              className="max-w-[400px]"
              mustLoad={!lazyMedia}
              poster={poster}
              blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
            />
          </div>
        )
      }
    } else if (pattern.type === 'markdown-image-link') {
      // Link containing an image: [![](image)](url)
      const { text, url } = pattern.data
      // Extract image URL from the link text (which contains ![](imageUrl))
      const imageMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/)
      if (imageMatch) {
        const imageUrl = imageMatch[2]
        const cleaned = cleanUrl(imageUrl)
        
        if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
          // Check if there's a thumbnail available for this image
          let thumbnailUrl: string | undefined
          if (imageThumbnailMap) {
            thumbnailUrl = imageThumbnailMap.get(cleaned)
            // Also check by identifier for cross-domain matching
            if (!thumbnailUrl && getImageIdentifier) {
              const identifier = getImageIdentifier(cleaned)
              if (identifier) {
                thumbnailUrl = imageThumbnailMap.get(`__img_id:${identifier}`)
              }
            }
          }
          // Don't use thumbnails in notes - use original URL
          const displayUrl = imageUrl
          
          // Render as a block-level clickable image that links to the URL
          // Clicking the image should navigate to the URL (standard markdown behavior)
          parts.push(
            <div key={`image-link-${patternIdx}`} className="my-2 block">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block max-w-[400px] mx-auto no-underline hover:no-underline focus:no-underline"
                onClick={(e) => {
                  e.stopPropagation()
                  // Allow normal link navigation
                }}
              >
                <Image
                  image={{ url: displayUrl, pubkey: eventPubkey }}
                  className="w-full rounded-lg cursor-pointer"
                  classNames={{
                    wrapper: 'rounded-lg block w-full',
                    errorPlaceholder: 'aspect-square h-[30vh]'
                  }}
                  onClick={(e) => {
                    // Don't prevent default - let the link handle navigation
                    e.stopPropagation()
                  }}
                />
              </a>
            </div>
          )
        } else {
          // Not an image, render as regular link
          parts.push(
            <a
              key={`link-${patternIdx}`}
              href={url}
              className={cn('inline', URI_LINK_CLASS)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {text}
            </a>
          )
        }
      } else {
        // Fallback: render as regular link
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className={cn('inline', URI_LINK_CLASS)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {text}
          </a>
        )
      }
    } else if (pattern.type === 'markdown-link-standalone') {
      const { url } = pattern.data
      const cleanedStandalone = cleanUrl(url)
      if (cleanedStandalone && (isVideo(cleanedStandalone) || isAudio(cleanedStandalone) || isHlsPlaylistUrl(cleanedStandalone))) {
        const poster = videoPosterMap?.get(cleanedStandalone)
        parts.push(
          <div key={`media-standalone-${patternIdx}`} className="my-2">
            <MediaPlayer
              src={cleanedStandalone}
              className="max-w-[400px]"
              mustLoad={!lazyMedia}
              poster={poster}
              blurHash={mediaBlurHashMap?.get(cleanedStandalone)}
              dim={mediaDimMap?.get(cleanedStandalone)}
            />
          </div>
        )
      } else {
        const cleanedStandaloneForPreview = cleanedStandalone || url
      if (
        suppressStandaloneWebPreviewCleanedUrls &&
        suppressStandaloneWebPreviewCleanedUrls.has(cleanedStandaloneForPreview)
      ) {
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className={cn('inline', URI_LINK_CLASS)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        )
      } else if (isPseudoNostrHttpsUrl(url)) {
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className={cn('inline', URI_LINK_CLASS)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {url}
          </a>
        )
      } else {
        parts.push(
          <div key={`http-nostr-url-${patternIdx}`} className="my-2 not-prose max-w-full">
            <HttpNostrAwareUrl
              url={url}
              renderMode="article"
              containingEvent={containingEvent}
            />
          </div>
        )
      }
      }
    } else if (pattern.type === 'markdown-link') {
      const { text, url } = pattern.data
      // Process the link text for inline formatting (bold, italic, etc.)
      const linkContent = stripNestedAnchorsFromNodes(
        parseInlineMarkdown(text, `link-${patternIdx}`, footnotes, emojiInfos, undefined, emojiLightbox),
        `link-${patternIdx}-sanitized`
      )
      // Markdown links should always be rendered as inline links, not block-level components
      // This ensures they don't break up the content flow when used in paragraphs
      if (isWebsocketUrl(url)) {
        // Relay URLs link to relay page
        const relayPath = `/relays/${encodeURIComponent(url)}`
        parts.push(
          <a
            key={`relay-${patternIdx}`}
            href={relayPath}
            className={cn('inline cursor-pointer', URI_LINK_CLASS)}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              navigateToRelay(relayPath)
            }}
            title={text.length > 200 ? text : undefined}
          >
            {linkContent}
          </a>
        )
      } else {
        // Regular markdown links render as simple inline links (green to match theme)
        parts.push(
          <a
            key={`link-${patternIdx}`}
            href={url}
            className={cn('inline', URI_LINK_CLASS)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkContent}
          </a>
        )
      }
    } else if (pattern.type === 'youtube-url') {
      const { url } = pattern.data
      // Render YouTube URL as embedded player
      parts.push(
        <div key={`youtube-url-${patternIdx}`} className="my-2">
          <YoutubeEmbeddedPlayer
            url={url}
            className="max-w-[400px]"
            mustLoad={!lazyMedia}
          />
        </div>
      )
    } else if (pattern.type === 'spotify-url') {
      const { url } = pattern.data
      parts.push(
        <div key={`spotify-url-${patternIdx}`} className="my-2">
          <SpotifyEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
        </div>
      )
    } else if (pattern.type === 'wavlake-url') {
      const { url } = pattern.data
      parts.push(
        <div key={`wavlake-url-${patternIdx}`} className="my-2">
          <WavlakeEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
        </div>
      )
    } else if (pattern.type === 'fountain-url') {
      const { url } = pattern.data
      parts.push(
        <div key={`fountain-url-${patternIdx}`} className="my-2">
          <FountainEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
        </div>
      )
    } else if (pattern.type === 'zapstream-url') {
      const { url } = pattern.data
      parts.push(
        <div key={`zapstream-url-${patternIdx}`} className="my-2">
          <ZapStreamLiveEventEmbed
            url={url}
            className="max-w-[400px]"
            containingEvent={containingEvent}
            showFull={!lazyMedia}
          />
        </div>
      )
    } else if (pattern.type === 'relay-url') {
      const { url } = pattern.data
      const relayPath = `/relays/${encodeURIComponent(url)}`
      const displayText = truncateLinkText(url)
      parts.push(
        <a
          key={`relay-${patternIdx}`}
          href={relayPath}
          className={cn('inline cursor-pointer', URI_LINK_CLASS)}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToRelay(relayPath)
          }}
          title={url.length > 200 ? url : undefined}
        >
          {displayText}
        </a>
      )
    } else if (pattern.type === 'header') {
      const { level, text } = pattern.data
      // Parse the header text for inline formatting (but not nested headers)
      const headerContent = parseInlineMarkdown(text, `header-${patternIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
      const HeaderTag = `h${Math.min(level, 6)}` as keyof JSX.IntrinsicElements
      parts.push(
        <HeaderTag 
          key={`header-${patternIdx}`} 
          className={`font-bold break-words block mt-4 mb-2 ${
            level === 1 ? 'text-3xl' :
            level === 2 ? 'text-2xl' :
            level === 3 ? 'text-xl' :
            level === 4 ? 'text-lg' :
            level === 5 ? 'text-base' :
            'text-sm'
          }`}
        >
          {headerContent}
        </HeaderTag>
      )
    } else if (pattern.type === 'horizontal-rule') {
      parts.push(
        <hr key={`hr-${patternIdx}`} className="my-4 border-t border-gray-300 dark:border-gray-700" />
      )
    } else if (pattern.type === 'bullet-list-item') {
      const { text } = pattern.data
      const listContent = parseInlineMarkdown(text, `bullet-${patternIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
      parts.push(
        <li key={`bullet-${patternIdx}`} className="list-disc list-inside my-1">
          {listContent}
        </li>
      )
    } else if (pattern.type === 'numbered-list-item') {
      const { text, number } = pattern.data
      const listContent = parseInlineMarkdown(text, `numbered-${patternIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
      const itemNumber = number ? parseInt(number, 10) : undefined
      parts.push(
        <li key={`numbered-${patternIdx}`} className="leading-tight" value={itemNumber}>
          {listContent}
        </li>
      )
    } else if (pattern.type === 'table') {
      const { rows } = pattern.data
      if (rows.length > 0) {
        const headerRow = rows[0]
        const dataRows = rows.slice(1)
        parts.push(
          <div key={`table-${patternIdx}`} className="my-4 overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-700">
              <thead>
                <tr>
                  {headerRow.map((cell: string, cellIdx: number) => (
                    <th 
                      key={`th-${patternIdx}-${cellIdx}`} 
                      className="border border-gray-300 dark:border-gray-700 px-4 py-2 bg-gray-100 dark:bg-gray-800 font-semibold text-left"
                    >
                      {parseInlineMarkdown(cell, `table-header-${patternIdx}-${cellIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row: string[], rowIdx: number) => (
                  <tr key={`tr-${patternIdx}-${rowIdx}`}>
                    {row.map((cell: string, cellIdx: number) => (
                      <td 
                        key={`td-${patternIdx}-${rowIdx}-${cellIdx}`} 
                        className="border border-gray-300 dark:border-gray-700 px-4 py-2"
                      >
                        {parseInlineMarkdown(cell, `table-cell-${patternIdx}-${rowIdx}-${cellIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    } else if (pattern.type === 'blockquote') {
      const { lines } = pattern.data
      // Group lines into paragraphs (consecutive non-empty lines form a paragraph, empty lines separate paragraphs)
      const paragraphs: string[][] = []
      let currentParagraph: string[] = []
      
      lines.forEach((line: string) => {
        if (line.trim() === '') {
          // Empty line - if we have a current paragraph, finish it and start a new one
          if (currentParagraph.length > 0) {
            paragraphs.push(currentParagraph)
            currentParagraph = []
          }
        } else {
          // Non-empty line - add to current paragraph
          currentParagraph.push(line)
        }
      })
      
      // Add the last paragraph if it exists
      if (currentParagraph.length > 0) {
        paragraphs.push(currentParagraph)
      }
      
      // Render paragraphs
      const blockquoteContent = paragraphs.map((paragraphLines: string[], paraIdx: number) => {
        // Join paragraph lines with newlines to preserve line breaks (especially before em-dashes)
        // This preserves the original formatting of the blockquote
        const paragraphText = paragraphLines.join('\n')
        const paragraphContent = parseInlineMarkdown(paragraphText, `blockquote-${patternIdx}-para-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
        
        return (
          <div
            key={`blockquote-${patternIdx}-para-${paraIdx}`}
            role="paragraph"
            className={cn(MD_PARAGRAPH_FLOW_CLASS, 'whitespace-pre-line')}
          >
            {paragraphContent}
          </div>
        )
      })
      
      parts.push(
        <blockquote
          key={`blockquote-${patternIdx}`}
          className="border-l-4 border-gray-400 dark:border-gray-500 pl-4 pr-2 py-2 my-4 italic text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-gray-800/30"
        >
          {blockquoteContent}
        </blockquote>
      )
    } else if (pattern.type === 'greentext') {
      const { lines } = pattern.data
      // Join all greentext lines with <br> to preserve line breaks
      // Each line should have the > prefix preserved
      const greentextContent = lines.map((line: string, lineIdx: number) => {
        // Parse inline markdown for each line (for links, hashtags, etc.)
        const lineContent = parseInlineMarkdown(line, `greentext-${patternIdx}-line-${lineIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
        return (
          <React.Fragment key={`greentext-${patternIdx}-line-${lineIdx}`}>
            {lineIdx > 0 && <br />}
            &gt;{lineContent}
          </React.Fragment>
        )
      })
      
      parts.push(
        <div
          key={`greentext-${patternIdx}`}
          className="not-prose greentext my-1 block text-[#4a7c3a] dark:text-[#8fbc8f]"
        >
          {greentextContent}
        </div>
      )
    } else if (pattern.type === 'fenced-code-block') {
      const { code, language } = pattern.data
      const parsedMath = parseDelimitedMath(String(code ?? '').trim())
      if (parsedMath || isMathLanguage(String(language ?? ''))) {
        parts.push(
          <MathExpression
            key={`math-fenced-code-${patternIdx}`}
            keyPrefix={`math-fenced-code-${patternIdx}`}
            expression={parsedMath ? parsedMath.expression : String(code ?? '').trim()}
            displayMode={true}
          />
        )
        return
      }
      // Render code block with syntax highlighting
      // We'll use a ref and useEffect to apply highlight.js after render
      const codeBlockId = `code-block-${patternIdx}`
      parts.push(
        <CodeBlock 
          key={codeBlockId}
          id={codeBlockId}
          code={code}
          language={language}
        />
      )
    } else if (pattern.type === 'footnote-definition') {
      // Don't render footnote definitions in the main content - they'll be rendered at the bottom
      // Just skip this pattern
    } else if (pattern.type === 'footnote-ref') {
      const footnoteId = pattern.data
      const footnoteText = footnotes.get(footnoteId)
      if (footnoteText) {
        parts.push(
          <sup key={`footnote-ref-${patternIdx}`} className="footnote-ref">
            <a 
              href={`#footnote-${footnoteId}`} 
              id={`footnote-ref-${footnoteId}`}
              className={cn(URI_LINK_CLASS, 'no-underline')}
              onClick={(e) => {
                e.preventDefault()
                const footnoteElement = document.getElementById(`footnote-${footnoteId}`)
                if (footnoteElement) {
                  footnoteElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
            >
              [{footnoteId}]
            </a>
          </sup>
        )
      } else {
        // Footnote not found, just render the reference as-is
        parts.push(<span key={`footnote-ref-${patternIdx}`}>[^{footnoteId}]</span>)
      }
    } else if (pattern.type === 'citation') {
      const { type: citationType, citationId, index: citationIndex } = pattern.data
      const citationNumber = citationIndex + 1
      
      if (citationType === 'inline' || citationType === 'prompt-inline') {
        // Inline citations render as clickable text
        parts.push(
          <EmbeddedCitation
            key={`citation-${patternIdx}`}
            citationId={citationId}
            displayType={citationType as 'inline' | 'prompt-inline'}
            className="inline"
          />
        )
      } else if (citationType === 'foot' || citationType === 'foot-end') {
        // Footnotes render as superscript numbers
        parts.push(
          <sup key={`citation-foot-${patternIdx}`} className="citation-ref">
            <a
              href={`#citation-${citationIndex}`}
              id={`citation-ref-${citationIndex}`}
              className={cn(URI_LINK_CLASS, 'no-underline')}
              onClick={(e) => {
                e.preventDefault()
                const citationElement = document.getElementById(`citation-${citationIndex}`)
                if (citationElement) {
                  citationElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
            >
              [{citationNumber}]
            </a>
          </sup>
        )
      } else if (citationType === 'quote') {
        // Quotes render as block-level citation cards
        parts.push(
          <div key={`citation-quote-${patternIdx}`} className="w-full my-2">
            <EmbeddedCitation
              citationId={citationId}
              displayType="quote"
            />
          </div>
        )
      } else {
        // end, prompt-end render as superscript numbers that link to references section
        parts.push(
          <sup key={`citation-end-${patternIdx}`} className="citation-ref">
            <a
              href="#references-section"
              id={`citation-ref-${citationIndex}`}
              className={cn(URI_LINK_CLASS, 'no-underline')}
              onClick={(e) => {
                e.preventDefault()
                const refSection = document.getElementById('references-section')
                if (refSection) {
                  refSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }}
            >
              [{citationNumber}]
            </a>
          </sup>
        )
      }
    } else if (pattern.type === 'nostr') {
      const bech32Id = pattern.data
      // Check if it's a profile type (mentions/handles should be inline)
      if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
        parts.push(
          <span key={`nostr-${patternIdx}`} className="inline">
            <EmbeddedMention userId={bech32Id} />
          </span>
        )
      } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
        // When this is the calendar invite naddr, show full calendar card with RSVP instead of embedded preview
        if (fullCalendarInvite && fullCalendarInvite.naddr === bech32Id) {
          parts.push(
            <div key={`nostr-${patternIdx}`} className="w-full my-2">
              <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
            </div>
          )
        } else {
          // Embedded events should be block-level and fill width
          parts.push(
            <div key={`nostr-${patternIdx}`} className="w-full my-2">
              <EmbeddedNote noteId={bech32Id} showFull={false} />
            </div>
          )
        }
      } else {
        parts.push(<span key={`nostr-${patternIdx}`}>nostr:{bech32Id}</span>)
      }
    } else if (pattern.type === 'hashtag') {
      const tag = pattern.data
      const tagLower = tag.toLowerCase()
      hashtagsInContent.add(tagLower) // Track hashtags rendered inline
      
      // Check if there's another hashtag immediately following (no space between them)
      // If so, add a space after this hashtag to prevent them from appearing smushed together
      const nextPattern = filteredPatterns[patternIdx + 1]
      // Add space if the next pattern is a hashtag that starts exactly where this one ends
      // (meaning there's no space or text between them)
      const shouldAddSpace = nextPattern && nextPattern.type === 'hashtag' && nextPattern.index === pattern.end
      
      parts.push(
        <a
          key={`hashtag-${patternIdx}`}
          href={`/notes?t=${tagLower}`}
          className={cn('inline cursor-pointer whitespace-nowrap', URI_LINK_CLASS)}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToHashtag(`/notes?t=${tagLower}`)
          }}
        >
          #{tag}
        </a>
      )
      
      // Add a space after the hashtag if another hashtag follows immediately
      // Use a non-breaking space wrapped in a span to ensure it's rendered
      if (shouldAddSpace) {
        parts.push(<span key={`hashtag-space-${patternIdx}`} className="whitespace-pre"> </span>)
      }
    } else if (pattern.type === 'wikilink') {
      const linkContent = pattern.data
      
      // Regular wikilink
      let target = linkContent.includes('|') ? linkContent.split('|')[0].trim() : linkContent.trim()
      let displayText = linkContent.includes('|') ? linkContent.split('|')[1].trim() : linkContent.trim()
      
      const dtag = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      
      parts.push(
        <Wikilink key={`wikilink-${patternIdx}`} dTag={dtag} displayText={displayText} />
      )
    }
    
    lastIndex = pattern.end
  })
  
  // Add remaining text
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex)
    // Skip whitespace-only text to avoid empty spans
    if (text && text.trim()) {
      // Process text for inline formatting
      // But skip if this text is part of a table
      const isInTable = blockLevelPatternsFromAll.some((p: { type: string; index: number; end: number }) => 
        p.type === 'table' &&
        lastIndex >= p.index && 
        lastIndex < p.end
      )
      if (!isInTable && text.trim()) {
        // Check if there are any markdown images in the remaining text that weren't detected as patterns
        // If so, we need to process them separately before processing the text
        const markdownImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
        const remainingImageMatches = Array.from(text.matchAll(markdownImageRegex))
        
        // Process images first, then text between/after them
        let textLastIndex = 0
        remainingImageMatches.forEach((match, imgIdx) => {
          if (match.index !== undefined) {
            const imgStart = match.index
            const imgEnd = match.index + match[0].length
            const imgUrl = match[2]
            const cleaned = cleanUrl(imgUrl)
            
            // Add text before this image
            if (imgStart > textLastIndex) {
              const textBefore = text.slice(textLastIndex, imgStart).trim()
              if (textBefore) {
                // Split into paragraphs
                const paragraphs = textBefore.split(/\n\n+/)
                paragraphs.forEach((paragraph, paraIdx) => {
                  let normalizedPara = paragraph.replace(/\n/g, ' ')
                  normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
                  normalizedPara = normalizedPara.trim()
                  if (normalizedPara) {
                    const paraContent = parseInlineMarkdown(normalizedPara, `text-end-para-${imgIdx}-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
                    parts.push(
                      <div
                        key={`text-end-para-${imgIdx}-${paraIdx}`}
                        role="paragraph"
                        className={MD_PARAGRAPH_FLOW_CLASS}
                      >
                        {paraContent}
                      </div>
                    )
                  }
                })
              }
            }
            
            // Render the image
            if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
              let imageIndex = imageIndexMap.get(cleaned)
              if (imageIndex === undefined && getImageIdentifier) {
                const identifier = getImageIdentifier(cleaned)
                if (identifier) {
                  imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
                }
              }

              parts.push(
                <div key={`img-end-${imgIdx}`} className="my-2 block max-w-[400px] mx-auto">
                  <Image
                    image={imetaInfoForUrl(cleaned)}
                    className="w-full rounded-lg cursor-zoom-in"
                    classNames={{
                      wrapper: 'rounded-lg block w-full',
                      errorPlaceholder: 'aspect-square h-[30vh]'
                    }}
                    holdUntilClick={lazyMedia}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (imageIndex !== undefined) {
                        openLightbox(imageIndex)
                      }
                    }}
                  />
                </div>
              )
            }
            
            textLastIndex = imgEnd
          }
        })
        
        // Add any remaining text after the last image
        if (textLastIndex < text.length) {
          const remainingText = text.slice(textLastIndex).trim()
          if (remainingText) {
            const paragraphs = remainingText.split(/\n\n+/)
            paragraphs.forEach((paragraph, paraIdx) => {
              let normalizedPara = paragraph.replace(/\n/g, ' ')
              normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
              normalizedPara = normalizedPara.trim()
              if (normalizedPara) {
                const paraContent = parseInlineMarkdown(normalizedPara, `text-end-final-para-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
                parts.push(
                  <div
                    key={`text-end-final-para-${paraIdx}`}
                    role="paragraph"
                    className={MD_PARAGRAPH_FLOW_CLASS}
                  >
                    {paraContent}
                  </div>
                )
              }
            })
          }
        } else if (remainingImageMatches.length === 0) {
          // No images found, process the text normally
          const paragraphs = text.split(/\n\n+/)
          paragraphs.forEach((paragraph, paraIdx) => {
            // Convert single newlines to spaces within the paragraph
            // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
            let normalizedPara = paragraph.replace(/\n/g, ' ')
            normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
            normalizedPara = normalizedPara.trim()
            if (normalizedPara) {
              const paraContent = parseInlineMarkdown(normalizedPara, `text-end-para-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
              parts.push(
                <div
                  key={`text-end-para-${paraIdx}`}
                  role="paragraph"
                  className={MD_PARAGRAPH_FLOW_CLASS}
                >
                  {paraContent}
                </div>
              )
            }
          })
        }
      }
    }
  }
  
  // If no patterns, just return the content as text (with inline formatting and paragraphs)
  if (parts.length === 0) {
    const paragraphs = content.split(/\n\n+/)
    const formattedParagraphs = paragraphs.map((paragraph, paraIdx) => {
      // Convert single newlines to spaces within the paragraph
      // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
      let normalizedPara = paragraph.replace(/\n/g, ' ')
      normalizedPara = normalizedPara.replace(/[ \t]{2,}/g, ' ')
      normalizedPara = normalizedPara.trim()
      if (!normalizedPara) return null
      const paraContent = parseInlineMarkdown(normalizedPara, `text-only-para-${paraIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
      return (
        <div key={`text-only-para-${paraIdx}`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
          {paraContent}
        </div>
      )
    }).filter(Boolean)
    return { nodes: formattedParagraphs, hashtagsInContent, footnotes, citations }
  }
  
  // Filter out empty spans before wrapping lists
  // But preserve whitespace that appears between inline patterns (like hashtags)
  const filteredParts = parts.filter((part, idx) => {
    if (React.isValidElement(part) && part.type === 'span') {
      const children = part.props.children
      const isWhitespaceOnly = 
        (typeof children === 'string' && !children.trim()) ||
        (Array.isArray(children) && children.every(child => typeof child === 'string' && !child.trim()))
      
      if (isWhitespaceOnly) {
        // Check if this whitespace is adjacent to inline patterns (like hashtags)
        // Look at the previous and next parts to see if they're inline patterns
        const prevPart = idx > 0 ? parts[idx - 1] : null
        const nextPart = idx < parts.length - 1 ? parts[idx + 1] : null
        
        // Check if a part is an inline pattern (hashtag, wikilink, nostr mention, markdown link, etc.)
        const isInlinePattern = (part: any) => {
          if (!part || !React.isValidElement(part)) return false
          const key = part.key?.toString() || ''
          const type = part.type
          // Hashtags are <a> elements with keys starting with 'hashtag-'
          // Markdown links are <a> elements with keys starting with 'link-' or 'relay-'
          // Wikilinks might be custom components
          // Nostr mentions might be spans or other elements
          return (type === 'a' && (
            key.startsWith('hashtag-') ||
            key.startsWith('wikilink-') ||
            key.startsWith('link-') ||
            key.startsWith('relay-')
          )) ||
                 (type === 'span' && (key.startsWith('wikilink-') || key.startsWith('nostr-'))) ||
                 // Also check for embedded mentions/components that might be inline
                 (type && typeof type !== 'string' && key.includes('mention'))
        }
        
        const prevIsInlinePattern = isInlinePattern(prevPart)
        const nextIsInlinePattern = isInlinePattern(nextPart)
        
        // Preserve whitespace if it's between two inline patterns, or before/after one
        // This ensures spaces around hashtags are preserved
        if (prevIsInlinePattern || nextIsInlinePattern) {
          return true
        }
        
        // Otherwise filter out whitespace-only spans
        return false
      }
    }
    return true
  })
  
  // Wrap list items in <ul> or <ol> tags
  const wrappedParts: React.ReactNode[] = []
  let partIdx = 0
  while (partIdx < filteredParts.length) {
    const part = filteredParts[partIdx]
    // Check if this is a list item
    if (React.isValidElement(part) && part.type === 'li') {
      // Determine if it's a bullet or numbered list
      const isBullet = part.key && part.key.toString().startsWith('bullet-')
      const isNumbered = part.key && part.key.toString().startsWith('numbered-')
      
      if (isBullet || isNumbered) {
        // Collect consecutive list items of the same type
        const listItems: React.ReactNode[] = [part]
        partIdx++
        while (partIdx < filteredParts.length) {
          const nextPart = filteredParts[partIdx]
          if (React.isValidElement(nextPart) && nextPart.type === 'li') {
            const nextIsBullet = nextPart.key && nextPart.key.toString().startsWith('bullet-')
            const nextIsNumbered = nextPart.key && nextPart.key.toString().startsWith('numbered-')
            if ((isBullet && nextIsBullet) || (isNumbered && nextIsNumbered)) {
              listItems.push(nextPart)
              partIdx++
            } else {
              break
            }
          } else {
            break
          }
        }
        
        // Only wrap in <ul> or <ol> if there's more than one item
        // Single-item lists should not be formatted as lists
        if (listItems.length > 1) {
          if (isBullet) {
            wrappedParts.push(
              <ul key={`ul-${partIdx}`} className="list-disc list-inside my-2 space-y-1">
                {listItems}
              </ul>
            )
          } else {
            wrappedParts.push(
              <ol key={`ol-${partIdx}`} className="list-decimal list-outside my-2 ml-6">
                {listItems}
              </ol>
            )
          }
        } else {
          // Single item - render the original line text (including marker) as plain text
          // Extract pattern index from the key to look up original line
          const listItem = listItems[0]
          if (React.isValidElement(listItem) && listItem.key) {
            const keyStr = listItem.key.toString()
            const patternIndexMatch = keyStr.match(/(?:bullet|numbered)-(\d+)/)
            if (patternIndexMatch) {
              const patternIndex = parseInt(patternIndexMatch[1], 10)
              const originalLine = listItemOriginalLines.get(patternIndex)
              if (originalLine) {
                // Render the original line with inline markdown processing
                const lineContent = parseInlineMarkdown(originalLine, `single-list-item-${partIdx}`, footnotes, emojiInfos, undefined, emojiLightbox)
                wrappedParts.push(
                  <div key={`list-item-content-${partIdx}`} className="inline">
                    {lineContent}
                  </div>
                )
              } else {
                // Fallback: render the list item content
                wrappedParts.push(
                  <span key={`list-item-content-${partIdx}`}>
                    {listItem.props.children}
                  </span>
                )
              }
            } else {
              // Fallback: render the list item content
              wrappedParts.push(
                <span key={`list-item-content-${partIdx}`}>
                  {listItem.props.children}
                </span>
              )
            }
          } else {
            wrappedParts.push(listItem)
          }
        }
        continue
      }
    }
    
    wrappedParts.push(part)
    partIdx++
  }
  
  // Add footnotes section at the end if there are any footnotes
  if (footnotes.size > 0) {
    wrappedParts.push(
      <div key="footnotes-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Footnotes</h3>
        <ol className="list-decimal list-inside space-y-2">
          {Array.from(footnotes.entries()).map(([id, text]) => (
            <li 
              key={`footnote-${id}`} 
              id={`footnote-${id}`}
              className="text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="font-semibold">[{id}]:</span>{' '}
              <span>{parseInlineMarkdown(text, `footnote-${id}`, footnotes, emojiInfos, undefined, emojiLightbox)}</span>
              {' '}
              <a 
                href={`#footnote-ref-${id}`}
                className={cn('text-xs', URI_LINK_CLASS)}
                onClick={(e) => {
                  e.preventDefault()
                  const refElement = document.getElementById(`footnote-ref-${id}`)
                  if (refElement) {
                    refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                ↩
              </a>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  // Add citations section (footnotes) at the end if there are any footnotes
  const footCitations = citations.filter(c => c.type === 'foot' || c.type === 'foot-end')
  if (footCitations.length > 0) {
    wrappedParts.push(
      <div key="citations-footnotes-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Citations</h3>
        <ol className="list-decimal pl-6 space-y-3" style={{ listStylePosition: 'outside' }}>
          {footCitations.map((citation, idx) => (
            <li 
              key={`citation-footnote-${idx}`} 
              id={`citation-${citation.id.replace('citation-', '')}`}
              className="text-sm pl-2"
            >
              <div className="inline-block w-full relative">
                <span className="inline">
                  <EmbeddedCitation
                    citationId={citation.citationId}
                    displayType={citation.type as 'foot' | 'foot-end'}
                    className="inline"
                  />
                </span>
                <a 
                  href={`#citation-ref-${citation.id.replace('citation-', '')}`}
                  className={cn('text-xs ml-2 inline-flex items-center absolute right-0 top-0', URI_LINK_CLASS)}
                  aria-label="Return to citation"
                  onClick={(e) => {
                    e.preventDefault()
                    const refElement = document.getElementById(`citation-ref-${citation.id.replace('citation-', '')}`)
                    if (refElement) {
                      refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </a>
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  // Add references section at the end if there are any endnote citations
  const endCitations = citations.filter(c => c.type === 'end' || c.type === 'prompt-end')
  if (endCitations.length > 0) {
    wrappedParts.push(
      <div key="references-section" id="references-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">References</h3>
        <ol className="list-decimal pl-6 space-y-3" style={{ listStylePosition: 'outside' }}>
          {endCitations.map((citation, idx) => (
            <li 
              key={`citation-end-${idx}`} 
              id={`citation-end-${idx}`}
              className="text-sm pl-2"
              style={{ display: 'list-item' }}
            >
              <div className="inline-block w-full relative">
                <span className="inline">
                  <EmbeddedCitation
                    citationId={citation.citationId}
                    displayType={citation.type as 'end' | 'prompt-end'}
                    className="inline"
                  />
                </span>
                <a 
                  href={`#citation-ref-${citation.id.replace('citation-', '')}`}
                  className={cn('text-xs ml-2 inline-flex items-center absolute right-0 top-0', URI_LINK_CLASS)}
                  aria-label="Return to citation"
                  onClick={(e) => {
                    e.preventDefault()
                    const refElement = document.getElementById(`citation-ref-${citation.id.replace('citation-', '')}`)
                    if (refElement) {
                      refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </a>
              </div>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  
  return { nodes: wrappedParts, hashtagsInContent, footnotes, citations }
}

/**
 * Block **quote** (sidebar): `> ` — `>` then ASCII space (CommonMark).
 * **Greentext** (4chan-style): `>` not followed by that space, e.g. `>implying` vs `> implying`.
 */
function isMarkdownGreentextLine(trimmedLine: string): boolean {
  if (!trimmedLine.startsWith('>')) return false
  if (trimmedLine.length < 2) return false
  return /^>(?! ).+$/.test(trimmedLine)
}

function stripMarkdownGreentextMarker(trimmedLine: string): string {
  return trimmedLine.replace(/^>(?! )/, '')
}

/**
 * Marked leaves unclosed `![alt](url` / `![alt](url "title` as a junk paragraph (text + autolink + text).
 * When the whole trimmed paragraph is that fragment, recover alt, URL, and optional title.
 */
function tryRecoverMalformedMarkdownImageParagraph(
  paragraphTrimmed: string
): { alt: string; href: string; title?: string } | null {
  const m = paragraphTrimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(.*)$/i)
  if (!m) return null
  const alt = m[1] ?? ''
  const href = m[2] ?? ''
  const tail = m[3] ?? ''
  if (tail === '' || tail === ')') return { alt, href }
  const fullTitled = /^\s+"([^"]*)"\s*\)\s*$/.exec(tail)
  if (fullTitled) return { alt, href, title: fullTitled[1] }
  const partialTitle = /^\s+"([^"]*)$/.exec(tail)
  if (partialTitle) return { alt, href, title: partialTitle[1] }
  if (/^\s*\)\s*$/.test(tail)) return { alt, href }
  return null
}

/**
 * Marked-driven markdown renderer (standard markdown blocks/inline), while keeping
 * Nostr-specific enrichments (embeds, wikilinks, relay/profile navigation) custom.
 */
function parseMarkdownContentMarked(
  content: string,
  options: {
    eventPubkey: string
    imageIndexMap: Map<string, number>
    openLightbox: (index: number) => void
    navigateToHashtag: (href: string) => void
    navigateToRelay: (url: string) => void
    videoPosterMap?: Map<string, string>
    mediaBlurHashMap?: Map<string, string>
    mediaDimMap?: Map<string, ImetaDim>
    imageThumbnailMap?: Map<string, string>
    getImageIdentifier?: (url: string) => string | null
    emojiInfos?: TEmoji[]
    fullCalendarInvite?: { naddr: string; event: Event }
    suppressStandaloneWebPreviewCleanedUrls?: ReadonlySet<string>
    containingEvent?: Event
    webPreviewSourceEvent?: Event
    /** Hold images as placeholders until clicked (lightbox). False in detail/full views. */
    lazyMedia?: boolean
    resolveImetaForImageUrl?: (cleaned: string) => TImetaInfo | undefined
  }
): { nodes: React.ReactNode[]; hashtagsInContent: Set<string>; footnotes: Map<string, string>; citations: Array<{ id: string; type: string; citationId: string }> } {
  const {
    eventPubkey,
    imageIndexMap,
    openLightbox,
    navigateToHashtag,
    navigateToRelay,
    videoPosterMap,
    mediaBlurHashMap,
    mediaDimMap,
    getImageIdentifier,
    emojiInfos = [],
    fullCalendarInvite,
    suppressStandaloneWebPreviewCleanedUrls,
    containingEvent,
    webPreviewSourceEvent,
    lazyMedia = true,
    resolveImetaForImageUrl
  } = options
  const ogLinkContainingEvent = webPreviewSourceEvent ?? containingEvent
  const emojiLightbox: TInlineEmojiLightbox = { imageIndexMap, openLightbox }

  /** Direct image URLs on their own line: render Image (NIP-94 / Amethyst-style), not WebPreview — WebPreview skips OG fetch when autoLoadMedia is off but still shows a link card. */
  const imetaInfoForStandaloneImageUrl = (cleaned: string): TImetaInfo =>
    resolveImetaForMarkdownImageUrl(cleaned, eventPubkey, {
      resolveFromExtractedMedia: resolveImetaForImageUrl,
      containingEvent,
      getImageIdentifier
    })

  const renderStandaloneHttpsImageBlock = (cleaned: string, reactKey: string) => {
    let imageIndex = imageIndexMap.get(cleaned)
    if (imageIndex === undefined && getImageIdentifier) {
      const identifier = getImageIdentifier(cleaned)
      if (identifier) {
        imageIndex = imageIndexMap.get(`__img_id:${identifier}`)
      }
    }
    return (
      <div key={reactKey} className="my-2 block max-w-[400px] mx-auto">
        <Image
          image={imetaInfoForStandaloneImageUrl(cleaned)}
          className="w-full rounded-lg cursor-zoom-in"
          classNames={{
            wrapper: 'rounded-lg block w-full',
            errorPlaceholder: 'aspect-square h-[30vh]'
          }}
          holdUntilClick={lazyMedia}
          onClick={(e) => {
            e.stopPropagation()
            if (imageIndex !== undefined) {
              openLightbox(imageIndex)
            }
          }}
        />
      </div>
    )
  }

  /** Blossom BUD URLs (single path segment: 64-hex SHA-256) and normal image URLs; uses `imeta` `m` for video/audio. */
  const renderStandaloneHttpsImageOrBlossomBlob = (cleaned: string, reactKey: string) => {
    const im = imetaInfoForStandaloneImageUrl(cleaned)
    if (im.m?.startsWith('video/')) {
      const poster = videoPosterMap?.get(cleaned) ?? im.image
      return (
        <div key={reactKey} className="my-2">
          <MediaPlayer
            src={cleaned}
            poster={poster}
            blurHash={mediaBlurHashMap?.get(cleaned) ?? im.blurHash}
            dim={mediaDimMap?.get(cleaned) ?? im.dim}
            className="max-w-[400px]"
            mustLoad={!lazyMedia}
          />
        </div>
      )
    }
    if (im.m?.startsWith('audio/')) {
      return (
        <div key={reactKey} className="my-2">
          <MediaPlayer
            src={cleaned}
            blurHash={mediaBlurHashMap?.get(cleaned) ?? im.blurHash}
            dim={mediaDimMap?.get(cleaned) ?? im.dim}
            className="max-w-[400px]"
            mustLoad={!lazyMedia}
          />
        </div>
      )
    }
    return renderStandaloneHttpsImageBlock(cleaned, reactKey)
  }

  const hashtagsInContent = new Set<string>()
  const footnotes = new Map<string, string>()
  const citations: Array<{ id: string; type: string; citationId: string }> = []
  const contentLines: string[] = []
  let currentFootnoteId: string | null = null
  for (const line of content.split('\n')) {
    const footnoteDefMatch = line.match(/^\[\^([^\]]+)\]:\s+(.+)$/)
    if (footnoteDefMatch) {
      currentFootnoteId = footnoteDefMatch[1]
      footnotes.set(currentFootnoteId, footnoteDefMatch[2])
      continue
    }
    // Support indented continuation lines for multi-line footnote definitions.
    if (currentFootnoteId && /^(?:\s{2,}|\t)(.+)$/.test(line)) {
      const continuation = line.replace(/^(?:\s{2,}|\t)/, '')
      const prev = footnotes.get(currentFootnoteId) ?? ''
      footnotes.set(currentFootnoteId, prev ? `${prev} ${continuation}` : continuation)
      continue
    }
    currentFootnoteId = null
    contentLines.push(line)
  }

  const contentWithoutFootnotes = contentLines.join('\n')
  const blockTokens = marked.lexer(contentWithoutFootnotes, { gfm: true, breaks: true }) as any[]
  let codeBlockIdx = 0

  const collectHashtags = (text: string) => {
    const re = /#([a-zA-Z0-9_]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      hashtagsInContent.add(m[1].toLowerCase())
    }
  }

  /** CommonMark / GFM optional title in `()` for links and images — surfaced as native `title` + hover cue. */
  const markdownTokenTitle = (token: { title?: string | null }): string | undefined => {
    const raw = token.title
    if (raw == null) return undefined
    const s = String(raw).trim()
    return s.length > 0 ? s : undefined
  }

  const isBareMarkdownLinkToUrl = (
    token: { text?: string; tokens?: unknown[] },
    href: string,
    cleaned: string | null
  ): boolean => {
    if (!cleaned) return false
    const inner = String(token.text ?? '').trim()
    if (inner === href || inner === cleaned) return true
    const tok = token.tokens
    if (Array.isArray(tok) && tok.length === 1 && tok[0] && typeof tok[0] === 'object' && 'text' in (tok[0] as object)) {
      const tx = String((tok[0] as { text?: string }).text ?? '').trim()
      return tx === href || tx === cleaned
    }
    return false
  }

  const renderInlineTokens = (tokens: any[], keyPrefix: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const key = `${keyPrefix}-${i}`
      switch (token.type) {
        case 'text':
        case 'escape': {
          const txt = String(token.text ?? token.raw ?? '')
          collectHashtags(txt)
          out.push(
            ...parseInlineMarkdownLegacy(txt, `${key}-text`, footnotes, emojiInfos, navigateToHashtag, emojiLightbox)
          )
          break
        }
        case 'strong':
          out.push(
            <strong key={`${key}-strong`}>
              {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-strong`)}
            </strong>
          )
          break
        case 'em':
          out.push(
            <em key={`${key}-em`}>
              {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-em`)}
            </em>
          )
          break
        case 'del':
          out.push(
            <del key={`${key}-del`} className="line-through">
              {renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${key}-del`)}
            </del>
          )
          break
        case 'codespan':
          out.push(
            <InlineCode key={`${key}-code`} keyPrefix={`${key}-code`} code={String(token.text ?? '')} />
          )
          break
        case 'checkbox': {
          const checked = Boolean(token.checked)
          out.push(
            <span
              key={`${key}-chk`}
              className="inline-flex h-[1.25em] shrink-0 select-none items-center justify-center text-[1.05rem] leading-none text-foreground"
              aria-label={checked ? 'Checked task item' : 'Unchecked task item'}
              role="img"
            >
              {checked ? '\u2611' : '\u2610'}
            </span>
          )
          break
        }
        case 'link': {
          const href = String(token.href ?? '')
          const cleaned = cleanUrl(href)
          const linkTip = markdownTokenTitle(token)
          const linkVisual = cn(
            URI_LINK_CLASS,
            linkTip &&
              'cursor-help no-underline hover:underline decoration-dotted decoration-current/70 underline-offset-2'
          )
          if (href.startsWith('payto://')) {
            const children = stripNestedAnchorsFromNodes(
              renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? href }], `${key}-link`),
              `${key}-link-sanitized`
            )
            out.push(
              <PaytoLink
                key={`${key}-payto`}
                paytoUri={href}
                className={linkVisual}
                linkTitle={linkTip}
              >
                {children}
              </PaytoLink>
            )
          } else if (cleaned && isSafeMediaUrl(cleaned)) {
            const bare = isBareMarkdownLinkToUrl(token, href, cleaned)
            const embedMedia =
              isBlossomBudBlobUrl(cleaned) ||
              (bare &&
                (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned) || isImage(cleaned)))
            if (embedMedia) {
              if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
                const poster = videoPosterMap?.get(cleaned)
                out.push(
                  <div key={`${key}-link-inline-media`} className="my-2 not-prose">
                    <MediaPlayer
                      src={cleaned}
                      poster={poster}
                      blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                      className="max-w-[400px]"
                      mustLoad={!lazyMedia}
                    />
                  </div>
                )
              } else {
                out.push(
                  renderStandaloneHttpsImageOrBlossomBlob(
                    cleaned,
                    `${key}-link-as-img`
                  ) as React.ReactNode
                )
              }
            } else {
              const children = stripNestedAnchorsFromNodes(
                renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? href }], `${key}-link`),
                `${key}-link-sanitized`
              )
              out.push(
                <a
                  key={`${key}-href`}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={linkTip}
                  className={linkVisual}
                >
                  {children}
                </a>
              )
            }
          } else {
            const children = stripNestedAnchorsFromNodes(
              renderInlineTokens(token.tokens ?? [{ type: 'text', text: token.text ?? href }], `${key}-link`),
              `${key}-link-sanitized`
            )
            out.push(
              <a
                key={`${key}-href`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={linkTip}
                className={linkVisual}
              >
                {children}
              </a>
            )
          }
          break
        }
        case 'br':
          out.push(<br key={`${key}-br`} />)
          break
        case 'image': {
          const src = String(token.href ?? '')
          const cleaned = cleanUrl(src)
          if (!cleaned) break
          const label = String(token.text ?? '')
          const imageTip = markdownTokenTitle(token)
          if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
            const poster = videoPosterMap?.get(cleaned)
            out.push(
              <div key={`${key}-media-inline`} className="my-2 not-prose">
                <MediaPlayer
                  src={cleaned}
                  poster={poster}
                  blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                  className="max-w-[400px]"
                  mustLoad={!lazyMedia}
                />
              </div>
            )
            break
          }
          if (isBlossomBudBlobUrl(cleaned) && isSafeMediaUrl(cleaned)) {
            const baseImeta = imetaInfoForStandaloneImageUrl(cleaned)
            if (baseImeta.m?.startsWith('video/') || baseImeta.m?.startsWith('audio/')) {
              const poster = videoPosterMap?.get(cleaned) ?? baseImeta.image
              out.push(
                <div key={`${key}-blossom-inline-media`} className="my-2 not-prose">
                  <MediaPlayer
                    src={cleaned}
                    poster={poster}
                    blurHash={mediaBlurHashMap?.get(cleaned) ?? baseImeta.blurHash}
                    dim={mediaDimMap?.get(cleaned) ?? baseImeta.dim}
                    className="max-w-[400px]"
                    mustLoad={!lazyMedia}
                  />
                </div>
              )
              break
            }
          }
          if ((!isImage(cleaned) && !isBlossomBudBlobUrl(cleaned)) || !isSafeMediaUrl(cleaned)) {
            out.push(
              <span key={`${key}-img-fallback`} className="break-words">
                {label || src}
              </span>
            )
            break
          }
          // `![](url)` has empty alt — a plain <a>{label}</a> was invisible. Use Image like block paragraphs.
          const baseImeta = imetaInfoForStandaloneImageUrl(cleaned)
          let imageIdx = imageIndexMap.get(cleaned)
          if (imageIdx === undefined && getImageIdentifier) {
            const id = getImageIdentifier(cleaned)
            if (id) imageIdx = imageIndexMap.get(`__img_id:${id}`)
          }
          out.push(
            <Image
              key={`${key}-img-inline`}
              image={{ ...baseImeta, url: src }}
              alt={label || 'image'}
              tooltipTitle={imageTip}
              showAltCaption={Boolean(label.trim())}
              className="w-full rounded-lg cursor-zoom-in"
              classNames={{
                wrapper: 'not-prose my-2 block max-w-[400px] mx-auto rounded-lg w-full',
                errorPlaceholder: 'aspect-square h-[30vh]'
              }}
              holdUntilClick={lazyMedia}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                if (typeof imageIdx === 'number') openLightbox(imageIdx)
              }}
            />
          )
          break
        }
        default: {
          const txt = String(token.raw ?? token.text ?? '')
          if (txt) {
            collectHashtags(txt)
            out.push(
              ...parseInlineMarkdownLegacy(txt, `${key}-fallback`, footnotes, emojiInfos, navigateToHashtag, emojiLightbox)
            )
          }
        }
      }
    }
    return out
  }

  const renderParagraph = (token: any, key: string): React.ReactNode => {
    const rawParagraphText = String(token.text ?? token.raw ?? '')
    const paragraphText = rawParagraphText.trim()
    if (!paragraphText) {
      return null
    }
    const displayMathSplit = splitParagraphByDisplayMath(rawParagraphText)
    if (displayMathSplit) {
      return (
        <div key={`${key}-display-math-split`} className="space-y-2">
          {displayMathSplit.map((seg, idx) =>
            seg.kind === 'math' ? (
              <MathExpression
                key={`${key}-dm-${idx}`}
                keyPrefix={`${key}-dm-${idx}`}
                expression={seg.expression}
                displayMode
              />
            ) : (
              <div key={`${key}-dmt-${idx}`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
                {renderInlineTokens(
                  lexInlineProtected(seg.text.trim()),
                  `${key}-dmt-${idx}`
                )}
              </div>
            )
          )}
        </div>
      )
    }
    const standaloneMath = parseDelimitedMath(rawParagraphText.trim())
    if (standaloneMath) {
      return (
        <MathExpression
          key={`${key}-standalone-math`}
          keyPrefix={`${key}-standalone-math`}
          expression={standaloneMath.expression}
          displayMode={standaloneMath.displayMode}
        />
      )
    }
    const recoveredMdImage = tryRecoverMalformedMarkdownImageParagraph(paragraphText)
    if (recoveredMdImage) {
      const cleaned = cleanUrl(recoveredMdImage.href)
      if (cleaned && (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) && isSafeMediaUrl(cleaned)) {
        const baseImeta = imetaInfoForStandaloneImageUrl(cleaned)
        let imageIdx = imageIndexMap.get(cleaned)
        if (imageIdx === undefined && getImageIdentifier) {
          const id = getImageIdentifier(cleaned)
          if (id) imageIdx = imageIndexMap.get(`__img_id:${id}`)
        }
        const alt = recoveredMdImage.alt || 'image'
        const imageTip =
          recoveredMdImage.title && recoveredMdImage.title.trim().length > 0
            ? recoveredMdImage.title.trim()
            : undefined
        return (
          <div key={`${key}-recovered-md-img`} className="my-2 not-prose block max-w-[400px] mx-auto">
            <Image
              image={{ ...baseImeta, url: recoveredMdImage.href }}
              alt={alt}
              tooltipTitle={imageTip}
              showAltCaption={Boolean(recoveredMdImage.alt.trim())}
              className="w-full rounded-lg cursor-zoom-in"
              classNames={{
                wrapper: 'not-prose my-2 block max-w-[400px] mx-auto rounded-lg w-full',
                errorPlaceholder: 'aspect-square h-[30vh]'
              }}
              holdUntilClick={lazyMedia}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                if (typeof imageIdx === 'number') openLightbox(imageIdx)
              }}
            />
          </div>
        )
      }
    }
    const isNostrEventBech32 = (value: string): boolean =>
      value.startsWith('note') || value.startsWith('nevent') || value.startsWith('naddr')
    const standaloneNostr = paragraphText.match(/^nostr:([a-z0-9]{8,})$/i)
    if (standaloneNostr) {
      const bech32Id = standaloneNostr[1]
      if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
        return (
          <span key={`${key}-nostr-profile`} className="inline">
            <EmbeddedMention userId={bech32Id} className="inline" />
          </span>
        )
      }
      if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
        if (fullCalendarInvite && bech32Id === fullCalendarInvite.naddr) {
          return (
            <div key={`${key}-calendar`} className="w-full my-2">
              <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
            </div>
          )
        }
        return (
          <div key={`${key}-nostr-event`} className="w-full my-2">
            <EmbeddedNote noteId={bech32Id} containingEvent={containingEvent} showFull={false} />
          </div>
        )
      }
    }

    const wiki = paragraphText.match(/^\[\[([^\]]+)\]\]$/)
    if (wiki) {
      const linkContent = wiki[1].trim()
      const target = linkContent.includes('|') ? linkContent.split('|')[0].trim() : linkContent
      const displayText = linkContent.includes('|') ? linkContent.split('|')[1].trim() : linkContent
      const dTag = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      return <Wikilink key={`${key}-wikilink`} dTag={dTag} displayText={displayText} />
    }

    if (/^wss?:\/\/\S+$/i.test(paragraphText)) {
      return (
        <a
          key={`${key}-relay`}
          href={`/relays/${encodeURIComponent(paragraphText)}`}
          className={cn('inline', URI_LINK_CLASS)}
          onClick={(e) => {
            e.preventDefault()
            navigateToRelay(paragraphText)
          }}
        >
          {paragraphText}
        </a>
      )
    }

    // Mixed paragraphs can contain normal text plus one or more standalone nostr lines.
    // Render standalone special lines (nostr refs, relay links, plain URLs/media) as dedicated blocks
    // even when they are not the entire paragraph.
    if (rawParagraphText.includes('\n')) {
      const lines = rawParagraphText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
      const hasStandaloneSpecialLine = lines.some(
        (line) =>
          /^nostr:([a-z0-9]{8,})$/i.test(line) ||
          /^wss?:\/\/\S+$/i.test(line) ||
          /^https?:\/\/\S+$/i.test(line)
      )
      if (hasStandaloneSpecialLine) {
        const lineNodes = lines.map((line, lineIdx) => {
          const nostrMatch = line.match(/^nostr:([a-z0-9]{8,})$/i)
          if (!nostrMatch) {
            if (/^wss?:\/\/\S+$/i.test(line)) {
              return (
                <a
                  key={`${key}-line-relay-${lineIdx}`}
                  href={`/relays/${encodeURIComponent(line)}`}
                  className={cn('inline', URI_LINK_CLASS)}
                  onClick={(e) => {
                    e.preventDefault()
                    navigateToRelay(line)
                  }}
                >
                  {line}
                </a>
              )
            }

            if (/^https?:\/\/\S+$/i.test(line)) {
              const cleaned = cleanUrl(line)
              if (cleaned) {
                if (isEmbeddableYoutubeUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-youtube-${lineIdx}`} className="my-2">
                      <YoutubeEmbeddedPlayer
                        url={cleaned}
                        className="max-w-[400px]"
                        mustLoad={!lazyMedia}
                      />
                    </div>
                  )
                }
                if (isSpotifyUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-spotify-${lineIdx}`} className="my-2">
                      <SpotifyEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                    </div>
                  )
                }
                if (isWavlakeUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-wavlake-${lineIdx}`} className="my-2">
                      <WavlakeEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                    </div>
                  )
                }
                if (isFountainUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-fountain-${lineIdx}`} className="my-2">
                      <FountainEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                    </div>
                  )
                }
                if (isZapStreamUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-zapstream-${lineIdx}`} className="my-2">
                      <ZapStreamLiveEventEmbed
                        url={cleaned}
                        className="max-w-[400px]"
                        containingEvent={ogLinkContainingEvent}
                        showFull={!lazyMedia}
                      />
                    </div>
                  )
                }
                if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
                  const poster = videoPosterMap?.get(cleaned)
                  return (
                    <div key={`${key}-line-media-${lineIdx}`} className="my-2">
                      <MediaPlayer
                        src={cleaned}
                        poster={poster}
                        blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                        className="max-w-[400px]"
                        mustLoad={!lazyMedia}
                      />
                    </div>
                  )
                }
                if (isPseudoNostrHttpsUrl(cleaned)) {
                  return (
                    <div key={`${key}-line-http-nostr-${lineIdx}`} className="my-2 not-prose max-w-full">
                      <HttpNostrAwareUrl url={cleaned} renderMode="article" containingEvent={containingEvent} />
                    </div>
                  )
                }
                if ((isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) && isSafeMediaUrl(cleaned)) {
                  return renderStandaloneHttpsImageOrBlossomBlob(cleaned, `${key}-line-img-${lineIdx}`)
                }
                if (suppressStandaloneWebPreviewCleanedUrls?.has(cleaned)) {
                  return (
                    <p key={`${key}-line-inline-link-${lineIdx}`} className="mb-1 last:mb-0">
                      <a
                        href={cleaned}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn('inline', URI_LINK_CLASS)}
                      >
                        {cleaned}
                      </a>
                    </p>
                  )
                }
                return (
                  <HttpUrlOpenGraphOrLink
                    key={`${key}-line-webpreview-${lineIdx}`}
                    url={cleaned}
                    containingEvent={ogLinkContainingEvent}
                    block
                  />
                )
              }
            }

            return (
              <div key={`${key}-line-${lineIdx}`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
                {renderInlineTokens(lexInlineProtected(line) as any[], `${key}-line-inline-${lineIdx}`)}
              </div>
            )
          }

          const bech32Id = nostrMatch[1]
          if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
            return (
              <span key={`${key}-line-profile-${lineIdx}`} className="inline">
                <EmbeddedMention userId={bech32Id} className="inline" />
              </span>
            )
          }

          if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
            if (fullCalendarInvite && bech32Id === fullCalendarInvite.naddr) {
              return (
                <div key={`${key}-line-calendar-${lineIdx}`} className="w-full my-2">
                  <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
                </div>
              )
            }
            return (
              <div key={`${key}-line-event-${lineIdx}`} className="w-full my-2">
                <EmbeddedNote noteId={bech32Id} containingEvent={containingEvent} showFull={false} />
              </div>
            )
          }

          return (
            <div key={`${key}-line-fallback-${lineIdx}`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
              {renderInlineTokens(lexInlineProtected(line) as any[], `${key}-line-fallback-inline-${lineIdx}`)}
            </div>
          )
        })

        return <div key={`${key}-line-mix`}>{lineNodes}</div>
      }
    }

    // Inline nostr event IDs can appear as plain text inside a sentence (not link tokens).
    // Split paragraph around those IDs so event references render as embedded cards.
    const rawInlineNostrMatches = Array.from(rawParagraphText.matchAll(new RegExp(NOSTR_URI_INLINE_REGEX.source, NOSTR_URI_INLINE_REGEX.flags)))
      .filter((m) => m.index !== undefined && isNostrEventBech32((m[1] ?? '').toLowerCase()))
    if (rawInlineNostrMatches.length > 0) {
      const nodes: React.ReactNode[] = []
      let cursor = 0
      let segmentIdx = 0
      for (const match of rawInlineNostrMatches) {
        const start = match.index!
        const end = start + match[0].length
        const bech32Id = String(match[1] ?? '')
        const before = rawParagraphText.slice(cursor, start)
        if (before.trim().length > 0) {
          nodes.push(
            <div
              key={`${key}-nostr-raw-segment-${segmentIdx++}`}
              role="paragraph"
              className={MD_PARAGRAPH_FLOW_CLASS}
            >
              {parseInlineMarkdown(before, `${key}-nostr-raw-segment-${segmentIdx}`, footnotes, emojiInfos, navigateToHashtag, emojiLightbox)}
            </div>
          )
        }
        if (bech32Id.startsWith('naddr') && fullCalendarInvite && bech32Id === fullCalendarInvite.naddr) {
          nodes.push(
            <div key={`${key}-nostr-raw-calendar-${segmentIdx++}`} className="w-full my-2">
              <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
            </div>
          )
        } else {
          nodes.push(
            <div key={`${key}-nostr-raw-event-${segmentIdx++}`} className="w-full my-2">
              <EmbeddedNote noteId={bech32Id} containingEvent={containingEvent} showFull={false} />
            </div>
          )
        }
        cursor = end
      }
      const after = rawParagraphText.slice(cursor)
      if (after.trim().length > 0) {
        nodes.push(
          <div
            key={`${key}-nostr-raw-segment-${segmentIdx++}`}
            role="paragraph"
            className={MD_PARAGRAPH_FLOW_CLASS}
          >
            {parseInlineMarkdown(after, `${key}-nostr-raw-segment-${segmentIdx}`, footnotes, emojiInfos, navigateToHashtag, emojiLightbox)}
          </div>
        )
      }
      if (nodes.length > 0) {
        return <div key={`${key}-nostr-raw-mix`}>{nodes}</div>
      }
    }

    if (/^https?:\/\/\S+$/i.test(paragraphText)) {
      const cleaned = cleanUrl(paragraphText)
      if (cleaned) {
        if (isEmbeddableYoutubeUrl(cleaned)) {
          return (
            <div key={`${key}-youtube-url`} className="my-2">
              <YoutubeEmbeddedPlayer
                url={cleaned}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        }
        if (isSpotifyUrl(cleaned)) {
          return (
            <div key={`${key}-spotify-url`} className="my-2">
              <SpotifyEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
            </div>
          )
        }
        if (isWavlakeUrl(cleaned)) {
          return (
            <div key={`${key}-wavlake-url`} className="my-2">
              <WavlakeEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
            </div>
          )
        }
        if (isFountainUrl(cleaned)) {
          return (
            <div key={`${key}-fountain-url`} className="my-2">
              <FountainEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
            </div>
          )
        }
        if (isZapStreamUrl(cleaned)) {
          return (
            <div key={`${key}-zapstream-url`} className="my-2">
              <ZapStreamLiveEventEmbed
                url={cleaned}
                className="max-w-[400px]"
                containingEvent={containingEvent}
                showFull={!lazyMedia}
              />
            </div>
          )
        }
        if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
          const poster = videoPosterMap?.get(cleaned)
          return (
            <div key={`${key}-media-url`} className="my-2">
              <MediaPlayer
                src={cleaned}
                poster={poster}
                blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        }
        if (isPseudoNostrHttpsUrl(cleaned)) {
          return (
            <div key={`${key}-http-nostr`} className="my-2 not-prose max-w-full">
              <HttpNostrAwareUrl url={cleaned} renderMode="article" containingEvent={containingEvent} />
            </div>
          )
        }
        if ((isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) && isSafeMediaUrl(cleaned)) {
          return renderStandaloneHttpsImageOrBlossomBlob(cleaned, `${key}-para-img`)
        }
        if (suppressStandaloneWebPreviewCleanedUrls?.has(cleaned)) {
          return (
            <p key={`${key}-inline-link`} className="mb-1 last:mb-0">
              <a
                href={cleaned}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('inline', URI_LINK_CLASS)}
              >
                {cleaned}
              </a>
            </p>
          )
        }
        return <HttpUrlOpenGraphOrLink key={`${key}-webpreview`} url={cleaned} containingEvent={ogLinkContainingEvent} block />
      }
    }

    const paragraphTokens = lexInlineProtected(rawParagraphText)

    // One GFM autolink only: embed using `href` even when `paragraphText`/`token.text` do not match
    // `^https?://…$` (marked quirks, odd whitespace, or autolink vs raw mismatch).
    if (Array.isArray(paragraphTokens) && paragraphTokens.length === 1 && paragraphTokens[0]?.type === 'link') {
      const soleHref = cleanUrl(String(paragraphTokens[0].href ?? ''))
      if (soleHref && isEmbeddableYoutubeUrl(soleHref)) {
        return (
          <div key={`${key}-youtube-sole-link`} className="my-2">
            <YoutubeEmbeddedPlayer url={soleHref} className="max-w-[400px]" mustLoad={!lazyMedia} />
          </div>
        )
      }
      if (soleHref && isSpotifyUrl(soleHref)) {
        return (
          <div key={`${key}-spotify-sole-link`} className="my-2">
            <SpotifyEmbeddedPlayer url={soleHref} className="max-w-[400px]" mustLoad={!lazyMedia} />
          </div>
        )
      }
      if (soleHref && isWavlakeUrl(soleHref)) {
        return (
          <div key={`${key}-wavlake-sole-link`} className="my-2">
            <WavlakeEmbeddedPlayer url={soleHref} className="max-w-[400px]" mustLoad={!lazyMedia} />
          </div>
        )
      }
      if (soleHref && isFountainUrl(soleHref)) {
        return (
          <div key={`${key}-fountain-sole-link`} className="my-2">
            <FountainEmbeddedPlayer url={soleHref} className="max-w-[400px]" mustLoad={!lazyMedia} />
          </div>
        )
      }
      if (soleHref && isZapStreamUrl(soleHref)) {
        return (
          <div key={`${key}-zapstream-sole-link`} className="my-2">
            <ZapStreamLiveEventEmbed
              url={soleHref}
              className="max-w-[400px]"
              containingEvent={containingEvent}
              showFull={!lazyMedia}
            />
          </div>
        )
      }
      if (soleHref && (isVideo(soleHref) || isAudio(soleHref) || isHlsPlaylistUrl(soleHref))) {
        const poster = videoPosterMap?.get(soleHref)
        return (
          <div key={`${key}-direct-media-sole-link`} className="my-2">
            <MediaPlayer
              src={soleHref}
              className="max-w-[400px]"
              mustLoad={!lazyMedia}
              poster={poster}
              blurHash={mediaBlurHashMap?.get(soleHref)}
              dim={mediaDimMap?.get(soleHref)}
            />
          </div>
        )
      }
      if (
        soleHref &&
        (soleHref.startsWith('http://') || soleHref.startsWith('https://'))
      ) {
        if (isPseudoNostrHttpsUrl(soleHref)) {
          return (
            <div key={`${key}-sole-http-nostr`} className="my-2 not-prose max-w-full">
              <HttpNostrAwareUrl
                url={soleHref}
                renderMode="article"
                containingEvent={containingEvent}
              />
            </div>
          )
        }
        if (suppressStandaloneWebPreviewCleanedUrls?.has(soleHref)) {
          return (
            <p key={`${key}-sole-link-suppressed`} className="mb-1 last:mb-0">
              <a
                href={soleHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('inline', URI_LINK_CLASS)}
              >
                {soleHref}
              </a>
            </p>
          )
        }
        return (
          <HttpUrlOpenGraphOrLink
            key={`${key}-sole-link-webpreview`}
            url={soleHref}
            containingEvent={ogLinkContainingEvent}
            block
          />
        )
      }
    }

    const parseNostrHref = (href: string): string | null => {
      if (!href.toLowerCase().startsWith('nostr:')) return null
      const raw = href.slice(6).trim()
      if (!raw) return null
      const bech32 = raw.split(/[?#]/)[0]?.replace(/\/+$/, '') || ''
      return bech32 || null
    }

    // Inline nostr event links (e.g. "… nostr:naddr1…") should render embedded cards.
    // Split paragraph into inline text segments + block embeds to avoid invalid <p><div/></p> trees.
    if (Array.isArray(paragraphTokens) && paragraphTokens.length > 0) {
      const hasInlineMediaImageToken = paragraphTokens.some((t) => {
        if (t?.type !== 'image') return false
        const cleaned = cleanUrl(String(t.href ?? ''))
        return !!cleaned && (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned))
      })
      if (hasInlineMediaImageToken) {
        const nodes: React.ReactNode[] = []
        let inlineSegment: any[] = []
        const flushInlineSegment = (segmentIdx: number) => {
          if (inlineSegment.length === 0) return
          nodes.push(
            <div
              key={`${key}-media-inline-segment-${segmentIdx}`}
              role="paragraph"
              className={MD_PARAGRAPH_FLOW_CLASS}
            >
              {renderInlineTokens(inlineSegment, `${key}-media-inline-segment-${segmentIdx}`)}
            </div>
          )
          inlineSegment = []
        }

        let segmentIdx = 0
        paragraphTokens.forEach((t: any, idx: number) => {
          // Same paragraph can mix ![](video) with GFM autolinks (single line break → one <p> in marked).
          // Without this, YouTube/Spotify/zap.stream links are pushed into inlineSegment and render as plain <a>.
          if (t?.type === 'link') {
            const cleaned = cleanUrl(String(t.href ?? ''))
            if (cleaned && isEmbeddableYoutubeUrl(cleaned)) {
              flushInlineSegment(segmentIdx++)
              nodes.push(
                <div key={`${key}-inline-yt-with-media-${idx}`} className="my-2">
                  <YoutubeEmbeddedPlayer
                    url={cleaned}
                    className="max-w-[400px]"
                    mustLoad={!lazyMedia}
                  />
                </div>
              )
              return
            }
            if (cleaned && isSpotifyUrl(cleaned)) {
              flushInlineSegment(segmentIdx++)
              nodes.push(
                <div key={`${key}-inline-spotify-with-media-${idx}`} className="my-2">
                  <SpotifyEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
              return
            }
            if (cleaned && isWavlakeUrl(cleaned)) {
              flushInlineSegment(segmentIdx++)
              nodes.push(
                <div key={`${key}-inline-wavlake-with-media-${idx}`} className="my-2">
                  <WavlakeEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
              return
            }
            if (cleaned && isFountainUrl(cleaned)) {
              flushInlineSegment(segmentIdx++)
              nodes.push(
                <div key={`${key}-inline-fountain-with-media-${idx}`} className="my-2">
                  <FountainEmbeddedPlayer url={cleaned} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
              return
            }
            if (cleaned && isZapStreamUrl(cleaned)) {
              flushInlineSegment(segmentIdx++)
              nodes.push(
                <div key={`${key}-inline-zapstream-with-media-${idx}`} className="my-2">
                  <ZapStreamLiveEventEmbed
                    url={cleaned}
                    className="max-w-[400px]"
                    containingEvent={ogLinkContainingEvent}
                    showFull={!lazyMedia}
                  />
                </div>
              )
              return
            }
            if (cleaned && (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned))) {
              flushInlineSegment(segmentIdx++)
              const poster = videoPosterMap?.get(cleaned)
              nodes.push(
                <div key={`${key}-inline-direct-media-with-mixed-${idx}`} className="my-2">
                  <MediaPlayer
                    src={cleaned}
                    poster={poster}
                    blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                    className="max-w-[400px]"
                    mustLoad={!lazyMedia}
                  />
                </div>
              )
              return
            }
          }
          if (t?.type !== 'image') {
            inlineSegment.push(t)
            return
          }
          const src = String(t.href ?? '')
          const cleaned = cleanUrl(src)
          if (!cleaned || (!isVideo(cleaned) && !isAudio(cleaned) && !isHlsPlaylistUrl(cleaned))) {
            inlineSegment.push(t)
            return
          }
          flushInlineSegment(segmentIdx++)
          const poster = videoPosterMap?.get(cleaned)
          nodes.push(
            <div key={`${key}-inline-media-${idx}`} className="my-2">
              <MediaPlayer
                src={cleaned}
                poster={poster}
                blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        })

        flushInlineSegment(segmentIdx++)
        if (nodes.length > 0) {
          return <div key={`${key}-inline-media-mix`}>{nodes}</div>
        }
      }

      const hasInlineNostrEventLink = paragraphTokens.some((t) => {
        if (t?.type !== 'link') return false
        const bech32 = parseNostrHref(String(t.href ?? ''))
        return !!bech32 && isNostrEventBech32(bech32)
      })
      if (hasInlineNostrEventLink) {
        const nodes: React.ReactNode[] = []
        let inlineSegment: any[] = []
        const flushInlineSegment = (segmentIdx: number) => {
          if (inlineSegment.length === 0) return
          nodes.push(
            <div
              key={`${key}-nostr-inline-segment-${segmentIdx}`}
              role="paragraph"
              className={MD_PARAGRAPH_FLOW_CLASS}
            >
              {renderInlineTokens(inlineSegment, `${key}-nostr-inline-segment-${segmentIdx}`)}
            </div>
          )
          inlineSegment = []
        }

        let segmentIdx = 0
        paragraphTokens.forEach((t: any, idx: number) => {
          if (t?.type !== 'link') {
            inlineSegment.push(t)
            return
          }
          const href = String(t.href ?? '')
          const bech32 = parseNostrHref(href)
          if (!bech32 || !isNostrEventBech32(bech32)) {
            inlineSegment.push(t)
            return
          }

          flushInlineSegment(segmentIdx++)
          if (bech32.startsWith('naddr') && fullCalendarInvite && bech32 === fullCalendarInvite.naddr) {
            nodes.push(
              <div key={`${key}-nostr-inline-calendar-${idx}`} className="w-full my-2">
                <CalendarEventContent event={fullCalendarInvite.event} className="mt-2" showRsvp />
              </div>
            )
          } else {
            nodes.push(
              <div key={`${key}-nostr-inline-event-${idx}`} className="w-full my-2">
                <EmbeddedNote noteId={bech32} containingEvent={containingEvent} showFull={false} />
              </div>
            )
          }
        })

        flushInlineSegment(segmentIdx++)
        if (nodes.length > 0) {
          return <div key={`${key}-nostr-inline-mix`}>{nodes}</div>
        }
      }

      // GFM autolinks become `link` tokens; without this, "…text\nhttps://youtube.com/…" can become
      // [text, br, link] and fall through to a single <p> with a plain anchor instead of an embed.
      const hasInlineYouTubeLink = paragraphTokens.some((t: any) => {
        if (t?.type !== 'link') return false
        const cleaned = cleanUrl(String(t.href ?? ''))
        return !!cleaned && isEmbeddableYoutubeUrl(cleaned)
      })
      if (hasInlineYouTubeLink) {
        const nodes: React.ReactNode[] = []
        let inlineSegment: any[] = []
        const flushInlineSegment = (segmentIdx: number) => {
          if (inlineSegment.length === 0) return
          nodes.push(
            <div
              key={`${key}-yt-inline-segment-${segmentIdx}`}
              role="paragraph"
              className={MD_PARAGRAPH_FLOW_CLASS}
            >
              {renderInlineTokens(inlineSegment, `${key}-yt-inline-segment-${segmentIdx}`)}
            </div>
          )
          inlineSegment = []
        }

        let segmentIdx = 0
        paragraphTokens.forEach((t: any, idx: number) => {
          if (t?.type !== 'link') {
            inlineSegment.push(t)
            return
          }
          const cleaned = cleanUrl(String(t.href ?? ''))
          if (!cleaned || !isEmbeddableYoutubeUrl(cleaned)) {
            inlineSegment.push(t)
            return
          }

          flushInlineSegment(segmentIdx++)
          nodes.push(
            <div key={`${key}-yt-embed-${idx}`} className="my-2">
              <YoutubeEmbeddedPlayer
                url={cleaned}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        })

        flushInlineSegment(segmentIdx++)
        if (nodes.length > 0) {
          return <div key={`${key}-yt-inline-mix`}>{nodes}</div>
        }
      }

      const hasInlineDirectMediaLink = paragraphTokens.some((t: any) => {
        if (t?.type !== 'link') return false
        const cleaned = cleanUrl(String(t.href ?? ''))
        return !!cleaned && (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned))
      })
      if (hasInlineDirectMediaLink) {
        const nodes: React.ReactNode[] = []
        let inlineSegment: any[] = []
        const flushInlineSegment = (segmentIdx: number) => {
          if (inlineSegment.length === 0) return
          nodes.push(
            <div
              key={`${key}-direct-media-inline-segment-${segmentIdx}`}
              role="paragraph"
              className={MD_PARAGRAPH_FLOW_CLASS}
            >
              {renderInlineTokens(inlineSegment, `${key}-direct-media-inline-segment-${segmentIdx}`)}
            </div>
          )
          inlineSegment = []
        }

        let segmentIdx = 0
        paragraphTokens.forEach((t: any, idx: number) => {
          if (t?.type !== 'link') {
            inlineSegment.push(t)
            return
          }
          const cleaned = cleanUrl(String(t.href ?? ''))
          if (!cleaned || (!isVideo(cleaned) && !isAudio(cleaned) && !isHlsPlaylistUrl(cleaned))) {
            inlineSegment.push(t)
            return
          }

          flushInlineSegment(segmentIdx++)
          const poster = videoPosterMap?.get(cleaned)
          nodes.push(
            <div key={`${key}-inline-direct-media-${idx}`} className="my-2">
              <MediaPlayer
                src={cleaned}
                poster={poster}
                blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        })

        flushInlineSegment(segmentIdx++)
        if (nodes.length > 0) {
          return <div key={`${key}-direct-media-inline-mix`}>{nodes}</div>
        }
      }
    }

    // If the paragraph is a single markdown image token, render it as block media/image
    // instead of wrapping in <p> (avoids invalid DOM nesting for media players).
    if (Array.isArray(paragraphTokens) && paragraphTokens.length === 1 && paragraphTokens[0]?.type === 'image') {
      const imageToken = paragraphTokens[0]
      const src = String(imageToken.href ?? '')
      const cleaned = cleanUrl(src)
      if (cleaned) {
        if (isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned)) {
          const poster = videoPosterMap?.get(cleaned)
          return (
            <div key={`${key}-media-block`} className="my-2">
              <MediaPlayer
                src={cleaned}
                poster={poster}
                blurHash={mediaBlurHashMap?.get(cleaned)}
              dim={mediaDimMap?.get(cleaned)}
                className="max-w-[400px]"
                mustLoad={!lazyMedia}
              />
            </div>
          )
        }
        if (isBlossomBudBlobUrl(cleaned) && isSafeMediaUrl(cleaned)) {
          const im = imetaInfoForStandaloneImageUrl(cleaned)
          if (im.m?.startsWith('video/') || im.m?.startsWith('audio/')) {
            const poster = videoPosterMap?.get(cleaned) ?? im.image
            return (
              <div key={`${key}-blossom-media-block`} className="my-2">
                <MediaPlayer
                  src={cleaned}
                  poster={poster}
                  blurHash={mediaBlurHashMap?.get(cleaned) ?? im.blurHash}
            dim={mediaDimMap?.get(cleaned) ?? im.dim}
                  className="max-w-[400px]"
                  mustLoad={!lazyMedia}
                />
              </div>
            )
          }
        }
        if ((!isImage(cleaned) && !isBlossomBudBlobUrl(cleaned)) || !isSafeMediaUrl(cleaned)) {
          return (
            <div key={`${key}-img-inline-fallback`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
              {renderInlineTokens(paragraphTokens, `${key}-img-inline-fallback`)}
            </div>
          )
        }
        const imageIdx = imageIndexMap.get(cleaned)
        return (
          <Image
            key={`${key}-img-block`}
            image={imetaInfoForStandaloneImageUrl(cleaned)}
            alt={imageToken.text || 'image'}
            tooltipTitle={markdownTokenTitle(imageToken)}
            showAltCaption={Boolean(String(imageToken.text ?? '').trim())}
            className="w-full rounded-lg cursor-zoom-in my-0"
            classNames={{ wrapper: 'my-2 block max-w-[400px] mx-auto' }}
            holdUntilClick={lazyMedia}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              if (typeof imageIdx === 'number') openLightbox(imageIdx)
            }}
          />
        )
      }
    }

    const inlineNodes = renderInlineTokens(paragraphTokens, `${key}-inline`)
    const emojiOnly = isEmojiOnlyParagraphText(paragraphText)
    return (
      <div
        key={`${key}-p`}
        role="paragraph"
        className={emojiOnly ? 'mb-1 last:mb-0 leading-none' : MD_PARAGRAPH_FLOW_CLASS}
      >
        {inlineNodes}
      </div>
    )
  }

  const renderBlockTokens = (tokens: any[], keyPrefix: string): React.ReactNode[] => {
    const nodes: React.ReactNode[] = []
    /** Marked emits `space` for inter-block newlines; ≥2 are required between blocks—extras are user intent. */
    const spaceTokenExtraGapEm = (t: { raw?: string }): number => {
      const raw = String(t.raw ?? '')
      const newlineCount = raw.match(/\n/g)?.length ?? 0
      const extraLines = Math.max(0, newlineCount - 2)
      return Math.min(extraLines, 12) * 1.25
    }
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const key = `${keyPrefix}-${i}`
      switch (token.type) {
        case 'space': {
          const next = tokens[i + 1]
          const nextIsEmojiOnly =
            next?.type === 'paragraph' && isEmojiOnlyParagraphText(String(next.text ?? next.raw ?? ''))
          const gapEm = nextIsEmojiOnly ? 0 : spaceTokenExtraGapEm(token)
          if (gapEm > 0) {
            nodes.push(
              <div
                key={`${key}-space`}
                className="not-prose pointer-events-none select-none"
                aria-hidden
                style={{ minHeight: `${gapEm}em` }}
              />
            )
          }
          break
        }
        case 'paragraph':
          nodes.push(renderParagraph(token, key))
          break
        case 'heading': {
          const level = Number(token.depth || 1)
          const headingClass =
            level === 1
              ? 'text-3xl'
              : level === 2
                ? 'text-2xl'
                : level === 3
                  ? 'text-xl'
                  : level === 4
                    ? 'text-lg'
                    : 'text-base'
          nodes.push(
            React.createElement(
              `h${Math.min(Math.max(level, 1), 6)}`,
              { key: `${key}-h`, className: `font-bold break-words block mt-4 mb-2 ${headingClass}` },
              renderInlineTokens(lexInlineProtected(String(token.text ?? '')), `${key}-h-inline`)
            )
          )
          break
        }
        case 'hr':
          nodes.push(<hr key={`${key}-hr`} className="my-4 border-t border-gray-300 dark:border-gray-700" />)
          break
        case 'code': {
          const codeText = String(token.text ?? '')
          const codeLang = String(token.lang ?? '')
          const parsedMath = parseDelimitedMath(codeText.trim())
          if (parsedMath || isMathLanguage(codeLang)) {
            nodes.push(
              <MathExpression
                key={`${key}-code-math`}
                keyPrefix={`${key}-code-math`}
                expression={parsedMath ? parsedMath.expression : codeText.trim()}
                displayMode={true}
              />
            )
            break
          }
          nodes.push(
            <CodeBlock
              key={`${key}-code`}
              id={`code-block-${codeBlockIdx++}`}
              code={codeText}
              language={codeLang}
            />
          )
          break
        }
        case 'blockquote': {
          const rawLines = String(token.raw ?? '')
            .split('\n')
            .map((line) => line.replace(/\r$/u, ''))
            .filter((line) => line.trim().length > 0)
          const isGreentext =
            rawLines.length > 0 && rawLines.every((line) => isMarkdownGreentextLine(line.trim()))
          if (isGreentext) {
            const lines = rawLines.map((line) => stripMarkdownGreentextMarker(line.trim()))
            nodes.push(
              <div
                key={`${key}-gt`}
                className="not-prose greentext my-1 block text-[#4a7c3a] dark:text-[#8fbc8f]"
              >
                {lines.map((line, idx) => (
                  <React.Fragment key={`${key}-gt-line-${idx}`}>
                    {renderInlineTokens(lexInlineProtected(line) as any[], `${key}-gt-inline-${idx}`)}
                    {idx < lines.length - 1 ? <br /> : null}
                  </React.Fragment>
                ))}
              </div>
            )
          } else {
            nodes.push(
              <blockquote
                key={`${key}-bq`}
                className="border-l-4 border-gray-400 dark:border-gray-500 pl-4 pr-2 py-2 my-4 italic text-gray-700 dark:text-gray-300 bg-gray-50/50 dark:bg-gray-800/30"
              >
                {renderBlockTokens(token.tokens ?? [], `${key}-bq-inner`)}
              </blockquote>
            )
          }
          break
        }
        case 'list': {
          const items: any[] = token.items ?? []
          const isTaskList = items.some((it: any) => it.task)
          const ListTag = token.ordered ? 'ol' : 'ul'
          const listClass = isTaskList
            ? 'my-2 ml-0 list-none space-y-1.5'
            : token.ordered
              ? 'list-decimal list-outside my-2 ml-6'
              : 'list-disc list-outside my-2 ml-6 space-y-1'
          const startNum = token.ordered ? Number((token as { start?: number }).start ?? 1) : 1

          const renderListItemContent = (item: any, itemKey: string): React.ReactNode => {
            const itemTokens = item.tokens ?? [{ type: 'text', text: item.text ?? '' }]

            if (item.task) {
              if (
                itemTokens.length === 1 &&
                itemTokens[0]?.type === 'paragraph' &&
                Array.isArray(itemTokens[0].tokens)
              ) {
                return renderInlineTokens(itemTokens[0].tokens, `${itemKey}-task-p`)
              }
              if (itemTokens.some((t: any) => t.type === 'checkbox')) {
                return renderInlineTokens(itemTokens, `${itemKey}-task-flat`)
              }
            }

            if (itemTokens.length === 1) {
              const single = itemTokens[0]
              if (single.type === 'text') {
                return renderInlineTokens(
                  lexInlineProtected(String(single.text ?? '')),
                  `${itemKey}-inline`
                )
              }
              if (single.type === 'paragraph') {
                return renderInlineTokens(
                  lexInlineProtected(String(single.text ?? '')),
                  `${itemKey}-inline`
                )
              }
            }
            return renderBlockTokens(itemTokens, itemKey)
          }

          const listBody = React.createElement(
            ListTag,
            token.ordered
              ? { className: listClass, start: startNum }
              : { className: listClass },
            items.map((item: any, itemIdx: number) => (
              <li
                key={`${key}-li-${itemIdx}`}
                className={isTaskList ? 'flex list-none items-center gap-2' : undefined}
              >
                {isTaskList && token.ordered ? (
                  <span
                    className="inline-flex min-w-[1.25rem] shrink-0 items-center justify-end self-center text-right text-xs tabular-nums leading-none text-muted-foreground"
                    aria-hidden
                  >
                    {startNum + itemIdx}.
                  </span>
                ) : null}
                {isTaskList ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                    {renderListItemContent(item, `${key}-li-${itemIdx}`)}
                  </div>
                ) : (
                  renderListItemContent(item, `${key}-li-${itemIdx}`)
                )}
              </li>
            ))
          )
          nodes.push(
            isTaskList ? (
              <div key={`${key}-tasklist`} className="not-prose max-w-none">
                {listBody}
              </div>
            ) : (
              React.cloneElement(listBody, { key: `${key}-list` })
            )
          )
          break
        }
        case 'table': {
          nodes.push(
            <div key={`${key}-table-wrap`} className="my-4 overflow-x-auto">
              <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-700">
                <thead>
                  <tr>
                    {(token.header ?? []).map((cell: any, cIdx: number) => (
                      <th
                        key={`${key}-th-${cIdx}`}
                        className="border border-gray-300 dark:border-gray-700 px-4 py-2 bg-gray-100 dark:bg-gray-800 font-semibold text-left"
                      >
                        {renderInlineTokens(lexInlineProtected(String(cell.text ?? '')), `${key}-th-inline-${cIdx}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(token.rows ?? []).map((row: any[], rIdx: number) => (
                    <tr key={`${key}-tr-${rIdx}`}>
                      {row.map((cell: any, cIdx: number) => (
                        <td key={`${key}-td-${rIdx}-${cIdx}`} className="border border-gray-300 dark:border-gray-700 px-4 py-2">
                          {renderInlineTokens(
                            lexInlineProtected(String(cell.text ?? '')),
                            `${key}-td-inline-${rIdx}-${cIdx}`
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          break
        }
        default: {
          if (Array.isArray(token.tokens) && token.tokens.length > 0) {
            nodes.push(...renderBlockTokens(token.tokens, `${key}-nested`))
          } else if (typeof token.text === 'string' && token.text.trim()) {
            nodes.push(
              <div key={`${key}-fallback`} role="paragraph" className={MD_PARAGRAPH_FLOW_CLASS}>
                {renderInlineTokens(lexInlineProtected(String(token.text ?? token.raw ?? '')) as any[], `${key}-fallback-inline`)}
              </div>
            )
          }
        }
      }
    }
    return nodes
  }

  const nodes = renderBlockTokens(blockTokens, 'marked-root')
  if (footnotes.size > 0) {
    nodes.push(
      <div key="footnotes-section" className="mt-8 pt-4 border-t border-gray-300 dark:border-gray-700">
        <h3 className="text-lg font-semibold mb-4">Footnotes</h3>
        <ol className="list-decimal list-inside space-y-2">
          {Array.from(footnotes.entries()).map(([id, text]) => (
            <li key={`footnote-${id}`} id={`footnote-${id}`} className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-semibold">[{id}]:</span>{' '}
              <span>{parseInlineMarkdown(text, `footnote-${id}`, footnotes, emojiInfos, navigateToHashtag, emojiLightbox)}</span>{' '}
              <a
                href={`#footnote-ref-${id}`}
                className={cn('text-xs', URI_LINK_CLASS)}
                onClick={(e) => {
                  e.preventDefault()
                  const refElement = document.getElementById(`footnote-ref-${id}`)
                  if (refElement) {
                    refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                }}
              >
                ↩
              </a>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  return { nodes, hashtagsInContent, footnotes, citations }
}

/**
 * Parse inline markdown formatting (bold, italic, strikethrough, inline code, footnote references)
 * Returns an array of React nodes
 * 
 * Supports:
 * - Bold: **text** or __text__ (double) or *text* (single asterisk)
 * - Italic: _text_ (single underscore) or __text__ (double underscore, but bold takes priority)
 * - Strikethrough: ~~text~~ (double tilde) or ~text~ (single tilde)
 * - Inline code: ``code`` (double backtick) or `code` (single backtick)
 * - Footnote references: [^1] (handled at block level, but parsed here for inline context)
 */
function parseInlineMarkdown(
  text: string,
  keyPrefix: string,
  _footnotes: Map<string, string> = new Map(),
  emojiInfos: TEmoji[] = [],
  navigateToHashtag?: (href: string) => void,
  emojiLightbox?: TInlineEmojiLightbox
): React.ReactNode[] {
  const normalized = text.replace(/\n/g, ' ').replace(/[ \t]{2,}/g, ' ')
  const tokens = lexInlineProtected(normalized) as any[]
  const hasMarkdownSyntax = tokens.some((token) => token.type !== 'text' && token.type !== 'escape')

  // Fast path: keep old behavior when there is no markdown syntax.
  if (!hasMarkdownSyntax) {
    return parseInlineMarkdownLegacy(normalized, keyPrefix, _footnotes, emojiInfos, navigateToHashtag, emojiLightbox)
  }

  const renderTokens = (list: any[], path: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    for (let i = 0; i < list.length; i++) {
      const token = list[i]
      const tokenKey = `${path}-${i}`

      if (token.type === 'text' || token.type === 'escape') {
        out.push(
          ...parseInlineMarkdownLegacy(
            String(token.text ?? token.raw ?? ''),
            `${keyPrefix}-${tokenKey}-text`,
            _footnotes,
            emojiInfos,
            navigateToHashtag,
            emojiLightbox
          )
        )
        continue
      }

      if (token.type === 'strong') {
        out.push(
          <strong key={`${tokenKey}-strong`}>
            {renderTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${tokenKey}-strong`)}
          </strong>
        )
        continue
      }

      if (token.type === 'em') {
        out.push(
          <em key={`${tokenKey}-em`}>
            {renderTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${tokenKey}-em`)}
          </em>
        )
        continue
      }

      if (token.type === 'del') {
        out.push(
          <del key={`${tokenKey}-del`} className="line-through">
            {renderTokens(token.tokens ?? [{ type: 'text', text: token.text ?? '' }], `${tokenKey}-del`)}
          </del>
        )
        continue
      }

      if (token.type === 'codespan') {
        out.push(
          <InlineCode
            key={`${tokenKey}-code`}
            keyPrefix={`${keyPrefix}-${tokenKey}-code`}
            code={String(token.text ?? '')}
          />
        )
        continue
      }

      if (token.type === 'link') {
        const href = String(token.href ?? '')
        const children = stripNestedAnchorsFromNodes(
          renderTokens(token.tokens ?? [{ type: 'text', text: token.text ?? href }], `${tokenKey}-link`),
          `${tokenKey}-link-sanitized`
        )
        if (href.startsWith('payto://')) {
          out.push(
            <PaytoLink
              key={`${tokenKey}-payto-link`}
              paytoUri={href}
              className={URI_LINK_CLASS}
            >
              {children}
            </PaytoLink>
          )
        } else {
          out.push(
            <a
              key={`${tokenKey}-link`}
              href={href}
              className={URI_LINK_CLASS}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          )
        }
        continue
      }

      if (token.type === 'br') {
        out.push(<br key={`${tokenKey}-br`} />)
        continue
      }

      // Unknown/HTML token: treat as text to avoid unsafe HTML injection.
      out.push(
        ...parseInlineMarkdownLegacy(
          String(token.raw ?? token.text ?? ''),
          `${keyPrefix}-${tokenKey}-fallback`,
          _footnotes,
          emojiInfos,
          navigateToHashtag,
          emojiLightbox
        )
      )
    }
    return out
  }

  const rendered = renderTokens(tokens, `${keyPrefix}-md`)
  return rendered.length > 0
    ? rendered
    : parseInlineMarkdownLegacy(normalized, keyPrefix, _footnotes, emojiInfos, navigateToHashtag, emojiLightbox)
}

function parseInlineMarkdownLegacy(
  text: string,
  keyPrefix: string,
  _footnotes: Map<string, string> = new Map(),
  emojiInfos: TEmoji[] = [],
  navigateToHashtag?: (href: string) => void,
  emojiLightbox?: TInlineEmojiLightbox
): React.ReactNode[] {
  if (isContentSpacingDebug() && text.includes('nostr:')) {
    // eslint-disable-next-line no-console
    console.log('[imwald content-spacing] parseInlineMarkdown:before-normalize', {
      keyPrefix,
      repr: reprString(text)
    })
  }
  // Normalize newlines to spaces at the start (defensive - text should already be normalized, but ensure it)
  // This prevents any hard breaks within inline content
  text = text.replace(/\n/g, ' ')
  // Collapse multiple consecutive spaces/tabs (2+) into a single space, but preserve single spaces
  text = text.replace(/[ \t]{2,}/g, ' ')
  if (isContentSpacingDebug() && text.includes('nostr:')) {
    // eslint-disable-next-line no-console
    console.log('[imwald content-spacing] parseInlineMarkdown:after-normalize', {
      keyPrefix,
      repr: reprString(text)
    })
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const inlinePatterns: Array<{ index: number; end: number; type: string; data: any }> = []

  collectMathInlinePatterns(text).forEach((pattern) => {
    inlinePatterns.push(pattern)
  })
  
  // Legacy helper is intentionally narrowed to non-standard enrichments.
  // Standard markdown emphasis/code is handled by marked in parseInlineMarkdown().
  // Markdown links are still recognized here for plain-text/fallback inline fragments.
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  const markdownLinkMatches = Array.from(text.matchAll(markdownLinkRegex))
  markdownLinkMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in code, bold, italic, or strikethrough
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'code' || p.type === 'bold' || p.type === 'italic' || p.type === 'strikethrough' || p.type === 'math-inline' || p.type === 'math-block') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'link',
          data: { text: match[1], url: match[2] }
        })
      }
    }
  })

  // Footnote references: [^id]
  // Only render as clickable refs when the referenced definition exists.
  const footnoteRefRegex = /\[\^([^\]]+)\]/g
  const footnoteRefMatches = Array.from(text.matchAll(footnoteRefRegex))
  footnoteRefMatches.forEach(match => {
    if (match.index !== undefined) {
      const footnoteId = match[1]
      if (!_footnotes.has(footnoteId)) return
      const isInOther = inlinePatterns.some(p =>
        (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'math-inline' || p.type === 'math-block') &&
        match.index! >= p.index &&
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'footnote-ref',
          data: footnoteId
        })
      }
    }
  })
  
  // Hashtags: #tag (process after code/bold/italic/links to avoid conflicts)
  const hashtagRegex = /#([a-zA-Z0-9_]+)/g
  const hashtagMatches = Array.from(text.matchAll(hashtagRegex))
  hashtagMatches.forEach(match => {
    if (match.index !== undefined) {
      // Skip if already in another inline custom pattern
      const isInOther = inlinePatterns.some(p => 
        (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'math-inline' || p.type === 'math-block') &&
        match.index! >= p.index && 
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'hashtag',
          data: match[1] // The tag without the #
        })
      }
    }
  })
  
  // Relay URLs: wss:// or ws:// (process after code/bold/italic/links/hashtags to avoid conflicts)
  const relayUrlMatches = Array.from(text.matchAll(WS_URL_REGEX))
  relayUrlMatches.forEach(match => {
    if (match.index !== undefined) {
      const url = match[0]
      // Only process if it's actually a websocket URL
      if (isWebsocketUrl(url)) {
        // Skip if already in another inline custom pattern
        const isInOther = inlinePatterns.some(p => 
          (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'math-inline' || p.type === 'math-block') &&
          match.index! >= p.index && 
          match.index! < p.end
        )
        if (!isInOther) {
          inlinePatterns.push({
            index: match.index,
            end: match.index + match[0].length,
            type: 'relay-url',
            data: url
          })
        }
      }
    }
  })
  
  // Nostr addresses: nostr:npub1..., nostr:note1..., etc. (process after code/bold/italic/links/hashtags/relay-urls to avoid conflicts)
  // Only process profile types (npub/nprofile) inline; event types (note/nevent/naddr) should remain block-level
  const nostrRegex = new RegExp(NOSTR_URI_INLINE_REGEX.source, NOSTR_URI_INLINE_REGEX.flags)
  const nostrMatches = Array.from(text.matchAll(nostrRegex))
  nostrMatches.forEach(match => {
    if (match.index !== undefined) {
      const bech32Id = match[1]
      // Only process profile types inline; event types should remain block-level
      const isProfileType = bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')
      
      if (isProfileType) {
        // Skip if already in another inline custom pattern
        const isInOther = inlinePatterns.some(p => 
          (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'math-inline' || p.type === 'math-block') &&
          match.index! >= p.index && 
          match.index! < p.end
        )
        if (!isInOther) {
          inlinePatterns.push({
            index: match.index,
            end: match.index + match[0].length,
            type: 'nostr',
            data: bech32Id
          })
        }
      }
    }
  })

  // payto: URIs (RFC-8905 / NIP-A3) – process after nostr so we don't match inside other patterns
  const paytoMatches = Array.from(text.matchAll(PAYTO_URI_REGEX))
  paytoMatches.forEach(match => {
    if (match.index !== undefined) {
      const fullMatch = match[0]
      const parsed = parsePaytoUri(fullMatch)
      if (!parsed) return
      const isInOther = inlinePatterns.some(p =>
        (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'math-inline' || p.type === 'math-block') &&
        match.index! >= p.index &&
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'payto',
          data: parsed
        })
      }
    }
  })

  // Emoji shortcodes :shortcode: or :short code: (custom and native)
  const emojiMatches = Array.from(text.matchAll(EMOJI_SHORT_CODE_REGEX))
  emojiMatches.forEach(match => {
    if (match.index !== undefined) {
      const isInOther = inlinePatterns.some(p =>
        (p.type === 'link' || p.type === 'hashtag' || p.type === 'relay-url' || p.type === 'nostr' || p.type === 'payto' || p.type === 'emoji' || p.type === 'math-inline' || p.type === 'math-block') &&
        match.index! >= p.index &&
        match.index! < p.end
      )
      if (!isInOther) {
        inlinePatterns.push({
          index: match.index,
          end: match.index + match[0].length,
          type: 'emoji',
          data: (match[1] ?? match[0].slice(1, -1)).trim()
        })
      }
    }
  })
  
  // Sort by index
  inlinePatterns.sort((a, b) => a.index - b.index)
  
  // Remove overlaps (keep first)
  const filtered: typeof inlinePatterns = []
  let lastEnd = 0
  inlinePatterns.forEach(pattern => {
    if (pattern.index >= lastEnd) {
      filtered.push(pattern)
      lastEnd = pattern.end
    }
  })
  
  // Build nodes
  filtered.forEach((pattern, i) => {
    let consumeEnd = pattern.end
    // Add text before pattern
    if (pattern.index > lastIndex) {
      let textBefore = text.slice(lastIndex, pattern.index)
      // Preserve spaces for proper spacing around inline elements
      // Text is already normalized (newlines to spaces, multiple spaces collapsed to one)
      // Even if textBefore is just whitespace, we need to preserve it for spacing
      if (textBefore.length > 0) {
        // If it's all whitespace, render as a space
        if (textBefore.trim().length === 0) {
          parts.push(<span key={`${keyPrefix}-space-${i}`}>{' '}</span>)
        } else {
          parts.push(<span key={`${keyPrefix}-inline-text-${i}`}>{textBefore}</span>)
        }
      }
    }
    
    // Render custom inline pattern
    if (pattern.type === 'link') {
      const { text, url } = pattern.data
      if (url.startsWith('payto://')) {
        parts.push(
          <PaytoLink key={`${keyPrefix}-payto-link-${i}`} paytoUri={url} className={URI_LINK_CLASS}>
            {parseInlineMarkdownLegacy(text, `${keyPrefix}-link-${i}`, _footnotes, emojiInfos, undefined, emojiLightbox)}
          </PaytoLink>
        )
      } else {
        const linkContent = parseInlineMarkdownLegacy(
          text,
          `${keyPrefix}-link-${i}`,
          _footnotes,
          emojiInfos,
          undefined,
          emojiLightbox
        )
        parts.push(
          <a
            key={`${keyPrefix}-link-${i}`}
            href={url}
            className={URI_LINK_CLASS}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkContent}
          </a>
        )
      }
    } else if (pattern.type === 'hashtag') {
      // Render hashtags as inline links (green to match theme)
      const tag = pattern.data
      const tagLower = tag.toLowerCase()
      parts.push(
        <a
          key={`${keyPrefix}-hashtag-${i}`}
          href={`/notes?t=${tagLower}`}
          className={URI_LINK_CLASS}
          onClick={(e) => {
            if (!navigateToHashtag) return
            e.stopPropagation()
            e.preventDefault()
            navigateToHashtag(`/notes?t=${tagLower}`)
          }}
        >
          #{tag}
        </a>
      )
    } else if (pattern.type === 'footnote-ref') {
      const footnoteId = pattern.data
      parts.push(
        <sup key={`${keyPrefix}-footnote-${i}`} className="footnote-ref">
          <a
            href={`#footnote-${footnoteId}`}
            id={`footnote-ref-${footnoteId}`}
            className={cn('text-xs', URI_LINK_CLASS)}
            onClick={(e) => {
              e.preventDefault()
              const footnoteElement = document.getElementById(`footnote-${footnoteId}`)
              if (footnoteElement) {
                footnoteElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            }}
          >
            [{footnoteId}]
          </a>
        </sup>
      )
    } else if (pattern.type === 'relay-url') {
      // Render relay URLs as inline links (green to match theme)
      const url = pattern.data
      const relayPath = `/relays/${encodeURIComponent(url)}`
      // Note: We can't use navigateToRelay here since this is a pure function
      // The link will navigate normally, or we could make this a callback
      parts.push(
        <a
          key={`${keyPrefix}-relay-${i}`}
          href={relayPath}
          className={URI_LINK_CLASS}
        >
          {url}
        </a>
      )
    } else if (pattern.type === 'nostr') {
      // Render nostr addresses - only profile types (npub/nprofile) should be here (event types remain block-level)
      const bech32Id = pattern.data
      if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
        // Render as inline mention
        parts.push(
          <span key={`${keyPrefix}-nostr-${i}`} className="inline-block">
            <EmbeddedMention userId={bech32Id} />
          </span>
        )
      } else {
        // Fallback for unexpected types (shouldn't happen, but handle gracefully)
        parts.push(<span key={`${keyPrefix}-nostr-${i}`}>nostr:{bech32Id}</span>)
      }
    } else if (pattern.type === 'payto') {
      const payto = pattern.data as { type: string; authority: string; raw: string }
      parts.push(
        <PaytoLink
          key={`${keyPrefix}-payto-${i}`}
          paytoUri={payto.raw}
          className={URI_LINK_CLASS}
        />
      )
    } else if (pattern.type === 'emoji') {
      const shortcode = pattern.data as string
      const custom = emojiInfos.find((e) => e.shortcode === shortcode)
      if (custom) {
        const cleanedUrl = cleanUrl(custom.url)
        const lbIdx =
          cleanedUrl && emojiLightbox ? emojiLightbox.imageIndexMap.get(cleanedUrl) : undefined
        parts.push(
          <Emoji
            key={`${keyPrefix}-emoji-${i}`}
            emoji={custom}
            classNames={{ img: `${EMOJI_IMG_INLINE_CLASS} inline-block` }}
            onImageClick={
              typeof lbIdx === 'number' && emojiLightbox
                ? () => emojiLightbox.openLightbox(lbIdx)
                : undefined
            }
          />
        )
      } else {
        const native = shortcodeToEmoji(shortcode, emojis) ?? shortcodeToEmoji(shortcode.replace(/\s+/g, '_'), emojis)
        if (native?.emoji) {
          parts.push(
            <Emoji key={`${keyPrefix}-emoji-${i}`} emoji={native.emoji} classNames={{ img: EMOJI_IMG_INLINE_CLASS }} />
          )
        } else {
          parts.push(<span key={`${keyPrefix}-emoji-${i}`}>{`:${shortcode}:`}</span>)
        }
      }
    } else if (pattern.type === 'math-inline' || pattern.type === 'math-block') {
      if (pattern.type === 'math-block') {
        const after = text.slice(pattern.end)
        const punctMatch = after.match(/^\s*([.,;:!?])\s*$/)
        if (punctMatch) {
          consumeEnd = pattern.end + punctMatch[0].length
          parts.push(
            <span
              key={`${keyPrefix}-math-${i}-wrap`}
              className="my-2 flex w-full min-w-0 flex-nowrap items-end gap-x-1 overflow-x-auto"
            >
              <MathExpression
                key={`${keyPrefix}-math-${i}`}
                keyPrefix={`${keyPrefix}-math-${i}`}
                expression={String(pattern.data ?? '')}
                displayMode
                className="!my-0 block min-w-0 shrink overflow-x-auto"
              />
              <span className="shrink-0 self-end text-foreground">{punctMatch[1]}</span>
            </span>
          )
        } else {
          parts.push(
            <MathExpression
              key={`${keyPrefix}-math-${i}`}
              keyPrefix={`${keyPrefix}-math-${i}`}
              expression={String(pattern.data ?? '')}
              displayMode
            />
          )
        }
      } else {
        parts.push(
          <MathExpression
            key={`${keyPrefix}-math-${i}`}
            keyPrefix={`${keyPrefix}-math-${i}`}
            expression={String(pattern.data ?? '')}
            displayMode={false}
          />
        )
      }
    }
    
    lastIndex = consumeEnd
  })
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex)
    // Preserve spaces - text should already be normalized (newlines converted to spaces)
    if (remaining.length > 0) {
      // If it's all whitespace, render as a space
      if (remaining.trim().length === 0) {
        parts.push(<span key={`${keyPrefix}-space-final`}>{' '}</span>)
      } else {
        parts.push(<span key={`${keyPrefix}-inline-text-final`}>{remaining}</span>)
      }
    }
  }
  
  // If no patterns found, return the text as-is (already normalized at start of function)
  if (parts.length === 0) {
    const trimmedText = text.trim()
    return trimmedText ? [<span key={`${keyPrefix}-plain`}>{trimmedText}</span>] : []
  }
  
  return parts
}

/** URLs on their own line already get an inline WebPreview during body render — skip duplicate cards at bottom. */
function collectStandaloneWebPreviewUrlHints(content: string): Set<string> {
  const hints = new Set<string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const wholeLineMd = trimmed.match(/^\[([^\]]*)\]\(([^)]+)\)$/)
    if (wholeLineMd) {
      const cleaned = cleanUrl(wholeLineMd[2])
      if (cleaned) hints.add(cleaned)
      continue
    }
    for (const { url } of findHttpUrlsInText(trimmed)) {
      const cleaned = cleanUrl(url)
      if (!cleaned) continue
      const remainder = trimmed.replace(url, '').trim()
      if (remainder.length === 0 || /^[.,;:!?)]+$/.test(remainder)) {
        hints.add(cleaned)
      }
    }
  }
  return hints
}

export default function MarkdownArticle({
  event,
  className,
  hideMetadata = false,
  hideTitle = false,
  lazyMedia = true,
  parentImageUrl,
  fullCalendarInvite,
  duplicateWebPreviewCleanedUrlHints
}: {
  event: Event
  className?: string
  hideMetadata?: boolean
  /** Suppress title headings (e.g. when a parent renders the section title). */
  hideTitle?: boolean
  /**
   * When true (default), images in the note are held as blur/skeleton placeholders
   * until the user opens them in the lightbox. Set to false in full/detail views
   * so images load immediately.
   */
  lazyMedia?: boolean
  parentImageUrl?: string
  /** When viewing a kind-24 invite, render full calendar card with RSVP in place of the naddr embed */
  fullCalendarInvite?: { naddr: string; event: Event }
  /** e.g. RSS/article URL-thread root: suppress duplicate WebPreview for the same page already shown as OP */
  duplicateWebPreviewCleanedUrlHints?: string[]
}) {
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const { navigateToHashtag } = useSmartHashtagNavigationOptional()
  const { navigateToRelay } = useSmartRelayNavigationOptional()
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const emojiInfos = useEmojiInfosForEvent(event)
  const iArticleUrl = useMemo(() => getHttpUrlFromITags(event), [event])

  const webPreviewSuppressCleanedSet = useMemo(() => {
    const s = new Set<string>()
    const addHint = (raw: string) => {
      const t = raw.trim()
      if (!t) return
      const c = cleanUrl(t)
      if (c) s.add(c)
      else s.add(t)
      if (t.startsWith('http://') || t.startsWith('https://')) {
        const canon = canonicalizeRssArticleUrl(t)
        if (canon) s.add(canon)
      }
    }
    if (iArticleUrl) addHint(iArticleUrl)
    for (const h of duplicateWebPreviewCleanedUrlHints ?? []) addHint(h)
    return s
  }, [iArticleUrl, duplicateWebPreviewCleanedUrlHints])

  /** URL-thread OP already shows this link; hide the embedded i-tag card on kind 1111 / scoped replies */
  const suppressITagArticleWebPreview = useMemo(() => {
    if (!iArticleUrl || !duplicateWebPreviewCleanedUrlHints?.length) return false
    const canon = canonicalizeRssArticleUrl(iArticleUrl)
    return duplicateWebPreviewCleanedUrlHints.some(
      (h) => canonicalizeRssArticleUrl(h) === canon
    )
  }, [iArticleUrl, duplicateWebPreviewCleanedUrlHints])

  // Extract all media from event
  const extractedMedia = useMediaExtraction(event, event.content)
  
  // Extract media from tags only (for display at top)
  const tagMedia = useMemo(() => {
    const seenUrls = new Set<string>()
    const media: Array<{
      url: string
      type: 'image' | 'video' | 'audio'
      poster?: string
      blurHash?: string
      dim?: ImetaDim
      source: 'imeta' | 'r' | 'image'
    }> = []
    
    // Extract from imeta tags
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      const cleaned = cleanUrl(info.url)
      if (!cleaned || seenUrls.has(cleaned)) return
      const byMime = !!(info.m && /^(image|video|audio)\//i.test(info.m))
      if (
        !isImage(cleaned) &&
        !isMedia(cleaned) &&
        !isHlsPlaylistUrl(cleaned) &&
        !isBlossomBudBlobUrl(cleaned) &&
        !byMime
      )
        return

      seenUrls.add(cleaned)
      if (
        info.m?.startsWith('video/') ||
        isVideo(cleaned) ||
        isHlsPlaylistUrl(cleaned) ||
        /mpegurl/i.test(info.m || '')
      ) {
        media.push({
          url: info.url,
          type: 'video',
          poster: info.image || info.thumb,
          blurHash: info.blurHash,
          dim: info.dim,
          source: 'imeta'
        })
      } else if (info.m?.startsWith('audio/') || isAudio(cleaned)) {
        media.push({
          url: info.url,
          type: 'audio',
          poster: info.thumb,
          blurHash: info.blurHash,
          dim: info.dim,
          source: 'imeta'
        })
      } else if (info.m?.startsWith('image/') || isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
        media.push({ url: info.url, type: 'image', source: 'imeta' })
      }
    })
    
    // Extract from r tags
    event.tags.filter(tag => tag[0] === 'r' && tag[1]).forEach(tag => {
      const url = tag[1]
      const cleaned = cleanUrl(url)
      if (!cleaned || seenUrls.has(cleaned)) return
      if (!isImage(cleaned) && !isMedia(cleaned) && !isHlsPlaylistUrl(cleaned) && !isBlossomBudBlobUrl(cleaned)) return

      seenUrls.add(cleaned)
      if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
        media.push({ url, type: 'image', source: 'r' })
      } else if (isVideo(cleaned) || isHlsPlaylistUrl(cleaned)) {
        media.push({ url, type: 'video', source: 'r' })
      } else if (isAudio(cleaned)) {
        media.push({ url, type: 'audio', source: 'r' })
      }
    })
    
    // Extract from image tag
    const imageTag = event.tags.find(tag => tag[0] === 'image' && tag[1])
    if (imageTag?.[1]) {
      const cleaned = cleanUrl(imageTag[1])
      if (cleaned && !seenUrls.has(cleaned) && (isImage(cleaned) || isBlossomBudBlobUrl(cleaned))) {
        seenUrls.add(cleaned)
        media.push({ url: imageTag[1], type: 'image', source: 'image' })
      }
    }
    
    return media
  }, [event.id, JSON.stringify(event.tags)])
  
  // Extract YouTube URLs from tags (for display at top)
  const tagYouTubeUrls = useMemo(() => {
    const youtubeUrls: string[] = []
    const seenUrls = new Set<string>()
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isYouTubeUrl(url)) return
        
        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          youtubeUrls.push(cleaned)
          seenUrls.add(cleaned)
        }
      })
    
    return youtubeUrls
  }, [event.id, JSON.stringify(event.tags)])

  const tagSpotifyUrls = useMemo(() => {
    const spotifyUrls: string[] = []
    const seenUrls = new Set<string>()

    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isSpotifyUrl(url)) return

        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          spotifyUrls.push(cleaned)
          seenUrls.add(cleaned)
        }
      })

    return spotifyUrls
  }, [event.id, JSON.stringify(event.tags)])

  const tagWavlakeUrls = useMemo(() => {
    const wavlakeUrls: string[] = []
    const seenUrls = new Set<string>()

    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isWavlakeUrl(url)) return

        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          wavlakeUrls.push(cleaned)
          seenUrls.add(cleaned)
        }
      })

    return wavlakeUrls
  }, [event.id, JSON.stringify(event.tags)])

  const tagFountainUrls = useMemo(() => {
    const fountainUrls: string[] = []
    const seenUrls = new Set<string>()

    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isFountainUrl(url)) return

        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          fountainUrls.push(cleaned)
          seenUrls.add(cleaned)
        }
      })

    return fountainUrls
  }, [event.id, JSON.stringify(event.tags)])

  const tagZapStreamUrls = useMemo(() => {
    const zapUrls: string[] = []
    const seenUrls = new Set<string>()

    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (!isZapStreamWatchUrl(url)) return
        const c = canonicalZapStreamWatchUrl(cleanUrl(url) || url)
        if (c && !seenUrls.has(c)) {
          seenUrls.add(c)
          zapUrls.push(c)
        }
      })

    return zapUrls
  }, [event.id, JSON.stringify(event.tags)])
  
  // Extract non-media links from tags (excluding YouTube URLs)
  const tagLinks = useMemo(() => {
    const links: string[] = []
    const seenUrls = new Set<string>()
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (!url.startsWith('http://') && !url.startsWith('https://')) return
        if (isPseudoNostrHttpsUrl(url)) return
        if (isImage(url) || isMedia(url) || isHlsPlaylistUrl(url) || isBlossomBudBlobUrl(url)) return
        if (isYouTubeUrl(url)) return // Exclude YouTube URLs
        if (isSpotifyUrl(url)) return
        if (isWavlakeUrl(url)) return
        if (isFountainUrl(url)) return
        if (isZapStreamWatchUrl(url)) return

        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          links.push(cleaned)
          seenUrls.add(cleaned)
        }
      })

    return links
  }, [event.id, JSON.stringify(event.tags)])
  
  // Get all images for gallery (deduplicated)
  const allImages = useMemo(() => {
    const seenUrls = new Set<string>()
    const images: Array<Pick<TImetaInfo, 'url' | 'alt' | 'm' | 'image'>> = []
    
    // Add images from extractedMedia
    extractedMedia.images.forEach(img => {
      const cleaned = cleanUrl(img.url)
      if (cleaned && !seenUrls.has(cleaned)) {
        seenUrls.add(cleaned)
        images.push({ url: img.url, alt: img.alt, m: img.m, image: img.image })
      }
    })
    
    // Add metadata image if it exists
    if (metadata.image) {
      const cleaned = cleanUrl(metadata.image)
      if (cleaned && !seenUrls.has(cleaned) && (isImage(cleaned) || isBlossomBudBlobUrl(cleaned))) {
        seenUrls.add(cleaned)
        images.push({ url: metadata.image })
      }
    }
    
    const shortcodesInBody = new Set<string>()
    const scRe = new RegExp(EMOJI_SHORT_CODE_REGEX.source, 'g')
    let scMatch: RegExpExecArray | null
    while ((scMatch = scRe.exec(event.content)) !== null) {
      shortcodesInBody.add(scMatch[1].trim().toLowerCase())
    }

    for (const em of emojiInfos) {
      if (!shortcodesInBody.has(em.shortcode.trim().toLowerCase())) continue
      const raw = em.url?.trim()
      if (!raw) continue
      const cleaned = cleanUrl(raw)
      if (!cleaned || seenUrls.has(cleaned)) continue
      seenUrls.add(cleaned)
      images.push({ url: raw, alt: `:${em.shortcode}:` })
    }

    return images
  }, [extractedMedia.images, metadata.image, emojiInfos, event.content])

  const lightboxSlides = useMemo(
    () => allImages.map((img) => lightboxSlideFromImeta(img)),
    [allImages]
  )
  
  // Helper function to extract image filename/hash from URL for comparison
  // This helps identify the same image hosted on different domains
  const getImageIdentifier = useMemo(() => {
    return (url: string): string | null => {
      try {
        const cleaned = cleanUrl(url)
        if (!cleaned) return null
        const parsed = new URL(cleaned)
        const pathname = parsed.pathname
        // Extract the filename (last segment of the path)
        const filename = pathname.split('/').pop() || ''
        if (filename && /^[a-f0-9]{64}$/i.test(filename)) {
          return `blossom-sha256:${filename.toLowerCase()}`
        }
        // If the filename looks like a hash (hex string), use it for comparison
        // Also use the full pathname as a fallback
        if (filename && /^[a-f0-9]{32,}\.(png|jpg|jpeg|gif|webp|svg)$/i.test(filename)) {
          return filename.toLowerCase()
        }
        // Fallback to cleaned URL for non-hash filenames
        return cleaned
      } catch {
        return cleanUrl(url) || null
      }
    }
  }, [])
  
  // Create image index map for lightbox
  // Maps image URLs (and identifiers) to their index in allImages
  const imageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    allImages.forEach((img, index) => {
      const cleaned = cleanUrl(img.url)
      if (cleaned) {
        map.set(cleaned, index)
        // Also map by identifier for cross-domain matching
        const identifier = getImageIdentifier(cleaned)
        if (identifier && identifier !== cleaned) {
          // Only add identifier mapping if it's different from the cleaned URL
          // This helps match images across different domains
          if (!map.has(`__img_id:${identifier}`)) {
            map.set(`__img_id:${identifier}`, index)
          }
        }
      }
    })
    return map
  }, [allImages, getImageIdentifier])

  // Parse content to find media URLs that are already rendered
  // Store both cleaned URLs and image identifiers for comparison
  const mediaUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    const imageIdentifiers = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (cleaned && (isImage(cleaned) || isVideo(cleaned) || isAudio(cleaned) || isHlsPlaylistUrl(cleaned) || isBlossomBudBlobUrl(cleaned))) {
        urls.add(cleaned)
        // Also add image identifier for filename-based matching
        const identifier = getImageIdentifier(cleaned)
        if (identifier) {
          imageIdentifiers.add(identifier)
        }
      }
    }
    // Store identifiers in the Set as well (using a prefix to distinguish)
    imageIdentifiers.forEach(id => urls.add(`__img_id:${id}`))
    return urls
  }, [event.content, getImageIdentifier])
  
  // Extract YouTube URLs from content
  const youtubeUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (cleaned && isYouTubeUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])

  const spotifyUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (cleaned && isSpotifyUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])

  const wavlakeUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (cleaned && isWavlakeUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])

  const fountainUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (cleaned && isFountainUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])

  const zapstreamUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      const cleaned = cleanUrl(url)
      if (!cleaned) continue
      const c = canonicalZapStreamWatchUrl(cleaned)
      if (c) urls.add(c)
    }
    return urls
  }, [event.content])

  // Extract non-media links from content (excluding YouTube URLs)
  const contentLinks = useMemo(() => {
    const links: string[] = []
    const seenUrls = new Set<string>()
    for (const { url } of findHttpUrlsInText(event.content)) {
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        !isPseudoNostrHttpsUrl(url) &&
        !isImage(url) &&
        !isMedia(url) &&
        !isHlsPlaylistUrl(url) &&
        !isYouTubeUrl(url) &&
        !isSpotifyUrl(url) &&
        !isWavlakeUrl(url) &&
        !isFountainUrl(url) &&
        !isZapStreamWatchUrl(url)
      ) {
        const cleaned = cleanUrl(url)
        if (cleaned && !seenUrls.has(cleaned)) {
          links.push(cleaned)
          seenUrls.add(cleaned)
        }
      }
    }
    return links
  }, [event.content])

  const iArticleCleaned = useMemo(
    () => (iArticleUrl ? cleanUrl(iArticleUrl) : null),
    [iArticleUrl]
  )

  /** Inline prose links get WebPreview cards at the bottom (standalone line URLs already render inline). */
  const bottomContentLinks = useMemo(() => {
    const standaloneHints = collectStandaloneWebPreviewUrlHints(event.content)
    return contentLinks.filter((url) => {
      const cleaned = cleanUrl(url)
      if (!cleaned) return false
      if (standaloneHints.has(cleaned)) return false
      if (webPreviewSuppressCleanedSet.has(cleaned)) return false
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        webPreviewSuppressCleanedSet.has(canonicalizeRssArticleUrl(url))
      ) {
        return false
      }
      if (iArticleCleaned && cleaned === iArticleCleaned && !suppressITagArticleWebPreview) return false
      return true
    })
  }, [
    contentLinks,
    event.content,
    webPreviewSuppressCleanedSet,
    iArticleCleaned,
    suppressITagArticleWebPreview
  ])
  
  // Image gallery state — portal mounts only while active so feed re-renders don't run N closed Lightboxes on body.
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [lightboxPortalActive, setLightboxPortalActive] = useState(false)

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
    setLightboxOpen(true)
    setLightboxPortalActive(true)
  }, [])

  useLayoutEffect(() => {
    setLightboxOpen(false)
    setLightboxPortalActive(false)
  }, [lazyMedia])

  const hideOrphanedImetaInAccordion = shouldHideOrphanedImetaInAccordion(event.kind, event.content)
  const suppressedImetaUrls = useMemo(
    () => suppressImetaUrlSet(event, event.content, hideOrphanedImetaInAccordion),
    [event, hideOrphanedImetaInAccordion]
  )
  
  // Filter tag media to only show what's not in content
  const leftoverTagMedia = useMemo(() => {
    const metadataImageUrl = metadata.image ? cleanUrl(metadata.image) : null
    const parentImageUrlCleaned = parentImageUrl ? cleanUrl(parentImageUrl) : null
    return tagMedia.filter(media => {
      const cleaned = cleanUrl(media.url)
      if (!cleaned) return false
      
      // Check if already in content by cleaned URL
      if (mediaUrlsInContent.has(cleaned)) return false
      
      // Also check by image identifier (filename/hash) for same image on different domains
      const identifier = getImageIdentifier(cleaned)
      if (identifier && mediaUrlsInContent.has(`__img_id:${identifier}`)) return false
      
      // Skip if this is the metadata image (shown separately)
      if (metadataImageUrl && cleaned === metadataImageUrl && !hideMetadata) return false
      
      // Skip if this matches the parent publication's image (to avoid duplicate cover images)
      if (parentImageUrlCleaned && cleaned === parentImageUrlCleaned) return false
      if (media.source === 'imeta' && suppressedImetaUrls.has(cleaned)) return false
      return true
    })
  }, [tagMedia, mediaUrlsInContent, metadata.image, hideMetadata, parentImageUrl, suppressedImetaUrls])

  const suppressedImetaMedia = useMemo(
    () => getSuppressedImetaMedia(event, event.content),
    [event, hideOrphanedImetaInAccordion]
  )
  const inlineLeftoverTagMedia = leftoverTagMedia
  
  // Filter tag YouTube URLs to only show what's not in content
  const leftoverTagYouTubeUrls = useMemo(() => {
    return tagYouTubeUrls.filter(url => {
      const cleaned = cleanUrl(url)
      return cleaned && !youtubeUrlsInContent.has(cleaned)
    })
  }, [tagYouTubeUrls, youtubeUrlsInContent])

  const leftoverTagSpotifyUrls = useMemo(() => {
    return tagSpotifyUrls.filter((url) => {
      const cleaned = cleanUrl(url)
      return cleaned && !spotifyUrlsInContent.has(cleaned)
    })
  }, [tagSpotifyUrls, spotifyUrlsInContent])

  const leftoverTagWavlakeUrls = useMemo(() => {
    return tagWavlakeUrls.filter((url) => {
      const cleaned = cleanUrl(url)
      return cleaned && !wavlakeUrlsInContent.has(cleaned)
    })
  }, [tagWavlakeUrls, wavlakeUrlsInContent])

  const leftoverTagFountainUrls = useMemo(() => {
    return tagFountainUrls.filter((url) => {
      const cleaned = cleanUrl(url)
      return cleaned && !fountainUrlsInContent.has(cleaned)
    })
  }, [tagFountainUrls, fountainUrlsInContent])

  const leftoverTagZapStreamUrls = useMemo(() => {
    return tagZapStreamUrls.filter((canon) => !zapstreamUrlsInContent.has(canon))
  }, [tagZapStreamUrls, zapstreamUrlsInContent])
  
  // Filter tag links to only show what's not in content (to avoid duplicate WebPreview cards)
  const leftoverTagLinks = useMemo(() => {
    const contentLinksSet = new Set(contentLinks.map((link) => cleanUrl(link)).filter(Boolean))
    return tagLinks.filter((link) => {
      const cleaned = cleanUrl(link)
      if (!cleaned) return false
      if (webPreviewSuppressCleanedSet.has(cleaned)) return false
      if (
        (link.startsWith('http://') || link.startsWith('https://')) &&
        webPreviewSuppressCleanedSet.has(canonicalizeRssArticleUrl(link))
      ) {
        return false
      }
      return !contentLinksSet.has(cleaned)
    })
  }, [tagLinks, contentLinks, webPreviewSuppressCleanedSet])
  
  // Preprocess content to convert URLs to markdown syntax
  const preprocessedContent = useMemo(() => {
    // First unescape JSON-encoded escape sequences
    let processed = stripTrailingStringifiedNostrEvent(unescapeJsonContent(event.content))
    // Keep multi-newline runs intact so Marked `space` tokens can reproduce intentional vertical gaps.
    // Normalize single newlines within bold/italic spans to spaces
    processed = normalizeInlineFormattingNewlines(processed)
    // Normalize Setext-style headers (H1 with ===, H2 with ---)
    processed = normalizeSetextHeaders(processed)
    // Normalize backticks (inline code and code blocks)
    processed = normalizeBackticks(processed)
    // Replace standard :shortcode: with Unicode (custom emojis stay as shortcode for tag / profile lookup)
    const customShortcodes = emojiInfos.map((e) => e.shortcode)
    processed = replaceStandardEmojiShortcodesInContent(processed, customShortcodes)
    // Then preprocess media links
    return preprocessMarkdownMediaLinks(processed)
  }, [event.content, emojiInfos])
  
  // Create video poster map from imeta tags
  const videoPosterMap = useMemo(() => {
    const map = new Map<string, string>()
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      const cleaned = cleanUrl(info.url)
      if (!cleaned) return
      const isHls = isHlsPlaylistUrl(cleaned) || /mpegurl/i.test(info.m || '')
      if (info.m?.startsWith('video/') || isVideo(info.url) || isHls) {
        const posterUrl = info.image || info.thumb
        // thumb is often wrongly set to the same video URL; only real image URLs work as <img poster>.
        if (posterUrl && isImage(posterUrl)) {
          map.set(cleaned, posterUrl)
        }
      }
    })

    const imetaImageCleaned = new Set<string>()
    imetaInfos.forEach((info) => {
      const c = cleanUrl(info.url)
      if (!c || isHlsPlaylistUrl(c)) return
      if (isImage(c) || info.m?.startsWith('image/')) {
        imetaImageCleaned.add(c)
      }
    })
    if (imetaImageCleaned.size === 1) {
      const solePoster = [...imetaImageCleaned][0]!
      const hlsOnNote = new Set<string>()
      for (const v of extractedMedia.videos) {
        const c = cleanUrl(v.url)
        if (c && isHlsPlaylistUrl(c)) hlsOnNote.add(c)
      }
      event.tags
        .filter((t) => t[0] === 'r' && t[1])
        .forEach((t) => {
          const c = cleanUrl(t[1]!)
          if (c && isHlsPlaylistUrl(c)) hlsOnNote.add(c)
        })
      for (const h of hlsOnNote) {
        if (h !== solePoster && !map.has(h)) {
          map.set(h, solePoster)
        }
      }
    }

    return map
  }, [event.id, JSON.stringify(event.tags), extractedMedia.videos])
  
  // Create thumbnail map from imeta tags (for images)
  // Maps original image URL to thumbnail URL
  const imageThumbnailMap = useMemo(() => {
    const map = new Map<string, string>()
    const imetaInfos = getImetaInfosFromEvent(event)
    imetaInfos.forEach((info) => {
      if (info.thumb && (info.m?.startsWith('image/') || isImage(info.url))) {
        const cleaned = cleanUrl(info.url)
        if (cleaned && info.thumb) {
          map.set(cleaned, info.thumb)
          // Also map by identifier for cross-domain matching
          const identifier = getImageIdentifier(cleaned)
          if (identifier) {
            map.set(`__img_id:${identifier}`, info.thumb)
          }
        }
      }
    })
    return map
  }, [event.id, JSON.stringify(event.tags), getImageIdentifier])
  
  // Maps cleaned media URL → blurhash (any imeta with blurHash / bh — images, video, audio)
  const imageBlurHashMap = useMemo(() => {
    const map = new Map<string, string>()
    getImetaInfosFromEvent(event).forEach((info) => {
      if (info.blurHash) {
        const cleaned = cleanUrl(info.url)
        if (cleaned) map.set(cleaned, info.blurHash)
      }
    })
    return map
  }, [event.id, JSON.stringify(event.tags)])

  const mediaDimMap = useMemo(() => {
    const map = buildImetaDimMap(getImetaInfosFromEvent(event))
    for (const info of extractedMedia.all) {
      const cleaned = cleanUrl(info.url)
      if (!cleaned || !info.dim?.width || !info.dim?.height || map.has(cleaned)) continue
      map.set(cleaned, info.dim)
    }
    return map
  }, [event.id, JSON.stringify(event.tags), extractedMedia.all])

  // Parse markdown content with post-processing for nostr: links and hashtags
  const { nodes: parsedContent, hashtagsInContent } = useMemo(() => {
    const resolveImetaForImageUrl = (cleaned: string): TImetaInfo | undefined => {
      for (const img of extractedMedia.images) {
        const ic = cleanUrl(img.url)
        if (!ic) continue
        if (ic === cleaned) return { ...img, url: cleaned }
        const idC = getImageIdentifier(cleaned)
        const idI = getImageIdentifier(ic)
        if (idC && idI && idC === idI) return { ...img, url: cleaned }
      }
      return undefined
    }

    const parseOptions = {
      eventPubkey: event.pubkey,
      imageIndexMap,
      openLightbox,
      navigateToHashtag,
      navigateToRelay,
      videoPosterMap,
      mediaBlurHashMap: imageBlurHashMap,
      mediaDimMap,
      imageThumbnailMap,
      getImageIdentifier,
      emojiInfos,
      fullCalendarInvite,
      containingEvent: event,
      webPreviewSourceEvent: event,
      lazyMedia,
      resolveImetaForImageUrl,
      suppressStandaloneWebPreviewCleanedUrls:
        webPreviewSuppressCleanedSet.size > 0 ? webPreviewSuppressCleanedSet : undefined
    }
    let result
    try {
      result = parseMarkdownContentMarked(preprocessedContent, parseOptions)
    } catch (error) {
      logger.error('Marked parser failed, falling back to legacy parser:', error)
      result = parseMarkdownContentLegacy(preprocessedContent, parseOptions)
    }
    // Return nodes and hashtags (footnotes are already included in nodes)
    return { nodes: result.nodes, hashtagsInContent: result.hashtagsInContent }
  }, [
    preprocessedContent,
    event,
    event.pubkey,
    imageIndexMap,
    openLightbox,
    navigateToHashtag,
    navigateToRelay,
    videoPosterMap,
    imageBlurHashMap,
    mediaDimMap,
    imageThumbnailMap,
    getImageIdentifier,
    emojiInfos,
    fullCalendarInvite,
    lazyMedia,
    webPreviewSuppressCleanedSet,
    extractedMedia.images
  ])
  
  // Filter metadata tags to only show what's not already in content
  const leftoverMetadataTags = useMemo(() => {
    return metadata.tags.filter(tag => !hashtagsInContent.has(tag.toLowerCase()))
  }, [metadata.tags, hashtagsInContent])
  
  return (
    <MediaAutoLoadEventProvider event={event}>
    <>
      <style>{`
        /* Padding (not margin) so separation does not collapse with the prior list's margin */
        .prose > div.break-words > ul + ul,
        .prose > div.break-words > ul + ol,
        .prose > div.break-words > ol + ul,
        .prose > div.break-words > ol + ol {
          padding-top: 0.75rem;
        }
        .prose ol[class*="list-decimal"] {
          list-style-type: decimal !important;
        }
        .prose ol[class*="list-decimal"] li {
          display: list-item !important;
          list-style-position: outside !important;
          line-height: 1.25 !important;
          margin-bottom: 0 !important;
        }
        .hljs {
          background: transparent !important;
          color: #1f2937 !important;
        }
        .dark .hljs {
          color: #f3f4f6 !important;
        }
        .hljs-keyword,
        .hljs-selector-tag,
        .hljs-literal,
        .hljs-title,
        .hljs-section,
        .hljs-doctag,
        .hljs-type,
        .hljs-name,
        .hljs-strong {
          color: #dc2626 !important;
          font-weight: bold !important;
        }
        .hljs-string,
        .hljs-title.class_,
        .hljs-attr,
        .hljs-symbol,
        .hljs-bullet,
        .hljs-addition,
        .hljs-code,
        .hljs-regexp,
        .hljs-selector-pseudo,
        .hljs-selector-attr,
        .hljs-selector-class,
        .hljs-selector-id {
          color: #0284c7 !important;
        }
        .hljs-comment,
        .hljs-quote {
          color: #6b7280 !important;
        }
        .hljs-number,
        .hljs-deletion {
          color: #0d9488 !important;
        }
        .dark .hljs-keyword,
        .dark .hljs-selector-tag,
        .dark .hljs-literal,
        .dark .hljs-title,
        .dark .hljs-section,
        .dark .hljs-doctag,
        .dark .hljs-type,
        .dark .hljs-name,
        .dark .hljs-strong {
          color: #f87171 !important;
        }
        .dark .hljs-string,
        .dark .hljs-title.class_,
        .dark .hljs-attr,
        .dark .hljs-symbol,
        .dark .hljs-bullet,
        .dark .hljs-addition,
        .dark .hljs-code,
        .dark .hljs-regexp,
        .dark .hljs-selector-pseudo,
        .dark .hljs-selector-attr,
        .dark .hljs-selector-class,
        .dark .hljs-selector-id {
          color: #38bdf8 !important;
        }
        .dark .hljs-comment,
        .dark .hljs-quote {
          color: #9ca3af !important;
        }
        .dark .hljs-number,
        .dark .hljs-deletion {
          color: #5eead4 !important;
        }
      `}</style>
      <div
        className={`prose prose-zinc max-w-none min-w-0 dark:prose-invert break-words overflow-wrap-anywhere ${className || ''}`}
      >
        {iArticleUrl && !suppressITagArticleWebPreview && (
          <div className="not-prose mb-4 max-w-full">
            <HttpUrlOpenGraphOrLink url={iArticleUrl} containingEvent={event} block className="w-full" />
          </div>
        )}
        {/* Metadata */}
                {!hideTitle && !hideMetadata && metadata.title && (
                  <h1 className="break-words">{metadata.title}</h1>
                )}
                {!hideMetadata && metadata.summary && (
                  <blockquote>
                    <p className="break-words">{metadata.summary}</p>
                  </blockquote>
                )}
                {!hideTitle &&
                  !hideMetadata &&
                  event.kind === kinds.LongFormArticle &&
                  !metadata.image?.trim() && (
                    <div className="not-prose my-4 flex max-w-[400px] justify-center rounded-lg bg-muted p-6">
                      <UserAvatar
                        userId={event.pubkey}
                        size="large"
                        deferRemoteAvatar={false}
                        className="!h-36 !w-36 rounded-xl"
                      />
                    </div>
                  )}
                {!hideTitle &&
                  hideMetadata &&
                  metadata.title &&
                  event.kind !== ExtendedKind.DISCUSSION &&
                  !isNip52CalendarCardKind(event.kind) && (
                  <h2 className="text-2xl font-bold mb-4 leading-tight break-words">{metadata.title}</h2>
                )}
                {!hideTitle &&
                  hideMetadata &&
                  metadata.title &&
                  event.kind === kinds.LongFormArticle &&
                  !metadata.image?.trim() &&
                  event.kind !== ExtendedKind.DISCUSSION &&
                  !isNip52CalendarCardKind(event.kind) && (
                    <div className="not-prose mb-4 flex max-w-[400px] justify-center rounded-lg bg-muted p-6">
                      <UserAvatar
                        userId={event.pubkey}
                        size="large"
                        deferRemoteAvatar={false}
                        className="!h-36 !w-36 rounded-xl"
                      />
                    </div>
                  )}
        
        {/* Metadata image */}
                {!hideMetadata && metadata.image && (() => {
        const cleanedMetadataImage = cleanUrl(metadata.image)
        const parentImageUrlCleaned = parentImageUrl ? cleanUrl(parentImageUrl) : null
          // Don't show if already in content (check by URL and by identifier)
          if (cleanedMetadataImage) {
            if (mediaUrlsInContent.has(cleanedMetadataImage)) return null
            const identifier = getImageIdentifier(cleanedMetadataImage)
            if (identifier && mediaUrlsInContent.has(`__img_id:${identifier}`)) return null
          }
          
          // Don't show if it matches the parent publication's image (to avoid duplicate cover images)
          if (parentImageUrlCleaned && cleanedMetadataImage === parentImageUrlCleaned) return null
          
          const metadataImageIndex = imageIndexMap.get(cleanedMetadataImage)
        
        return (
          <Image
            image={{ url: metadata.image, pubkey: event.pubkey }}
            className="max-w-[400px] w-full h-auto my-0 cursor-zoom-in"
            classNames={{
              wrapper: 'rounded-lg',
              errorPlaceholder: 'aspect-square h-[30vh]'
            }}
            onClick={(e) => {
              e.stopPropagation()
                if (metadataImageIndex !== undefined) {
                  openLightbox(metadataImageIndex)
              }
            }}
          />
        )
      })()}
        
        {/* Media from tags (only if not in content) */}
        {inlineLeftoverTagMedia.length > 0 && (
          <div className="space-y-4 mb-6">
            {inlineLeftoverTagMedia.map((media) => {
              const cleaned = cleanUrl(media.url)
              const mediaIndex = imageIndexMap.get(cleaned)
              
              if (media.type === 'image') {
                return (
                  <div key={`tag-media-${cleaned}`} className="my-2 max-w-[400px]">
                    <Image
                      image={{ url: media.url, pubkey: event.pubkey, blurHash: imageBlurHashMap.get(cleaned) }}
                      className="w-full rounded-lg cursor-zoom-in"
                      classNames={{
                        wrapper: 'rounded-lg w-full',
                        errorPlaceholder: 'aspect-square h-[30vh]'
                      }}
                      holdUntilClick={lazyMedia}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (mediaIndex !== undefined) {
                          openLightbox(mediaIndex)
                        }
                      }}
                    />
                  </div>
                )
              } else if (media.type === 'video' || media.type === 'audio') {
                return (
                  <div key={`tag-media-${cleaned}`} className="my-2 w-full max-w-full overflow-hidden">
                    <MediaPlayer
                      src={media.url}
                      className="max-w-full sm:max-w-[400px] w-full"
                      mustLoad={!lazyMedia}
                      poster={media.poster ?? videoPosterMap?.get(cleaned)}
                      blurHash={media.blurHash}
                      dim={media.dim ?? mediaDimMap?.get(cleaned)}
                    />
                  </div>
                )
              }
              return null
            })}
        </div>
      )}
      
        {/* YouTube URLs from tags (only if not in content) */}
        {leftoverTagYouTubeUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagYouTubeUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-youtube-${cleaned}`} className="my-2">
                  <YoutubeEmbeddedPlayer
                    url={url}
                    className="max-w-[400px]"
                    mustLoad={!lazyMedia}
                  />
                </div>
              )
            })}
          </div>
        )}

        {leftoverTagSpotifyUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagSpotifyUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-spotify-${cleaned}`} className="my-2">
                  <SpotifyEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
            })}
          </div>
        )}

        {leftoverTagWavlakeUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagWavlakeUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-wavlake-${cleaned}`} className="my-2">
                  <WavlakeEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
            })}
          </div>
        )}

        {leftoverTagFountainUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagFountainUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-fountain-${cleaned}`} className="my-2">
                  <FountainEmbeddedPlayer url={url} className="max-w-[400px]" mustLoad={!lazyMedia} />
                </div>
              )
            })}
          </div>
        )}

        {leftoverTagZapStreamUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagZapStreamUrls.map((url) => (
              <div key={`tag-zapstream-${url}`} className="my-2">
                <ZapStreamLiveEventEmbed
                  url={url}
                  className="max-w-[400px]"
                  containingEvent={event}
                  showFull={!lazyMedia}
                />
              </div>
            ))}
          </div>
        )}
      
        {/* Parsed content */}
        <div className="break-words">
          {parsedContent}
        </div>

        {suppressedImetaMedia.length > 0 && (
          <OrphanedImetaMediaSection
            className="mt-4 mb-2"
            items={suppressedImetaMedia}
            authorPubkey={event.pubkey}
            mustLoadMedia={!lazyMedia}
            onImageClick={(url) => {
              const cleaned = cleanUrl(url)
              const mediaIndex = cleaned ? imageIndexMap.get(cleaned) : undefined
              if (mediaIndex !== undefined) {
                openLightbox(mediaIndex)
              }
            }}
          />
        )}
        
        {/* Hashtags from metadata (only if not already in content) */}
        {leftoverMetadataTags.length > 0 && (
        <div className="flex gap-2 flex-wrap pb-2 mt-4">
            {leftoverMetadataTags.map((tag) => (
              <div
                key={tag}
                title={tag}
                className="flex items-center rounded-full px-3 bg-muted text-muted-foreground max-w-44 cursor-pointer hover:bg-accent hover:text-accent-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  push(toNoteList({ hashtag: tag, kinds: [kinds.LongFormArticle] }))
                }}
              >
                #<span className="truncate">{tag}</span>
              </div>
            ))}
        </div>
      )}

        {/* WebPreview cards for inline links (standalone line URLs render inline above) */}
        {bottomContentLinks.length > 0 && (
          <div className="not-prose space-y-3 mt-6">
            {bottomContentLinks.map((url, index) => (
              <HttpUrlOpenGraphOrLink
                key={`content-${index}-${url}`}
                url={url}
                containingEvent={event}
                block
                className="w-full"
              />
            ))}
          </div>
        )}

        {leftoverTagLinks.length > 0 && (
          <div className="not-prose space-y-3 mt-6">
            {leftoverTagLinks.map((url, index) => (
            <HttpUrlOpenGraphOrLink
              key={`tag-${index}-${url}`}
              url={url}
              containingEvent={event}
              block
              className="w-full"
            />
          ))}
        </div>
      )}
      </div>
      
      {/* Image gallery lightbox — mount portal only when open; avoids N× Lightbox reconciling on body when policy/feed re-renders */}
      {allImages.length > 0 &&
        lightboxPortalActive &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-lightbox-overlay
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <Lightbox
              index={lightboxIndex}
              slides={lightboxSlides}
              plugins={[Video, Zoom]}
              open={lightboxOpen}
              close={() => setLightboxOpen(false)}
              on={{
                view: ({ index }) => setLightboxIndex(index),
                exited: () => setLightboxPortalActive(false)
              }}
              controller={{
                closeOnBackdropClick: false,
                closeOnPullUp: true,
                closeOnPullDown: true
              }}
              render={{
                buttonPrev: allImages.length <= 1 ? () => null : undefined,
                buttonNext: allImages.length <= 1 ? () => null : undefined
              }}
              styles={{
                toolbar: { paddingTop: '2.25rem' }
              }}
              carousel={{
                finite: false
              }}
            />
          </div>,
          document.body
        )}
    </>
    </MediaAutoLoadEventProvider>
  )
}
