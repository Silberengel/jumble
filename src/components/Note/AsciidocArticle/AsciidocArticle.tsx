import { useSecondaryPageOptional, useSmartHashtagNavigationOptional, useSmartRelayNavigationOptional } from '@/PageManager'
import OrphanedImetaMediaSection from '@/components/OrphanedImetaMedia/OrphanedImetaMediaSection'
import Image from '@/components/Image'
import MediaPlayer from '@/components/MediaPlayer'
import YoutubeEmbeddedPlayer from '@/components/YoutubeEmbeddedPlayer'
import { getLongFormArticleMetadataFromEvent } from '@/lib/event-metadata'
import { toNoteList } from '@/lib/link'
import { useMediaExtraction } from '@/hooks'
import {
  cleanUrl,
  isImage,
  isMedia,
  isVideo,
  isAudio,
  isWebsocketUrl,
  isBlossomBudBlobUrl
} from '@/lib/url'
import {
  collectMediaUrlKeysInText,
  getImageUrlIdentity,
  imageIdentitySetKey,
  isImageUrlPresentInText
} from '@/lib/image-url-identity'
import { getImetaInfosFromEvent } from '@/lib/event'
import { getSuppressedImetaMedia, shouldHideOrphanedImetaInAccordion, suppressImetaUrlSet } from '@/lib/imeta-content-match'
import type { ImetaDim } from '@/lib/imeta-display'
import { Event, kinds } from 'nostr-tools'
import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, Root } from 'react-dom/client'
import { lightboxSlideFromImeta } from '@/lib/lightbox-slides'
import Lightbox from 'yet-another-react-lightbox'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import { EmbeddedNote, EmbeddedMention } from '@/components/Embedded'
import EmbeddedCitation from '@/components/EmbeddedCitation'
import { parsePaytoUri } from '@/lib/payto'
import PaytoLink from '@/components/PaytoLink'
import { URI_LINK_CLASS, URI_LINK_INLINE_HTML_CLASS } from '@/lib/link-styles'
import EmbeddedNoteProviders from '@/components/Embedded/EmbeddedNoteProviders'
import { DeletedEventProvider } from '@/providers/DeletedEventProvider'
import { ReplyProvider } from '@/providers/ReplyProvider'
import Wikilink from '@/components/UniversalContent/Wikilink'
import { preprocessAsciidocMediaLinks } from '../MarkdownArticle/preprocessMarkup'
import {
  NOSTR_ASCIIDOC_EARLY_LINK_REGEX,
  NOSTR_ASCIIDOC_TEXT_NODE_REGEX,
  NOSTR_HTML_BECH32_RELAXED
} from '@/lib/content-patterns'
import { shouldLeaveDoubleBracketForAsciidoctor } from '@/lib/asciidoc-double-bracket-guard'
import { cn } from '@/lib/utils'
import logger from '@/lib/logger'
import {
  convertAsciiDocSource,
  plainAsciiDocSourceToHtml,
  resolveRelativeImagesInAsciidocHtml
} from '@/lib/asciidoc-parse'
import {
  looksLikeNativeAsciidoc,
  protectAsciiDocVerbatimRegions,
  restoreAsciiDocVerbatimRegions
} from '@/lib/asciidoc-verbatim-protect'
import { useTranslation } from 'react-i18next'
import katex from 'katex'
import '@/styles/katex-bundle.css'
import { isYouTubeUrl } from '@/lib/youtube-url'
import { WS_URL_REGEX, YOUTUBE_URL_REGEX } from '@/constants'

/**
 * Truncate link display text to 200 characters, adding ellipsis if truncated
 */
function truncateLinkText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) {
    return text
  }
  return text.substring(0, maxLength) + '...'
}

function inlineCodePlaceholder(index: number): string {
  return `@@JUMBLE_INLINE_CODE_${index}@@`
}

function codeBlockPlaceholder(index: number): string {
  return `@@JUMBLE_CODE_BLOCK_${index}@@`
}

/**
 * Convert markdown syntax to AsciiDoc syntax
 * This converts all markdown elements to their AsciiDoc equivalents before processing
 */
function convertMarkdownToAsciidoc(content: string): string {
  let asciidoc = content
  
  // Note: We don't remove front matter here because the user's content uses --- as horizontal rules
  // If there's actual YAML front matter, it should be handled separately
  // For now, we'll convert --- to horizontal rules (except table separators)
  
  // Convert nostr addresses directly to AsciiDoc link format
  // Do this early so they're protected from other markdown conversions
  // naddr addresses can be 200+ characters, so we use + instead of specific length
  // Also handle optional [] suffix (empty link text in AsciiDoc)
  // Note: Citations are already protected in passthrough (+++...+++), so nostr: links inside them won't be processed
  asciidoc = asciidoc.replace(NOSTR_ASCIIDOC_EARLY_LINK_REGEX, (_match, bech32Id, emptyBrackets) => {
    // Convert directly to AsciiDoc link format
    // This will be processed later in HTML post-processing to render as React components
    // If [] suffix is present, use empty link text, otherwise use the bech32Id
    const linkText = emptyBrackets ? '' : bech32Id
    return `link:nostr:${bech32Id}[${linkText}]`
  })
  
  // Protect code blocks - we'll process them separately
  const codeBlockPlaceholders: string[] = []
  asciidoc = asciidoc.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const placeholder = codeBlockPlaceholder(codeBlockPlaceholders.length)
    codeBlockPlaceholders.push(`[source${lang ? ',' + lang : ''}]\n----\n${code.trim()}\n----`)
    return placeholder
  })
  
  // Protect inline code - but handle LaTeX math separately
  const inlineCodePlaceholders: string[] = []
  
  // Handle LaTeX math in inline code blocks like `$...$`
  // The content may have escaped backslashes: `$\\frac{\\infty}{21,000,000} = \\infty$`
  // We need to detect LaTeX math and convert it to AsciiDoc stem: syntax
  asciidoc = asciidoc.replace(/`([^`\n]+)`/g, (_match, content) => {
    // Check if this is LaTeX math - pattern: $...$ where ... contains LaTeX syntax
    // Match the full pattern: $ followed by LaTeX expression and ending with $
    const latexMatch = content.match(/^\$([^$]+)\$$/)
    if (latexMatch) {
      // This is pure LaTeX math - convert to AsciiDoc stem syntax
      const latexExpr = latexMatch[1]
      // The latexExpr contains the LaTeX code (backslashes are already in the string)
      // AsciiDoc stem:[...] will process this with the stem processor
      return `stem:[${latexExpr}]`
    }
    
    // Check if content contains LaTeX math mixed with other text
    if (content.includes('$') && content.match(/\$[^$]+\$/)) {
      // Replace $...$ parts with stem:[...]
      const processed = content.replace(/\$([^$]+)\$/g, 'stem:[$1]')
      // If it's now just stem, return it directly, otherwise it needs to be in code
      if (processed.startsWith('stem:[') && processed.endsWith(']') && !processed.includes('`')) {
        return processed
      }
      // Mixed content - keep as code but with stem inside (won't work well, but preserve it)
      const placeholder = inlineCodePlaceholder(inlineCodePlaceholders.length)
      inlineCodePlaceholders.push(`\`${processed}\``)
      return placeholder
    }
    
    // Regular inline code - preserve it
    const placeholder = inlineCodePlaceholder(inlineCodePlaceholders.length)
    inlineCodePlaceholders.push(`\`${content}\``)
    return placeholder
  })
  
  // Convert headers (must be at start of line)
  asciidoc = asciidoc.replace(/^#{6}\s+(.+)$/gm, '====== $1 ======')
  asciidoc = asciidoc.replace(/^#{5}\s+(.+)$/gm, '===== $1 =====')
  asciidoc = asciidoc.replace(/^#{4}\s+(.+)$/gm, '==== $1 ====')
  asciidoc = asciidoc.replace(/^#{3}\s+(.+)$/gm, '=== $1 ===')
  asciidoc = asciidoc.replace(/^#{2}\s+(.+)$/gm, '== $1 ==')
  asciidoc = asciidoc.replace(/^#{1}\s+(.+)$/gm, '= $1 =')
  
  // Convert tables BEFORE horizontal rules (to avoid converting table separators)
  // Markdown tables: | col1 | col2 |\n|------|------|\n| data1 | data2 |
  // Use a simpler approach: match lines with pipes, separator row, and data rows
  asciidoc = asciidoc.replace(/(\|[^\n]+\|\s*\n\|[\s\-\|:]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/gm, (match) => {
    const lines = match.trim().split('\n').map(line => line.trim()).filter(line => line)
    if (lines.length < 2) return match
    
    // First line is header, second is separator, rest are data
    const headerRow = lines[0]
    const separatorRow = lines[1]
    
    // Verify it's a table separator (has dashes)
    if (!separatorRow.match(/[\-:]/)) return match
    
    // Parse header cells - markdown format: | col1 | col2 | col3 |
    // When split by |, we get: ['', ' col1 ', ' col2 ', ' col3 ', '']
    // We need to extract all non-empty cells
    const headerParts = headerRow.split('|')
    const headerCells: string[] = []
    for (let i = 0; i < headerParts.length; i++) {
      const cell = headerParts[i].trim()
      // Skip empty cells only at the very start and end
      if (cell === '' && (i === 0 || i === headerParts.length - 1)) continue
      headerCells.push(cell)
    }
    
    if (headerCells.length < 2) return match
    
    const colCount = headerCells.length
    const dataRows = lines.slice(2)
    
    // Build AsciiDoc table - use equal width columns
    let tableAsciidoc = `[cols="${Array(colCount).fill('*').join(',')}"]\n|===\n`
    
    // Header row - prefix each cell with . to make it a header cell in AsciiDoc
    // Ensure cells are properly formatted (no leading/trailing spaces, escape special chars)
    const headerRowCells = headerCells.map(cell => {
      // Clean up the cell content
      let cleanCell = cell.trim()
      // Escape pipe characters if any
      cleanCell = cleanCell.replace(/\|/g, '\\|')
      // Return with . prefix for header
      return `.${cleanCell}`
    })
    tableAsciidoc += headerRowCells.join('|') + '\n\n'
    
    // Data rows
    dataRows.forEach(row => {
      if (!row.includes('|')) return
      const rowParts = row.split('|')
      const rowCells: string[] = []
      
      // Parse data row cells the same way as header
      for (let i = 0; i < rowParts.length; i++) {
        const cell = rowParts[i].trim()
        // Skip empty cells only at the very start and end
        if (cell === '' && (i === 0 || i === rowParts.length - 1)) continue
        rowCells.push(cell)
      }
      
      // Ensure we have the right number of cells
      while (rowCells.length < colCount) {
        rowCells.push('')
      }
      
      // Take only the number of columns we need
      const finalCells = rowCells.slice(0, colCount)
      tableAsciidoc += finalCells.map(cell => cell.replace(/\|/g, '\\|')).join('|') + '\n'
    })
    
    tableAsciidoc += '|==='
    return tableAsciidoc
  })
  
  // Convert horizontal rules (but not table separators, which are already processed)
  // Convert standalone --- lines to AsciiDoc horizontal rule
  // We do this after table processing to avoid interfering with table separators
  asciidoc = asciidoc.replace(/^---\s*$/gm, (match, offset, string) => {
    // Check if this is part of a table separator (would have been processed already)
    const lines = string.split('\n')
    const lineIndex = string.substring(0, offset).split('\n').length - 1
    const prevLine = lines[lineIndex - 1]?.trim() || ''
    const nextLine = lines[lineIndex + 1]?.trim() || ''
    
    // If it looks like a table separator (has pipes nearby), don't convert
    if (prevLine.includes('|') || nextLine.includes('|')) {
      return match
    }
    
    // Convert to AsciiDoc horizontal rule (three single quotes)
    return '\'\'\''
  })
  
  // Convert blockquotes - handle multi-line blockquotes
  // Match consecutive lines starting with >
  asciidoc = asciidoc.replace(/(^>\s+.+(?:\n>\s+.+)*)/gm, (match) => {
    const lines = match.split('\n').map((line: string) => line.replace(/^>\s*/, ''))
    const content = lines.join('\n').trim()
    return `____\n${content}\n____`
  })
  
  // Convert lists (must be at start of line)
  // Unordered lists: *, -, +
  asciidoc = asciidoc.replace(/^(\s*)[\*\-\+]\s+(.+)$/gm, '$1* $2')
  // Ordered lists: 1., 2., etc.
  asciidoc = asciidoc.replace(/^(\s*)\d+\.\s+(.+)$/gm, '$1. $2')
  
  // Protect existing AsciiDoc links (both url[text] and link:url[text] formats)
  // Do this FIRST before any other processing to avoid double-processing
  const asciidocLinkPlaceholders: string[] = []
  // Match AsciiDoc link format: url[text] or link:url[text]
  // Pattern matches: http(s)://url[text] or link:url[text]
  // URL can contain dots, slashes, hyphens, etc., but stops at whitespace or [
  // Then we match [text] where text can contain anything except ]
  // Use a more permissive pattern - match URL until [ then match [text]
  // The URL part can contain most characters except whitespace and [
  asciidoc = asciidoc.replace(/(https?:\/\/[^\s\[\]]+\[[^\]]+\])/g, (_match, link) => {
    // This is an AsciiDoc link format (url[text]), protect it
    const placeholder = `__ASCIIDOC_LINK_${asciidocLinkPlaceholders.length}__`
    asciidocLinkPlaceholders.push(link)
    return placeholder
  })
  // Also protect link:url[text] format
  asciidoc = asciidoc.replace(/(link:[^\s\[\]]+\[[^\]]+\])/g, (_match, link) => {
    const placeholder = `__ASCIIDOC_LINK_${asciidocLinkPlaceholders.length}__`
    asciidocLinkPlaceholders.push(link)
    return placeholder
  })
  
  // Convert images: ![alt](url) -> image:url[alt] (single colon for inline, but AsciiDoc will render as block)
  // For block images in AsciiDoc, we can use image:: or just ensure it's on its own line
  asciidoc = asciidoc.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, url) => {
    // Escape brackets in alt text and URL if needed
    const escapedAlt = alt.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/"/g, '&quot;')
    // Use image:: for block-level images (double colon)
    // Add width attribute to make it responsive
    return `image::${url}[${escapedAlt},width=100%]`
  })
  
  // Convert links: [text](url) -> link:url[text]
  asciidoc = asciidoc.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Skip if it was an image (shouldn't happen after image conversion, but safety check)
    if (match.startsWith('![')) return match
    // Escape brackets in link text
    const escapedText = text.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
    return `link:${url}[${escapedText}]`
  })
  
  // Restore AsciiDoc links
  asciidocLinkPlaceholders.forEach((link, index) => {
    asciidoc = asciidoc.replace(`__ASCIIDOC_LINK_${index}__`, link)
  })
  
  // Nostr addresses are already converted to link: format above, no need to restore
  
  // Convert strikethrough: ~~text~~ -> [line-through]#text#
  // Also handle single tilde strikethrough: ~text~ -> [line-through]#text#
  asciidoc = asciidoc.replace(/~~([^~\n]+?)~~/g, '[line-through]#$1#')
  // Single tilde strikethrough (common in some markdown flavors)
  asciidoc = asciidoc.replace(/(?<!~)~([^~\n]+?)~(?!~)/g, '[line-through]#$1#')
  
  // Note: Subscript ~text~ is now handled as strikethrough above
  // If you need subscript, use a different syntax or handle it differently
  
  // Convert superscript: ^text^
  asciidoc = asciidoc.replace(/\^([^\^\n]+?)\^/g, '[superscript]#$1#')
  
  // Convert bold: **text** or __text__
  asciidoc = asciidoc.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
  asciidoc = asciidoc.replace(/__(?!_)([^_\n]+?)(?<!_)__/g, '*$1*')
  
  // Convert italic: *text* or _text_ (but not if already bold)
  // Process single asterisk for italic (but not if it's part of **bold**)
  asciidoc = asciidoc.replace(/(?<!\*)\*(?![\*\s])([^\*\n]+?)(?<!\*)\*(?!\*)/g, (match, text) => {
    // Skip if it looks like a list item
    if (/^\s*\*\s/.test(match)) return match
    // Skip if already processed as bold (shouldn't happen, but safety)
    if (match.includes('*$1*')) return match
    return `_${text}_`
  })
  // Process single underscore for italic
  asciidoc = asciidoc.replace(/(?<!_)_(?!_)([^_\n]+?)(?<!_)_(?!_)/g, (match, text) => {
    // Skip if already processed as bold
    if (match.includes('*$1*')) return match
    return `_${text}_`
  })
  
  // Restore inline code
  inlineCodePlaceholders.forEach((code, index) => {
    asciidoc = asciidoc.replace(inlineCodePlaceholder(index), code)
  })
  
  // Restore code blocks
  codeBlockPlaceholders.forEach((block, index) => {
    asciidoc = asciidoc.replace(codeBlockPlaceholder(index), block)
  })
  
  return asciidoc
}

export default function AsciidocArticle({
  event,
  className,
  hideImagesAndInfo = false,
  hideTitle = false,
  /** Inline embed: parsed body only (embedded publication sections). */
  contentOnly = false,
  parentImageUrl,
  footnotesContainerId
}: {
  event: Event
  className?: string
  hideImagesAndInfo?: boolean
  /** Suppress title headings (e.g. when a parent renders the section title). */
  hideTitle?: boolean
  contentOnly?: boolean
  parentImageUrl?: string
  footnotesContainerId?: string
}) {
  const effectiveHideTitle = hideTitle || contentOnly
  const effectiveHideImagesAndInfo = hideImagesAndInfo || contentOnly
  const showArticleChrome = !contentOnly
  const secondaryPage = useSecondaryPageOptional()
  const push = secondaryPage?.push ?? ((url: string) => { window.location.href = url })
  const { navigateToHashtag } = useSmartHashtagNavigationOptional()
  const { navigateToRelay } = useSmartRelayNavigationOptional()
  const navigateToHashtagRef = useRef(navigateToHashtag)
  navigateToHashtagRef.current = navigateToHashtag
  const navigateToRelayRef = useRef(navigateToRelay)
  navigateToRelayRef.current = navigateToRelay
  const { t } = useTranslation()
  const metadata = useMemo(() => getLongFormArticleMetadataFromEvent(event), [event])
  const contentRef = useRef<HTMLDivElement>(null)
  
  // Preprocess content: convert all markdown to AsciiDoc syntax
  const processedContent = useMemo(() => {
    let content = event.content
    
    // Normalize excessive newlines (reduce 3+ to 2)
    content = content.replace(/\n\s*\n\s*\n+/g, '\n\n')

    const nativeAsciidoc = looksLikeNativeAsciidoc(content)
    const { text: shielded, blocks: verbatimBlocks } = protectAsciiDocVerbatimRegions(content)
    let work = shielded
    
    // PROTECT WIKILINKS FIRST before any other processing
    // This prevents AsciiDoc or other processors from converting them to regular links
    
    // Protect citations by converting them to passthrough format
    // Don't use [[...]] inside passthrough as AsciiDoc processes it - use a plain marker instead
    work = work.replace(/\[\[citation::(end|foot|foot-end|inline|quote|prompt-end|prompt-inline)::([^\]]+)\]\]/g, (_match, citationType, citationId) => {
      // Strip all nostr: prefixes if present (handle cases like nostr:nostr:nevent1...)
      let cleanId = citationId.trim()
      while (cleanId.startsWith('nostr:')) {
        cleanId = cleanId.substring(6) // Remove 'nostr:' prefix
      }
      // Use a unique marker format that won't conflict with other content
      return `+++CITATION_MARKER:${citationType}::${cleanId}:CITATION_END+++`
    })
    
    // Then protect regular wikilinks by converting them to passthrough format
    // This prevents AsciiDoc from processing them and prevents URLs inside from being processed
    work = work.replace(/\[\[([^\]]+)\]\]/g, (match, linkContent, offset) => {
      // Skip citations - they're already processed above
      if (linkContent.startsWith('citation::')) {
        return match
      }
      if (shouldLeaveDoubleBracketForAsciidoctor(content, offset, match.length, linkContent)) {
        return match
      }
      // Convert to AsciiDoc passthrough format so it's preserved
      return `+++WIKILINK:${linkContent}+++`
    })
    
    // Convert markdown syntax to AsciiDoc only when the body is not already AsciiDoc
    if (!nativeAsciidoc) {
      work = convertMarkdownToAsciidoc(work)
    }
    
    // Now process raw URLs that aren't already in AsciiDoc syntax
    work = preprocessAsciidocMediaLinks(work)
    
    // Convert "Read naddr... instead." patterns to AsciiDoc links
    const redirectRegex = /Read (naddr1[a-z0-9]+) instead\./gi
    work = work.replace(redirectRegex, (_match, naddr) => {
      return `Read link:/notes/${naddr}[${naddr}] instead.`
    })

    return restoreAsciiDocVerbatimRegions(work, verbatimBlocks)
  }, [event.content])
  
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
      if (!isImage(cleaned) && !isMedia(cleaned) && !isBlossomBudBlobUrl(cleaned) && !byMime) return

      seenUrls.add(cleaned)
      if (info.m?.startsWith('video/') || isVideo(cleaned)) {
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
      if (!isImage(cleaned) && !isMedia(cleaned) && !isBlossomBudBlobUrl(cleaned)) return

      seenUrls.add(cleaned)
      if (isImage(cleaned) || isBlossomBudBlobUrl(cleaned)) {
        media.push({ url, type: 'image', source: 'r' })
      } else if (isVideo(cleaned)) {
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
  
  // Note: tagLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Get all images for gallery (deduplicated)
  const allImages = useMemo(() => {
    const seenUrls = new Set<string>()
    const images: Array<{ url: string; alt?: string; m?: string; image?: string }> = []
    
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
      if (cleaned && !seenUrls.has(cleaned) && isImage(cleaned)) {
        seenUrls.add(cleaned)
        images.push({ url: metadata.image })
      }
    }
    
    return images
  }, [extractedMedia.images, metadata.image])

  const lightboxSlides = useMemo(
    () => allImages.map((img) => lightboxSlideFromImeta(img)),
    [allImages]
  )
  
  // Create image index map for lightbox
  const imageIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    allImages.forEach((img, index) => {
      const cleaned = cleanUrl(img.url)
      if (cleaned) map.set(cleaned, index)
    })
    return map
  }, [allImages])
  
  // Parse content to find media URLs that are already rendered
  const mediaUrlsInContent = useMemo(() => {
    const urls = collectMediaUrlKeysInText(event.content)
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      const cleaned = cleanUrl(url)
      if (cleaned && (isVideo(cleaned) || isAudio(cleaned))) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])
  
  // Extract YouTube URLs from content
  const youtubeUrlsInContent = useMemo(() => {
    const urls = new Set<string>()
    const urlRegex = /https?:\/\/[^\s<>"']+/g
    let match
    while ((match = urlRegex.exec(event.content)) !== null) {
      const url = match[0]
      const cleaned = cleanUrl(url)
      if (cleaned && isYouTubeUrl(cleaned)) {
        urls.add(cleaned)
      }
    }
    return urls
  }, [event.content])
  
  // Note: contentLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Image gallery state — portal only while open (see MarkdownArticle lightbox comment).
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  const [lightboxPortalActive, setLightboxPortalActive] = useState(false)

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index)
    setLightboxPortalActive(true)
  }, [])
  
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
      // Skip if already in content
      if (mediaUrlsInContent.has(cleaned)) return false
      const identifier = getImageUrlIdentity(cleaned)
      if (identifier && mediaUrlsInContent.has(imageIdentitySetKey(identifier))) return false
      if (media.type === 'image' && isImageUrlPresentInText(event.content, media.url)) return false
      // Skip if this is the metadata image (shown separately)
      if (metadataImageUrl && cleaned === metadataImageUrl && !effectiveHideImagesAndInfo) return false
      // Skip if this matches the parent publication's image (to avoid duplicate cover images)
      if (parentImageUrlCleaned && cleaned === parentImageUrlCleaned) return false
      if (media.source === 'imeta' && suppressedImetaUrls.has(cleaned)) return false
      return true
    })
  }, [tagMedia, mediaUrlsInContent, metadata.image, effectiveHideImagesAndInfo, parentImageUrl, suppressedImetaUrls, event.content])

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
  
  // Note: leftoverTagLinks removed - WebPreview is disabled for AsciiDoc articles
  
  // Extract hashtags from content (for deduplication with metadata tags)
  const hashtagsInContent = useMemo(() => {
    const tags = new Set<string>()
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g
    let match
    while ((match = hashtagRegex.exec(event.content)) !== null) {
      tags.add(match[1].toLowerCase())
    }
    return tags
  }, [event.content])
  
  // Filter metadata tags to only show what's not already in content
  const leftoverMetadataTags = useMemo(() => {
    return metadata.tags.filter(tag => !hashtagsInContent.has(tag.toLowerCase()))
  }, [metadata.tags, hashtagsInContent])
  
  // Parse AsciiDoc content and post-process for nostr: links and hashtags
  const [parsedHtml, setParsedHtml] = useState<string>('')
  const [parseIssues, setParseIssues] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  useEffect(() => {
    let cancelled = false
    const fallbackImageUrls = allImages.map((img) => img.url)

    const parseAsciidoc = async () => {
      setIsLoading(true)
      setParseIssues([])
      let rawConvertedHtml = ''
      try {
        let conversion = await convertAsciiDocSource(processedContent)

        if (cancelled) return

        if (conversion.failed || !conversion.html.trim()) {
          const rawConversion = await convertAsciiDocSource(event.content)
          if (!rawConversion.failed && rawConversion.html.trim()) {
            conversion = rawConversion
          }
        }

        if (conversion.failed || !conversion.html.trim()) {
          setParseIssues(conversion.issues)
          setParsedHtml(
            plainAsciiDocSourceToHtml(event.content, { imageUrls: fallbackImageUrls })
          )
          return
        }

        rawConvertedHtml = conversion.html
        let htmlString = resolveRelativeImagesInAsciidocHtml(
          conversion.html,
          event.content,
          fallbackImageUrls
        )
        const collectedIssues = [...conversion.issues]
        
        // Debug: log HTML to check if passthrough markers are preserved
        if (process.env.NODE_ENV === 'development') {
          const hasWikilinkMarker = htmlString.includes('WIKILINK')
          logger.debug('AsciidocArticle: HTML contains markers', { 
            hasWikilinkMarker,
            htmlPreview: htmlString.substring(0, 2000)
          })
        }
        
        // Note: Markdown is now converted to AsciiDoc in preprocessing,
        // so post-processing markdown should not be necessary
        
        // IMPORTANT: Process citations FIRST before any nostr: link processing
        // This prevents nostr: links inside citations from being processed incorrectly
        // Handle citation markers - convert passthrough markers to placeholders
        // AsciiDoc passthrough +++CITATION_MARKER:type::id:CITATION_END+++ outputs CITATION_MARKER:type::id:CITATION_END in HTML
        htmlString = htmlString.replace(/CITATION_MARKER:\s*(end|foot|foot-end|inline|quote|prompt-end|prompt-inline)::\s*(.+?)\s*:CITATION_END/g, (_match, citationType, citationId) => {
          // Strip all nostr: prefixes if present (handle cases like nostr:nostr:nevent1...)
          let cleanId = citationId.trim()
          while (cleanId.startsWith('nostr:')) {
            cleanId = cleanId.substring(6) // Remove 'nostr:' prefix
          }
          const escapedId = cleanId.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          // Use inline element for inline citations and footnotes/endnotes (they need to be inline)
          // Only block-level citations (quote) should use div
          const isInline = citationType === 'inline' || citationType === 'prompt-inline' || citationType === 'foot' || citationType === 'foot-end' || citationType === 'end' || citationType === 'prompt-end'
          const tag = isInline ? 'span' : 'div'
          return `<${tag} data-citation="${escapedId}" data-citation-type="${citationType}" class="citation-placeholder${isInline ? ' inline' : ''}"></${tag}>`
        })
        
        // Post-process HTML to handle nostr: links
        // Mentions (npub/nprofile) should be inline, events (note/nevent/naddr) should be block-level
        // First, handle nostr: links in <a> tags (from AsciiDoc link: syntax)
        // Match the full bech32 address format - addresses can vary in length
        // npub: 58 chars, nprofile: variable, note: 58 chars, nevent: variable, naddr: 200+ chars
        // Use a more flexible pattern that matches any valid bech32 address
        htmlString = htmlString.replace(
          new RegExp(
            `<a[^>]*href=["']nostr:(${NOSTR_HTML_BECH32_RELAXED})["'][^>]*>([^<]*)</a>`,
            'gi'
          ),
          (_match, bech32Id, _linkText) => {
          // Validate bech32 ID and create appropriate placeholder
          if (!bech32Id) return _match
          
          // Escape the bech32 ID for HTML attributes
          const escapedId = bech32Id.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          
          if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
            return `<span data-nostr-mention="${escapedId}" class="nostr-mention-placeholder"></span>`
          } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
            return `<div data-nostr-note="${escapedId}" class="nostr-note-placeholder"></div>`
          }
          return _match
        })
        
        // Also handle nostr: addresses in plain text nodes (not already in <a> tags)
        // Process text nodes by replacing content between > and <
        // Use more flexible regex that matches any valid bech32 address (naddr can be 200+ chars)
        // Match addresses with optional [] suffix
        htmlString = htmlString.replace(
          new RegExp(
            `>([^<]*nostr:(${NOSTR_HTML_BECH32_RELAXED})(\\[\\])?[^<]*)<`,
            'g'
          ),
          (_match, textContent) => {
          // Extract nostr addresses from the text content - use flexible pattern that handles long addresses
          // npub and note are typically 58 chars, but naddr can be 200+ chars
          const nostrRegex = new RegExp(
            NOSTR_ASCIIDOC_TEXT_NODE_REGEX.source,
            NOSTR_ASCIIDOC_TEXT_NODE_REGEX.flags
          )
          let processedText = textContent
          const replacements: Array<{ start: number; end: number; replacement: string }> = []
          
          nostrRegex.lastIndex = 0
          let m
          while ((m = nostrRegex.exec(textContent)) !== null) {
            const bech32Id = m[1]
            const start = m.index
            const end = m.index + m[0].length
            
            // Escape bech32Id for HTML attributes
            const escapedId = bech32Id.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            
            if (bech32Id.startsWith('npub') || bech32Id.startsWith('nprofile')) {
              replacements.push({
                start,
                end,
                replacement: `<span data-nostr-mention="${escapedId}" class="nostr-mention-placeholder"></span>`
              })
            } else if (bech32Id.startsWith('note') || bech32Id.startsWith('nevent') || bech32Id.startsWith('naddr')) {
              replacements.push({
                start,
                end,
                replacement: `<div data-nostr-note="${escapedId}" class="nostr-note-placeholder"></div>`
              })
            }
          }
          
          // Apply replacements in reverse order to preserve indices
          for (let i = replacements.length - 1; i >= 0; i--) {
            const r = replacements[i]
            processedText = processedText.substring(0, r.start) + r.replacement + processedText.substring(r.end)
          }
          
          return `>${processedText}<`
        })
        
        // Fallback: ensure any remaining nostr: addresses are shown as plain text
        // This catches any that weren't converted to placeholders
        htmlString = htmlString.replace(
          new RegExp(`([^>])nostr:(${NOSTR_HTML_BECH32_RELAXED})(\\[\\])?`, 'g'),
          (_match, prefix, bech32Id, emptyBrackets) => {
          // Show as plain text if not already in a tag or placeholder
          return `${prefix}nostr:${bech32Id}${emptyBrackets || ''}`
        })

        // payto: URIs (RFC-8905 / NIP-A3) – replace <a href="payto://..."> and plain payto:// with placeholder
        htmlString = htmlString.replace(/<a[^>]*href=["'](payto:\/\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi, (_match, paytoUri, _linkText) => {
          const parsed = parsePaytoUri(paytoUri)
          if (!parsed) return _match
          const escaped = paytoUri.replace(/"/g, '&quot;').replace(/&/g, '&amp;').replace(/'/g, '&#39;')
          return `<span data-payto-uri="${escaped}" class="payto-placeholder"></span>`
        })
        htmlString = htmlString.replace(/(^|[\s>])(payto:\/\/[a-z0-9-]+\/[^\s<\]\)\"']+)/gi, (_match, prefix, paytoUri) => {
          const parsed = parsePaytoUri(paytoUri.trim())
          if (!parsed) return _match
          const escaped = parsed.raw.replace(/"/g, '&quot;').replace(/&/g, '&amp;').replace(/'/g, '&#39;')
          return `${prefix}<span data-payto-uri="${escaped}" class="payto-placeholder"></span>`
        })
        
        // Handle LaTeX math expressions from AsciiDoc stem processor
        // AsciiDoc with stem: latexmath outputs \(...\) for inline and \[...\] for block math
        // In HTML, these appear as literal \( and \) characters (backslash + parenthesis)
        // We need to match the literal backslash-paren sequence
        // In regex: \\ matches a literal backslash, \( matches a literal (
        htmlString = htmlString.replace(/\\\(([^)]+?)\\\)/g, (_match, latex) => {
          // Inline math - escape for HTML attribute
          // Unescape any HTML entities that might have been created
          const unescaped = latex.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
          const escaped = unescaped.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<span data-latex-inline="${escaped}" class="latex-inline-placeholder"></span>`
        })
        htmlString = htmlString.replace(/\\\[([^\]]+?)\\\]/g, (_match, latex) => {
          // Block math - escape for HTML attribute
          const unescaped = latex.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
          const escaped = unescaped.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<div data-latex-block="${escaped}" class="latex-block-placeholder my-4"></div>`
        })
        
        // Handle wikilinks - convert passthrough markers to placeholders
        // AsciiDoc passthrough +++WIKILINK:link|display+++ outputs just WIKILINK:link|display in HTML
        // Match WIKILINK: followed by any characters (including |) until end of text or HTML tag
        htmlString = htmlString.replace(/WIKILINK:([^<>\s]+)/g, (_match, linkContent) => {
          // Escape special characters for HTML attributes
          const escaped = linkContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
          return `<span data-wikilink="${escaped}" class="wikilink-placeholder"></span>`
        })
        
        // Handle YouTube URLs and relay URLs in links
        // Only replace links that need special handling - leave AsciiDoc-generated links alone
        const linkMatches: Array<{ match: string; href: string; linkText: string; index: number }> = []
        const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/g
        let linkMatch
        while ((linkMatch = linkRegex.exec(htmlString)) !== null) {
          const match = linkMatch[0]
          const href = linkMatch[1]
          const linkText = linkMatch[2]
          const index = linkMatch.index
          
          // Only process links that need special handling (YouTube, relay URLs)
          // Leave regular HTTP/HTTPS links as-is since AsciiDoc already formatted them correctly
          if (isYouTubeUrl(href) || isWebsocketUrl(href)) {
            linkMatches.push({ match, href, linkText, index })
          }
        }
        
        // Replace only special links in reverse order to preserve indices
        for (let i = linkMatches.length - 1; i >= 0; i--) {
          const { match, href, linkText } = linkMatches[i]
          let replacement = match
          
          // Check if the href is a YouTube URL
          if (isYouTubeUrl(href)) {
            const cleanedUrl = cleanUrl(href)
            replacement = `<div data-youtube-url="${cleanedUrl.replace(/"/g, '&quot;')}" class="youtube-placeholder my-2"></div>`
          }
          // Check if the href is a relay URL
          else if (isWebsocketUrl(href)) {
            const relayPath = `/relays/${encodeURIComponent(href)}`
            replacement = `<a href="${relayPath}" class="${URI_LINK_INLINE_HTML_CLASS} cursor-pointer" data-relay-url="${href}" data-original-text="${linkText.replace(/"/g, '&quot;')}">${linkText}</a>`
          }
          
          htmlString = htmlString.substring(0, linkMatches[i].index) + replacement + htmlString.substring(linkMatches[i].index + match.length)
        }
        
        // Handle YouTube URLs in plain text (not in <a> tags)
        // Create a new regex instance to avoid state issues
        const youtubeRegex = new RegExp(YOUTUBE_URL_REGEX.source, YOUTUBE_URL_REGEX.flags)
        htmlString = htmlString.replace(youtubeRegex, (match) => {
          // Only replace if not already in a tag (basic check)
          if (!match.includes('<') && !match.includes('>') && isYouTubeUrl(match)) {
            const cleanedUrl = cleanUrl(match)
            return `<div data-youtube-url="${cleanedUrl.replace(/"/g, '&quot;')}" class="youtube-placeholder my-2"></div>`
          }
          return match
        })
        
        // Handle relay URLs in plain text (not in <a> tags) - convert to relay page links
        htmlString = htmlString.replace(WS_URL_REGEX, (match) => {
          // Only replace if not already in a tag (basic check)
          if (!match.includes('<') && !match.includes('>') && isWebsocketUrl(match)) {
            const relayPath = `/relays/${encodeURIComponent(match)}`
            return `<a href="${relayPath}" class="${URI_LINK_INLINE_HTML_CLASS} cursor-pointer" data-relay-url="${match}" data-original-text="${match.replace(/"/g, '&quot;')}">${match}</a>`
          }
          return match
        })
        
        // Handle plain HTTP/HTTPS URLs in text nodes only (not inside existing HTML tags/attributes).
        // Regex-linkifying the full HTML string can corrupt existing anchor tags.
        htmlString = htmlString.replace(/>([^<]+)</g, (_fullMatch, textContent) => {
          const httpUrlRegex = /https?:\/\/[^\s<>"']+/g
          const replacedText = textContent.replace(httpUrlRegex, (rawUrl: string) => {
            // Skip URLs that are handled elsewhere.
            if (isYouTubeUrl(rawUrl) || isWebsocketUrl(rawUrl)) return rawUrl
            if (isImage(rawUrl) || isVideo(rawUrl) || isAudio(rawUrl)) return rawUrl
            const cleanedUrl = cleanUrl(rawUrl)
            if (!cleanedUrl) return rawUrl
            return `<a href="${cleanedUrl}" class="${URI_LINK_INLINE_HTML_CLASS}" target="_blank" rel="noopener noreferrer">${rawUrl}</a>`
          })
          return `>${replacedText}<`
        })
        
        setParseIssues(collectedIssues)
        setParsedHtml(htmlString)
      } catch (error) {
        logger.error('Failed to parse AsciiDoc', error as Error)
        const message = error instanceof Error ? error.message : String(error)
        setParseIssues([`ERROR: ${message}`])
        setParsedHtml(
          rawConvertedHtml.trim()
            ? resolveRelativeImagesInAsciidocHtml(rawConvertedHtml, event.content, fallbackImageUrls)
            : plainAsciiDocSourceToHtml(event.content, { imageUrls: fallbackImageUrls })
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }
    
    parseAsciidoc()
    
    return () => {
      cancelled = true
    }
  }, [processedContent, event.content, allImages])
  
  // Store React roots for cleanup
  const reactRootsRef = useRef<Map<Element, Root>>(new Map())
  const postProcessedHtmlRef = useRef<string | null>(null)
  // Track citations for footnotes and endnotes sections
  const citationsRef = useRef<Array<{ id: string; type: string; citationId: string; index: number }>>([])
  const citationIndexRef = useRef(0)
  const citationAnchorPrefix = useMemo(() => event.id.toLowerCase(), [event.id])

  useEffect(() => {
    postProcessedHtmlRef.current = null
  }, [event.id, processedContent])
  
  // Post-process rendered HTML to inject React components for nostr: links and handle hashtags
  useEffect(() => {
    if (!contentRef.current || !parsedHtml || isLoading) return
    if (postProcessedHtmlRef.current === parsedHtml) return
    
    // Only clean up roots that are no longer in the DOM
    const rootsToCleanup: Array<[Element, Root]> = []
    reactRootsRef.current.forEach((root, element) => {
      if (!element.isConnected) {
        rootsToCleanup.push([element, root])
        reactRootsRef.current.delete(element)
      }
    })
    
    // Unmount disconnected roots asynchronously to avoid race conditions
    if (rootsToCleanup.length > 0) {
      setTimeout(() => {
        rootsToCleanup.forEach(([, root]) => {
          try {
            root.unmount()
          } catch (err) {
            // Ignore errors during cleanup
          }
        })
      }, 0)
    }

    // Process nostr: mentions - replace placeholders with React components (inline)
    const nostrMentions = contentRef.current.querySelectorAll('.nostr-mention-placeholder[data-nostr-mention]')
    nostrMentions.forEach((element) => {
      const bech32Id = element.getAttribute('data-nostr-mention')
      if (!bech32Id) {
        logger.warn('Nostr mention placeholder found but no bech32Id attribute')
        // Fallback: show as plain text
        const textNode = document.createTextNode(`nostr:${element.textContent || ''}`)
        element.parentNode?.replaceChild(textNode, element)
        return
      }
      
      // Create an inline container for React component (mentions should be inline)
      const container = document.createElement('span')
      container.className = 'inline-block'
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Nostr mention placeholder has no parent node')
        return
      }
      parent.replaceChild(container, element)
      
      // Use React to render the component, with error handling
      try {
        const root = createRoot(container)
        root.render(<EmbeddedMention userId={bech32Id} />)
        reactRootsRef.current.set(container, root)
      } catch (error) {
        logger.error('Failed to render nostr mention', { bech32Id, error })
        // Fallback: show as plain text
        const textNode = document.createTextNode(`nostr:${bech32Id}`)
        parent.replaceChild(textNode, container)
      }
    })
    
    // Process nostr: notes - replace placeholders with React components
    const nostrNotes = contentRef.current.querySelectorAll('.nostr-note-placeholder[data-nostr-note]')
    nostrNotes.forEach((element) => {
      const bech32Id = element.getAttribute('data-nostr-note')
      if (!bech32Id) {
        logger.warn('Nostr note placeholder found but no bech32Id attribute')
        // Fallback: show as plain text
        const textNode = document.createTextNode(`nostr:${element.textContent || ''}`)
        element.parentNode?.replaceChild(textNode, element)
        return
      }
      
      // Create a block-level container for React component that fills width
      const container = document.createElement('div')
      container.className = 'w-full my-2'
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Nostr note placeholder has no parent node')
        return
      }
      parent.replaceChild(container, element)
      
      // Use React to render the component, with error handling
      try {
        const root = createRoot(container)
        root.render(
          <EmbeddedNoteProviders>
            <EmbeddedNote noteId={bech32Id} />
          </EmbeddedNoteProviders>
        )
        reactRootsRef.current.set(container, root)
      } catch (error) {
        logger.error('Failed to render nostr note', { bech32Id, error })
        // Fallback: show as plain text
        const textNode = document.createTextNode(`nostr:${bech32Id}`)
        parent.replaceChild(textNode, container)
      }
    })

    // Process payto: placeholders – replace with PaytoLink
    const paytoPlaceholders = contentRef.current.querySelectorAll('.payto-placeholder[data-payto-uri]')
    paytoPlaceholders.forEach((element) => {
      const paytoUri = element.getAttribute('data-payto-uri')
      if (!paytoUri) return
      const decoded = paytoUri.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      const container = document.createElement('span')
      container.className = 'inline'
      const parent = element.parentNode
      if (!parent) return
      parent.replaceChild(container, element)
      try {
        const root = createRoot(container)
        root.render(<PaytoLink paytoUri={decoded} />)
        reactRootsRef.current.set(container, root)
      } catch (error) {
        logger.error('Failed to render payto link', { paytoUri: decoded, error })
        const textNode = document.createTextNode(decoded)
        parent.replaceChild(textNode, container)
      }
    })
    
    // Process citations - replace placeholders with React components
    // First pass: collect all citations and assign indices
    const getCitationAnchorId = (index: number) => `citation-${citationAnchorPrefix}-${index}`
    const getCitationRefId = (index: number) => `citation-ref-${citationAnchorPrefix}-${index}`
    const footnotesSectionId = `footnotes-section-${citationAnchorPrefix}`
    const referencesSectionId = `references-section-${citationAnchorPrefix}`

    const citationPlaceholders = Array.from(contentRef.current.querySelectorAll('.citation-placeholder[data-citation]'))
    
    citationsRef.current = []
    citationIndexRef.current = 0
    
    citationPlaceholders.forEach((element) => {
      const citationId = element.getAttribute('data-citation')
      const citationType = element.getAttribute('data-citation-type') || 'end'
      if (!citationId) {
        console.warn('Citation placeholder found but no citation ID attribute')
        return
      }
      
      const citationIndex = citationIndexRef.current++
      citationsRef.current.push({
        id: getCitationAnchorId(citationIndex),
        type: citationType,
        citationId,
        index: citationIndex
      })
    })
    
    // Second pass: render citations based on type
    citationPlaceholders.forEach((element, idx) => {
      const citationId = element.getAttribute('data-citation')
      const citationType = element.getAttribute('data-citation-type') || 'end'
      if (!citationId) return
      
      const citation = citationsRef.current[idx]
      if (!citation) return
      
      const citationNumber = citation.index + 1
      const parent = element.parentNode
      if (!parent) {
        logger.warn('Citation placeholder has no parent node')
        return
      }
      
      // Handle different citation types
      if (citationType === 'inline' || citationType === 'prompt-inline') {
        // Inline citations render as clickable text
        const container = document.createElement('span')
        container.className = 'inline'
        container.style.display = 'inline'
        container.style.whiteSpace = 'nowrap'
        parent.replaceChild(container, element)
        
        const root = createRoot(container)
        root.render(
          <DeletedEventProvider>
            <ReplyProvider>
              <EmbeddedCitation
                citationId={citationId}
                displayType={citationType as 'inline' | 'prompt-inline'}
              />
            </ReplyProvider>
          </DeletedEventProvider>
        )
        reactRootsRef.current.set(container, root)
      } else if (citationType === 'foot' || citationType === 'foot-end') {
        // Footnotes render as superscript numbers
        const sup = document.createElement('sup')
        sup.className = 'citation-ref'
        sup.style.display = 'inline'
        sup.style.whiteSpace = 'nowrap'
        const link = document.createElement('a')
        link.href = `#${getCitationAnchorId(citation.index)}`
        link.id = getCitationRefId(citation.index)
        link.className = `${URI_LINK_CLASS} no-underline`
        link.textContent = `[${citationNumber}]`
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const citationElement = document.getElementById(getCitationAnchorId(citation.index))
          if (citationElement) {
            citationElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
        sup.appendChild(link)
        parent.replaceChild(sup, element)
      } else if (citationType === 'end' || citationType === 'prompt-end') {
        // Endnotes render as superscript numbers that link to references section
        const sup = document.createElement('sup')
        sup.className = 'citation-ref'
        sup.style.display = 'inline'
        sup.style.whiteSpace = 'nowrap'
        const link = document.createElement('a')
        link.href = `#${referencesSectionId}`
        link.id = getCitationRefId(citation.index)
        link.className = `${URI_LINK_CLASS} no-underline`
        link.textContent = `[${citationNumber}]`
        link.addEventListener('click', (e) => {
          e.preventDefault()
          const refSection = document.getElementById(referencesSectionId)
          if (refSection) {
            refSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        })
        sup.appendChild(link)
        parent.replaceChild(sup, element)
      } else if (citationType === 'quote') {
        // Quotes render as block-level citation cards
        const container = document.createElement('div')
        container.className = 'w-full my-2'
        parent.replaceChild(container, element)
        
        const root = createRoot(container)
        root.render(
          <DeletedEventProvider>
            <ReplyProvider>
              <EmbeddedCitation
                citationId={citationId}
                displayType="quote"
              />
            </ReplyProvider>
          </DeletedEventProvider>
        )
        reactRootsRef.current.set(container, root)
      }
    })
    
    // Render footnotes and references sections
    const footnotes = citationsRef.current.filter(c => c.type === 'foot' || c.type === 'foot-end')
    const endCitations = citationsRef.current.filter(c => c.type === 'end' || c.type === 'prompt-end')
    
    if (!contentRef.current?.parentElement) {
      console.warn('AsciidocArticle: contentRef parent not found, cannot render footnotes/references')
      return
    }
    
    const parentContainer = contentRef.current.parentElement
    const externalReferencesContainer = footnotesContainerId
      ? document.getElementById(footnotesContainerId)
      : null
    const referencesTargetContainer = externalReferencesContainer ?? parentContainer
    
    // Footnotes stay at section-level. Endnotes can target publication-level container.
    const existingFootnotes = parentContainer.querySelector(`#${footnotesSectionId}`)
    const existingReferences = referencesTargetContainer.querySelector(`#${referencesSectionId}`)
    
    // If sections already exist and we have no new citations, preserve existing sections
    // This handles the case where useEffect runs again after placeholders are replaced
    if ((existingFootnotes || existingReferences) && citationsRef.current.length === 0) {
      postProcessedHtmlRef.current = parsedHtml
      return
    }
    
    // Remove existing sections only if we're going to recreate them with new data
    if (existingFootnotes && footnotes.length > 0) {
      existingFootnotes.remove()
    }
    if (existingReferences && endCitations.length > 0) {
      existingReferences.remove()
    }
    
    // Render footnotes section
    if (footnotes.length > 0) {
      const footnotesSection = document.createElement('div')
      footnotesSection.id = footnotesSectionId
      footnotesSection.className = 'asciidoc-footnotes-section mt-8 pt-4 border-t border-gray-300 dark:border-gray-700'
      
      const h3 = document.createElement('h3')
      h3.className = 'text-lg font-semibold mb-4'
      h3.textContent = 'Footnotes'
      footnotesSection.appendChild(h3)
      
      const ol = document.createElement('ol')
      // Academic style: proper list formatting with aligned numbers
      ol.className = 'list-decimal pl-6 space-y-3'
      ol.style.listStylePosition = 'outside'
      
      footnotes.forEach((citation) => {
        const li = document.createElement('li')
        li.id = citation.id
        li.className = 'text-sm pl-2'
        li.style.display = 'list-item'
        
        const citationContainer = document.createElement('span')
        citationContainer.className = 'inline'
        li.appendChild(citationContainer)
        
        const backLink = document.createElement('a')
        backLink.href = `#${getCitationRefId(citation.index)}`
        backLink.className = `text-xs ml-2 inline-flex items-center ${URI_LINK_CLASS}`
        backLink.setAttribute('aria-label', 'Return to citation')
        // Use hyperlink icon instead of emoji
        backLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
        backLink.addEventListener('click', (e) => {
          e.preventDefault()
          const refElement = document.getElementById(getCitationRefId(citation.index))
          if (refElement) {
            refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
        li.appendChild(backLink)
        
        ol.appendChild(li)
        
        // Render citation component - use a wrapper div to position backlink
        const citationWrapperDiv = document.createElement('div')
        citationWrapperDiv.className = 'inline'
        citationWrapperDiv.style.display = 'inline'
        citationContainer.appendChild(citationWrapperDiv)
        
        const citationRoot = createRoot(citationWrapperDiv)
        citationRoot.render(
          <DeletedEventProvider>
            <ReplyProvider>
              <EmbeddedCitation
                citationId={citation.citationId}
                displayType={citation.type === 'foot-end' ? 'foot-end' : 'foot'}
              />
            </ReplyProvider>
          </DeletedEventProvider>
        )
        reactRootsRef.current.set(citationWrapperDiv, citationRoot)
        
        // Insert backlink at end of first line after citation renders
        setTimeout(() => {
          const firstDiv = citationWrapperDiv.querySelector('div:first-child') as HTMLElement
          if (firstDiv) {
            firstDiv.style.display = 'inline'
            firstDiv.style.position = 'relative'
            backLink.style.position = 'absolute'
            backLink.style.right = '0'
            backLink.style.top = '0'
            firstDiv.appendChild(backLink)
          } else {
            citationWrapperDiv.appendChild(backLink)
          }
        }, 100)
      })
      
      footnotesSection.appendChild(ol)
      // Footnotes always stay at the bottom of this section.
      contentRef.current.insertAdjacentElement('afterend', footnotesSection)
    }
    
    // Render references section
    if (endCitations.length > 0) {
      const referencesSection = document.createElement('div')
      referencesSection.id = referencesSectionId
      referencesSection.className = 'asciidoc-references-section mt-8 pt-4 border-t border-gray-300 dark:border-gray-700'
      
      const h3 = document.createElement('h3')
      h3.className = 'text-lg font-semibold mb-4'
      h3.textContent = 'References'
      referencesSection.appendChild(h3)
      
      const ol = document.createElement('ol')
      // Academic style: proper list formatting with aligned numbers
      ol.className = 'list-decimal pl-6 space-y-3'
      ol.style.listStylePosition = 'outside'
      
      endCitations.forEach((citation) => {
        const li = document.createElement('li')
        li.id = `citation-end-${citationAnchorPrefix}-${citation.index}`
        li.className = 'text-sm pl-2'
        li.style.display = 'list-item'
        
        const citationWrapper = document.createElement('div')
        citationWrapper.className = 'inline-block w-full relative'
        li.appendChild(citationWrapper)
        
        const citationContainer = document.createElement('span')
        citationContainer.className = 'inline'
        citationWrapper.appendChild(citationContainer)
        
        const backLink = document.createElement('a')
        backLink.href = `#${getCitationRefId(citation.index)}`
        backLink.className = `text-xs ml-2 inline-flex items-center ${URI_LINK_CLASS}`
        backLink.setAttribute('aria-label', 'Return to citation')
        backLink.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>'
        backLink.addEventListener('click', (e) => {
          e.preventDefault()
          const refElement = document.getElementById(getCitationRefId(citation.index))
          if (refElement) {
            refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        })
        
        ol.appendChild(li)
        
        // Render citation component
        const citationRoot = createRoot(citationContainer)
        citationRoot.render(
          <DeletedEventProvider>
            <ReplyProvider>
              <EmbeddedCitation
                citationId={citation.citationId}
                displayType={citation.type as 'end' | 'prompt-end'}
              />
            </ReplyProvider>
          </DeletedEventProvider>
        )
        reactRootsRef.current.set(citationContainer, citationRoot)
        
        // Insert backlink at end of first line after citation renders
        setTimeout(() => {
          const firstDiv = citationContainer.querySelector('div:first-child') as HTMLElement
          if (firstDiv) {
            firstDiv.style.display = 'inline'
            firstDiv.style.position = 'relative'
            backLink.style.position = 'absolute'
            backLink.style.right = '0'
            backLink.style.top = '0'
            firstDiv.appendChild(backLink)
          } else {
            citationWrapper.appendChild(backLink)
          }
        }, 100)
      })
      
      referencesSection.appendChild(ol)
      const insertedFootnotesSection = parentContainer.querySelector(`#${footnotesSectionId}`)
      if (insertedFootnotesSection && !externalReferencesContainer) {
        insertedFootnotesSection.insertAdjacentElement('afterend', referencesSection)
      } else if (externalReferencesContainer) {
        externalReferencesContainer.appendChild(referencesSection)
      } else {
        contentRef.current.insertAdjacentElement('afterend', referencesSection)
      }
    }
    
    // Process LaTeX math expressions - render with KaTeX
    const latexInlinePlaceholders = contentRef.current.querySelectorAll('.latex-inline-placeholder[data-latex-inline]')
    latexInlinePlaceholders.forEach((element) => {
      const latex = element.getAttribute('data-latex-inline')
      if (!latex) return
      
      try {
        // Render LaTeX with KaTeX
        const rendered = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: false
        })
        // Replace the placeholder with the rendered HTML
        element.outerHTML = rendered
      } catch (error) {
        logger.error('Error rendering LaTeX inline math:', error)
        // On error, show the raw LaTeX
        element.outerHTML = `<span>$${latex}$</span>`
      }
    })
    
    const latexBlockPlaceholders = contentRef.current.querySelectorAll('.latex-block-placeholder[data-latex-block]')
    latexBlockPlaceholders.forEach((element) => {
      const latex = element.getAttribute('data-latex-block')
      if (!latex) return
      
      try {
        // Render LaTeX with KaTeX in display mode
        const rendered = katex.renderToString(latex, {
          throwOnError: false,
          displayMode: true
        })
        // Replace the placeholder with the rendered HTML
        element.outerHTML = rendered
      } catch (error) {
        logger.error('Error rendering LaTeX block math:', error)
        // On error, show the raw LaTeX
        element.outerHTML = `<div>$$${latex}$$</div>`
      }
    })
    
    // Process YouTube URLs - replace placeholders with React components
    const youtubePlaceholders = contentRef.current.querySelectorAll('.youtube-placeholder[data-youtube-url]')
    youtubePlaceholders.forEach((element) => {
      const youtubeUrl = element.getAttribute('data-youtube-url')
      if (!youtubeUrl) return
      
      // Create a container for React component
      const container = document.createElement('div')
      container.className = 'my-2'
      element.parentNode?.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<YoutubeEmbeddedPlayer url={youtubeUrl} className="max-w-[400px]" mustLoad={false} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process wikilinks - replace placeholders with React components
    const wikilinks = contentRef.current.querySelectorAll('.wikilink-placeholder[data-wikilink]')
    wikilinks.forEach((element) => {
      const linkContent = element.getAttribute('data-wikilink')
      if (!linkContent) return
      
      // Parse wikilink: extract target and display text
      let target = linkContent.includes('|') ? linkContent.split('|')[0].trim() : linkContent.trim()
      let displayText = linkContent.includes('|') ? linkContent.split('|')[1].trim() : linkContent.trim()
      
      // Convert to d-tag format (same as MarkdownArticle)
      const dtag = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      
      // Create a container for React component
      const container = document.createElement('span')
      container.className = 'inline-block'
      element.parentNode?.replaceChild(container, element)
      
      // Use React to render the component
      const root = createRoot(container)
      root.render(<Wikilink dTag={dtag} displayText={displayText} />)
      reactRootsRef.current.set(container, root)
    })
    
    // Process hashtags in text nodes - convert #tag to links
    const walker = document.createTreeWalker(
      contentRef.current,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if parent is a link, code, or pre tag
          const parent = node.parentElement
          if (!parent) return NodeFilter.FILTER_ACCEPT
          if (parent.tagName === 'A' || parent.tagName === 'CODE' || parent.tagName === 'PRE') {
            return NodeFilter.FILTER_REJECT
          }
          return NodeFilter.FILTER_ACCEPT
        }
      }
    )
    
    const textNodes: Text[] = []
    let node
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent) {
        textNodes.push(node as Text)
      }
    }
    
    textNodes.forEach((textNode) => {
      const text = textNode.textContent || ''
      const hashtagRegex = /#([a-zA-Z0-9_]+)/g
      const matches = Array.from(text.matchAll(hashtagRegex))
      
      if (matches.length > 0) {
        const fragment = document.createDocumentFragment()
        let lastIndex = 0
        
        matches.forEach((match) => {
          if (match.index === undefined) return
          
          // Add text before hashtag
          if (match.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
          }
          
          // Create hashtag link
          const link = document.createElement('a')
          link.href = `/notes?t=${match[1].toLowerCase()}`
          link.className = `${URI_LINK_INLINE_HTML_CLASS} cursor-pointer`
          link.textContent = `#${match[1]}`
          link.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            navigateToHashtagRef.current(`/notes?t=${match[1].toLowerCase()}`)
          })
          fragment.appendChild(link)
          
          lastIndex = match.index + match[0].length
        })
        
        // Add remaining text
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
        }
        
        textNode.parentNode?.replaceChild(fragment, textNode)
      }
    })
    
    // Handle all links - truncate display text and add click handlers for relay URLs
    const allLinks = contentRef.current.querySelectorAll('a[href]')
    allLinks.forEach((link) => {
      const href = link.getAttribute('href')
      if (!href) return
      
      // Get current link text (this might be the full URL or custom text)
      const linkText = link.textContent || ''
      
      // Truncate link text if it's longer than 200 characters
      if (linkText.length > 200) {
        const truncatedText = truncateLinkText(linkText)
        link.textContent = truncatedText
        // Store full text as title for tooltip
        if (!link.getAttribute('title')) {
          link.setAttribute('title', linkText)
        }
      }
      
      // Handle relay URL links - add click handlers to navigate to relay page
      const relayUrl = link.getAttribute('data-relay-url')
      if (relayUrl) {
        const relayPath = `/relays/${encodeURIComponent(relayUrl)}`
        link.setAttribute('href', relayPath)
        link.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          navigateToRelayRef.current(relayPath)
        })
      }
    })
    
    // No cleanup needed here - we only clean up disconnected roots above
    // Full cleanup happens on component unmount
    postProcessedHtmlRef.current = parsedHtml
  }, [parsedHtml, isLoading, footnotesContainerId, citationAnchorPrefix, event.id])
  
  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      const rootsToCleanup = Array.from(reactRootsRef.current.values())
      reactRootsRef.current.clear()
      
      // Unmount asynchronously
      setTimeout(() => {
        rootsToCleanup.forEach((root) => {
          try {
            root.unmount()
          } catch (err) {
            // Ignore errors during cleanup
          }
        })
      }, 0)
    }
  }, [])
  
  // Initialize syntax highlighting
  useEffect(() => {
    const initHighlight = async () => {
      if (typeof window !== 'undefined') {
        try {
          const hljs = await (await import('@/lib/highlight')).getHighlightJs()
          if (contentRef.current) {
            contentRef.current.querySelectorAll('pre code').forEach((block) => {
              const element = block as HTMLElement
              element.style.color = 'inherit'
              element.classList.add('text-gray-900', 'dark:text-gray-100')
              const alreadyHighlighted =
                element.classList.contains('hljs') && element.querySelector('span[class]')
              if (!alreadyHighlighted) {
                hljs.highlightElement(element)
              }
              element.style.color = 'inherit'
            })
          }
        } catch {
          /* optional — code blocks still render without colors */
        }
      }
    }
    
    const timeoutId = setTimeout(initHighlight, 100)
    return () => clearTimeout(timeoutId)
  }, [parsedHtml])
  
  return (
    <>
      <style>{`
        .hljs {
          background: transparent !important;
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
        .asciidoc-content img {
          display: block;
          max-width: 400px;
          height: auto;
          border-radius: 0.5rem;
          cursor: zoom-in;
          margin: 0.5rem 0;
        }
        .asciidoc-content a[href^="/notes?t="] {
          color: #16a34a !important;
          text-decoration: none !important;
        }
        .asciidoc-content a[href^="/notes?t="]:hover {
          color: #15803d !important;
          text-decoration: underline !important;
        }
        .dark .asciidoc-content a[href^="/notes?t="] {
          color: #4ade80 !important;
        }
        .dark .asciidoc-content a[href^="/notes?t="]:hover {
          color: #86efac !important;
        }
        .asciidoc-content .citation-placeholder.inline,
        .asciidoc-content .citation-placeholder.inline > * {
          display: inline !important;
        }
        .asciidoc-content .citation-ref,
        .asciidoc-content .citation-ref > * {
          display: inline !important;
          white-space: nowrap;
        }
        .asciidoc-content sup.citation-ref {
          display: inline !important;
          vertical-align: super;
          font-size: 0.83em;
          line-height: 0;
        }
        /* Academic references section formatting */
        .asciidoc-content #references-section ol,
        .asciidoc-content #footnotes-section ol,
        .asciidoc-references-section ol,
        .asciidoc-footnotes-section ol {
          list-style: decimal;
          padding-left: 1.5rem;
          list-style-position: outside;
        }
        .asciidoc-content #references-section li,
        .asciidoc-content #footnotes-section li,
        .asciidoc-references-section li,
        .asciidoc-footnotes-section li {
          padding-left: 0.5rem;
          margin-bottom: 0.5rem;
          line-height: 1.6;
          display: list-item;
        }
        /* Position backlink at end of first line */
        .asciidoc-content #references-section li > div > span > div:first-child,
        .asciidoc-content #footnotes-section li > div > span > div:first-child,
        .asciidoc-references-section li > div > span > div:first-child,
        .asciidoc-footnotes-section li > div > span > div:first-child {
          position: relative;
          display: inline-block;
          width: 100%;
        }
        .asciidoc-content #references-section h3,
        .asciidoc-content #footnotes-section h3,
        .asciidoc-references-section h3,
        .asciidoc-footnotes-section h3 {
          font-size: 1.125rem;
          font-weight: 600;
          margin-bottom: 1rem;
        }
        /* Blockquote spacing in citations */
        .asciidoc-content #references-section blockquote,
        .asciidoc-content #footnotes-section blockquote,
        .asciidoc-references-section blockquote,
        .asciidoc-footnotes-section blockquote {
          padding-left: 1.5rem !important;
        }
      `}</style>
      <div
        className={cn(
          contentOnly
            ? 'break-words overflow-wrap-anywhere'
            : 'prose prose-zinc max-w-none dark:prose-invert break-words overflow-wrap-anywhere',
          className
        )}
      >
        {/* Metadata */}
        {showArticleChrome && !effectiveHideTitle && !effectiveHideImagesAndInfo && metadata.title && (
          <h1 className="break-words">{metadata.title}</h1>
        )}
        {showArticleChrome && !effectiveHideImagesAndInfo && metadata.summary && (
          <blockquote>
            <p className="break-words">{metadata.summary}</p>
          </blockquote>
        )}
        {showArticleChrome && !effectiveHideTitle && effectiveHideImagesAndInfo && metadata.title && (
          <h2 className="text-2xl font-bold mb-4 leading-tight break-words">{metadata.title}</h2>
        )}
        
        {/* Metadata image */}
        {showArticleChrome && !effectiveHideImagesAndInfo && metadata.image && (() => {
          const cleanedMetadataImage = cleanUrl(metadata.image)
          const parentImageUrlCleaned = parentImageUrl ? cleanUrl(parentImageUrl) : null
          // Don't show if already in content (by URL or same asset identity)
          if (cleanedMetadataImage && mediaUrlsInContent.has(cleanedMetadataImage)) {
            return null
          }
          if (isImageUrlPresentInText(event.content, metadata.image)) {
            return null
          }
          // Don't show if it matches the parent publication's image (to avoid duplicate cover images)
          if (parentImageUrlCleaned && cleanedMetadataImage === parentImageUrlCleaned) {
            return null
          }
          
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
        {showArticleChrome && inlineLeftoverTagMedia.length > 0 && (
          <div className="space-y-4 mb-6">
            {inlineLeftoverTagMedia.map((media) => {
              const cleaned = cleanUrl(media.url)
              const mediaIndex = imageIndexMap.get(cleaned)
              
              if (media.type === 'image') {
                return (
                  <div key={`tag-media-${cleaned}`} className="my-2">
                    <Image
                      image={{ url: media.url, pubkey: event.pubkey }}
                      className="max-w-[400px] rounded-lg cursor-zoom-in"
                      classNames={{
                        wrapper: 'rounded-lg',
                        errorPlaceholder: 'aspect-square h-[30vh]'
                      }}
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
                      mustLoad={true}
                      poster={media.poster}
                      blurHash={media.blurHash}
                      dim={media.dim}
                    />
                  </div>
                )
              }
              return null
            })}
          </div>
        )}
        
        {/* YouTube URLs from tags (only if not in content) */}
        {showArticleChrome && leftoverTagYouTubeUrls.length > 0 && (
          <div className="space-y-4 mb-6">
            {leftoverTagYouTubeUrls.map((url) => {
              const cleaned = cleanUrl(url)
              return (
                <div key={`tag-youtube-${cleaned}`} className="my-2">
                  <YoutubeEmbeddedPlayer
                    url={url}
                    className="max-w-[400px]"
                    mustLoad={false}
                  />
                </div>
              )
            })}
          </div>
        )}
        
        {showArticleChrome && parseIssues.length > 0 ? (
          <div
            role="status"
            className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
          >
            <p className="font-medium">{t('Asciidoc parse warning title')}</p>
            <p className="mt-1 text-muted-foreground">{t('Asciidoc parse warning body')}</p>
          </div>
        ) : null}

        {/* Parsed AsciiDoc content */}
        {isLoading ? (
          <div>Loading content...</div>
        ) : (
          <div
            ref={contentRef}
            className="asciidoc-content break-words"
            dangerouslySetInnerHTML={{ __html: parsedHtml }}
          />
        )}
        
        {showArticleChrome && suppressedImetaMedia.length > 0 && (
          <OrphanedImetaMediaSection
            className="mt-4 mb-2"
            items={suppressedImetaMedia}
            authorPubkey={event.pubkey}
            mustLoadMedia
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
        {showArticleChrome && !effectiveHideImagesAndInfo && leftoverMetadataTags.length > 0 && (
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
        
        {/* Footnotes and References sections - rendered via useEffect after citations are processed */}
        {showArticleChrome ? (
          <>
            <div id="footnotes-section-container"></div>
            <div id="references-section-container"></div>
          </>
        ) : null}

      </div>
      
      {/* Image gallery lightbox */}
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
              open={lightboxIndex >= 0}
              close={() => setLightboxIndex(-1)}
              on={{
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
  )
}

