import { shouldLeaveDoubleBracketForAsciidoctor } from '@/lib/asciidoc-double-bracket-guard'
import { findHttpUrlsInText, formatBareHttpUrlForMarkdownAutolink, isImage, isVideo, isAudio } from '@/lib/url'
import { YOUTUBE_URL_REGEX } from '@/constants'
import { isSpotifyOpenUrl } from '@/lib/spotify-url'
import { isFountainOpenUrl } from '@/lib/fountain-url'
import { isWavlakeOpenUrl } from '@/lib/wavlake-url'
import { isZapStreamWatchUrl } from '@/lib/zap-stream-url'

/** Bare http(s) URL occupies a line by itself (optional trailing punctuation) — leave for WebPreview embed. */
function isBareUrlOnOwnLine(content: string, url: string, index: number): boolean {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1
  const lineEndRaw = content.indexOf('\n', index + url.length)
  const lineEnd = lineEndRaw === -1 ? content.length : lineEndRaw
  const line = content.substring(lineStart, lineEnd).trim()
  if (line === url) return true
  const withoutTrail = line.replace(/[.,;:!?)]+$/, '')
  return withoutTrail === url
}

/**
 * Check if a URL is a YouTube URL
 */
function isYouTubeUrl(url: string): boolean {
  // Create a new regex instance to avoid state issues with global regex
  const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
  return regex.test(url)
}

/**
 * Preprocess content to convert raw media URLs and hyperlinks to markdown syntax
 * - Images: https://example.com/image.png -> ![](https://example.com/image.png)
 * - Videos: https://example.com/video.mp4 -> ![](https://example.com/video.mp4)
 * - Audio: https://example.com/audio.mp3 -> ![](https://example.com/audio.mp3)
 * - Hyperlinks: https://example.com/page -> [https://example.com/page](https://example.com/page)
 */
export function preprocessMarkdownMediaLinks(content: string): string {
  let processed = content
  
  // First, handle angle bracket URLs: <https://example.com> -> https://example.com
  // These should be converted to plain URLs so they can be processed by the main URL processor to handle
  const angleBracketUrlRegex = /<((?:https?|ftp):\/\/[^>]+)>/g
  processed = processed.replace(angleBracketUrlRegex, (_match, url) => url)

  const allMatches = findHttpUrlsInText(processed).filter(({ index }) => {
    const before = processed.substring(Math.max(0, index - 20), index)
    // Skip if already part of markdown syntax
    if (before.match(/\[[^\]]*$/) || before.match(/\]\([^)]*$/) || before.match(/!\[[^\]]*$/)) {
      return false
    }
    return true
  })
  
  // Process in reverse order to preserve indices
  for (let i = allMatches.length - 1; i >= 0; i--) {
    const { url, index } = allMatches[i]
    
    // Check if URL is in code block
    const beforeUrl = processed.substring(0, index)
    const backticksCount = (beforeUrl.match(/```/g) || []).length
    if (backticksCount % 2 === 1) {
      continue // In code block
    }
    
    // Check if URL is in inline code
    const lastBacktick = beforeUrl.lastIndexOf('`')
    if (lastBacktick !== -1) {
      const afterUrl = processed.substring(index + url.length)
      const nextBacktick = afterUrl.indexOf('`')
      if (nextBacktick !== -1) {
        const codeBefore = beforeUrl.substring(lastBacktick + 1)
        const codeAfter = afterUrl.substring(0, nextBacktick)
        // If no newlines between backticks, it's inline code
        if (!codeBefore.includes('\n') && !codeAfter.includes('\n')) {
          continue
        }
      }
    }
    
    // Check if it's a media URL or YouTube URL
    const isImageUrl = isImage(url)
    const isVideoUrl = isVideo(url)
    const isAudioUrl = isAudio(url)
    const isYouTube = isYouTubeUrl(url)

    // Skip YouTube URLs - they should be left as plain text so they can be detected and rendered as YouTube embeds
    if (isYouTube) {
      continue
    }

    if (isSpotifyOpenUrl(url)) {
      continue
    }

    if (isWavlakeOpenUrl(url)) {
      continue
    }

    if (isFountainOpenUrl(url)) {
      continue
    }

    if (isZapStreamWatchUrl(url)) {
      continue
    }

    // Standalone line URLs stay bare so MarkdownArticle renders WebPreview (not `[url](url)` green links).
    if (isBareUrlOnOwnLine(processed, url, index)) {
      continue
    }
    
    let replacement: string
    if (isImageUrl || isVideoUrl || isAudioUrl) {
      replacement = formatBareHttpUrlForMarkdownAutolink(url, true)
    } else {
      replacement = formatBareHttpUrlForMarkdownAutolink(url, false)
    }
    
    // Replace the URL
    processed = processed.substring(0, index) + replacement + processed.substring(index + url.length)
  }
  
  return processed
}

/**
 * Preprocess content to convert raw media URLs and hyperlinks to AsciiDoc syntax
 * - Images: https://example.com/image.png -> image::https://example.com/image.png[]
 * - Videos: https://example.com/video.mp4 -> video::https://example.com/video.mp4[]
 * - Audio: https://example.com/audio.mp3 -> audio::https://example.com/audio.mp3[]
 * - Hyperlinks: https://example.com/page -> https://example.com/page[link text]
 * - Wikilinks: [[link]] or [[link|display]] -> +++WIKILINK:link|display+++ (passthrough for post-processing)
 */
export function preprocessAsciidocMediaLinks(content: string): string {
  let processed = content
  
  // Note: Wikilinks are now processed in AsciidocArticle.tsx BEFORE this function is called
  // to prevent AsciiDoc from converting them to regular links. We skip wikilink processing here.
  
  // Skip any remaining wikilinks (they should already be processed, but safety check)
  // Check for passthrough markers to avoid double-processing
  if (processed.includes('BOOKSTR_START:') || processed.includes('WIKILINK:')) {
    // Wikilinks already processed, skip
  } else {
    // Fallback: protect bookstr wikilinks if they weren't processed yet
    processed = processed.replace(/\[\[book::([^\]]+)\]\]/g, (_match, bookContent) => {
      const cleanContent = bookContent.trim()
      return `+++BOOKSTR_MARKER:${cleanContent}:BOOKSTR_END+++`
    })
    
    // Fallback: protect regular wikilinks if they weren't processed yet
    processed = processed.replace(/\[\[([^\]]+)\]\]/g, (match, linkContent, offset) => {
      if (linkContent.startsWith('book::')) {
        return match
      }
      if (linkContent.startsWith('citation::')) {
        return match
      }
      if (shouldLeaveDoubleBracketForAsciidoctor(processed, offset, match.length, linkContent)) {
        return match
      }
      return `+++WIKILINK:${linkContent}+++`
    })
  }
  
  // Find all URLs but process them in reverse order to preserve indices
  const allMatches = findHttpUrlsInText(content).filter(({ url, index }) => {
    const urlEnd = index + url.length
    const beforeUrl = content.substring(Math.max(0, index - 100), index)
    const afterUrl = content.substring(urlEnd, Math.min(content.length, urlEnd + 100))
    if (beforeUrl.includes('BOOKSTR_START:') || beforeUrl.includes('WIKILINK:') ||
        afterUrl.includes(':BOOKSTR_END') || afterUrl.includes('+++')) {
      return false
    }
    return true
  }).filter(({ url, index }) => {
    const urlEnd = index + url.length
    // Check if this URL is part of an AsciiDoc link format url[text]
    const contextAfter = content.substring(urlEnd, Math.min(content.length, urlEnd + 50))
    if (contextAfter.match(/^\s*\[[^\]]+\]/)) {
      return false
    }
    const before = content.substring(Math.max(0, index - 30), index)
    // Check if this URL is already part of AsciiDoc syntax
    if (before.match(/image::\s*$/) ||
        before.match(/video::\s*$/) ||
        before.match(/audio::\s*$/) ||
        before.match(/link:\S+\[/) ||
        before.match(/https?:\/\/[^\s]*\[/)) {
      return false
    }
    return true
  })
  
  // Process in reverse order to preserve indices
  for (let i = allMatches.length - 1; i >= 0; i--) {
    const { url, index } = allMatches[i]
    
    // Check if URL is in code block
    const beforeUrl = content.substring(0, index)
    const codeBlockCount = (beforeUrl.match(/----/g) || []).length
    if (codeBlockCount % 2 === 1) {
      continue // In code block
    }
    
    // Check if it's a media URL or YouTube URL
    const isImageUrl = isImage(url)
    const isVideoUrl = isVideo(url)
    const isAudioUrl = isAudio(url)
    const isYouTube = isYouTubeUrl(url)

    let replacement: string
    if (isImageUrl) {
      // Images: convert to image::url[]
      replacement = `image::${url}[]`
    } else if (isVideoUrl) {
      // Videos: convert to video::url[]
      replacement = `video::${url}[]`
    } else if (isAudioUrl) {
      // Audio: convert to audio::url[]
      replacement = `audio::${url}[]`
    } else if (isYouTube) {
      // YouTube URLs: convert to link:url[url] (will be handled in post-processing)
      // This allows AsciiDoc to process it as a link, then we'll replace it with YouTube player
      replacement = `link:${url}[${url}]`
    } else {
      // Regular hyperlinks: convert to link:url[url]
      replacement = `link:${url}[${url}]`
    }
    
    // Replace the URL
    processed = processed.substring(0, index) + replacement + processed.substring(index + url.length)
  }
  
  return processed
}

