import { getImetaInfosFromEvent } from './event'
import { TImetaInfo } from '@/types'
import { Event } from 'nostr-tools'

/**
 * Extract all media URLs from an article event
 */
export function extractArticleMedia(event: Event): TImetaInfo[] {
  const media: TImetaInfo[] = []
  const seenUrls = new Set<string>()

  // Extract from imeta tags
  const imetaInfos = getImetaInfosFromEvent(event)
  imetaInfos.forEach(imeta => {
    if (!seenUrls.has(imeta.url)) {
      seenUrls.add(imeta.url)
      media.push(imeta)
    }
  })

  // Extract from metadata tags
  const imageTag = event.tags.find(tag => tag[0] === 'image')?.[1]
  if (imageTag && !seenUrls.has(imageTag)) {
    seenUrls.add(imageTag)
    media.push({
      url: imageTag,
      pubkey: event.pubkey
    })
  }

  // Extract URLs from content (image/video extensions)
  const contentUrls = extractUrlsFromContent(event.content)
  contentUrls.forEach(url => {
    if (!seenUrls.has(url)) {
      seenUrls.add(url)
      media.push({
        url,
        pubkey: event.pubkey
      })
    }
  })

  return media
}

/**
 * Extract URLs from content that look like media files
 */
function extractUrlsFromContent(content: string): string[] {
  const urls: string[] = []
  
  // Match URLs in content
  const urlRegex = /https?:\/\/[^\s<>"']+/g
  const matches = content.match(urlRegex) || []
  
  matches.forEach(url => {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname.toLowerCase()
      
      // Check if it's a media file
      const mediaExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff',
        '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.flv', '.3gp', '.3g2',
        '.mp3', '.wav', '.flac', '.aac', '.m4a', '.mka'
      ]
      
      const isMediaFile = mediaExtensions.some(ext => pathname.endsWith(ext))
      
      if (isMediaFile) {
        urls.push(url)
      }
    } catch {
      // Invalid URL, skip
    }
  })
  
  return urls
}
