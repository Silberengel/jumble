import { useEmojiInfosForEvent, useMediaExtraction } from '@/hooks'
import { parseContent, PARSE_CONTENT_PARSERS_NOTE_TEXT } from '@/lib/content-parser'
import { replaceStandardEmojiShortcodesInContent } from '@/lib/emoji-content'
import { logContentSpacing, reprString } from '@/lib/content-spacing-debug'
import { emojis, shortcodeToEmoji } from '@tiptap/extension-emoji'
import { cn } from '@/lib/utils'
import { getHttpUrlFromITags } from '@/lib/event'
import { httpUrlSkipsBottomWebPreview } from '@/lib/nostr-from-http-url'
import { cleanUrl, isImage, isMedia, isAudio, isVideo, isHlsPlaylistUrl, isPseudoNostrHttpsUrl } from '@/lib/url'
import { lightboxSlideFromImeta } from '@/lib/lightbox-slides'
import { randomString } from '@/lib/random'
import modalManager from '@/services/modal-manager.service'
import { TEmoji, TImetaInfo } from '@/types'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Video from 'yet-another-react-lightbox/plugins/video'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/plugins/captions.css'
import {
  EmbeddedHashtag,
  EmbeddedLNInvoice,
  EmbeddedMention,
  EmbeddedNote,
  EmbeddedWebsocketUrl,
  HttpNostrAwareUrl
} from '../Embedded'
import PaytoLink from '../PaytoLink'
import Emoji from '../Emoji'
import ImageGallery from '../ImageGallery'
import MediaPlayer from '../MediaPlayer'
import SpotifyEmbeddedPlayer from '../SpotifyEmbeddedPlayer'
import YoutubeEmbeddedPlayer from '../YoutubeEmbeddedPlayer'
import ZapStreamLiveEventEmbed from '../ZapStreamLiveEventEmbed'
import WebPreview from '../WebPreview'
import { toNote } from '@/lib/link'
import { YOUTUBE_URL_REGEX } from '@/constants'
import { isSpotifyOpenUrl } from '@/lib/spotify-url'
import { canonicalZapStreamWatchUrl, isZapStreamWatchUrl } from '@/lib/zap-stream-url'
import { shouldDeferLongVideoAutoload } from '@/lib/long-video-load-policy'

// Helper function to check if a URL is a YouTube URL
function isYouTubeUrl(url: string): boolean {
  if (!url) return false
  // Create a new regex instance without global flag for testing
  const flags = YOUTUBE_URL_REGEX.flags.replace('g', '')
  const regex = new RegExp(YOUTUBE_URL_REGEX.source, flags)
  return regex.test(url)
}

const REDIRECT_REGEX = /Read (naddr1[a-z0-9]+) instead\./i

function renderRedirectText(text: string, key: number) {
  const match = text.match(REDIRECT_REGEX)
  if (!match) {
    return text
  }
  const [fullMatch, naddr] = match
  const [prefix, suffix] = text.split(fullMatch)
  const href = toNote(naddr)
  return (
    <span key={`redirect-${key}`}>
      {prefix}
      Read{' '}
      <a
        className="text-primary hover:text-foreground hover:underline underline-offset-2 transition-colors"
        href={href}
        onClick={(e) => e.stopPropagation()}
      >
        {naddr}
      </a>{' '}
      instead.{suffix}
    </span>
  )
}

export default function Content({
  event,
  content,
  className,
  mustLoadMedia
}: {
  event?: Event
  content?: string
  className?: string
  mustLoadMedia?: boolean
}) {
  const _content = event?.content ?? content
  const iArticleUrl = useMemo(() => (event ? getHttpUrlFromITags(event) : undefined), [event])
  const iArticleCleaned = useMemo(
    () => (iArticleUrl ? cleanUrl(iArticleUrl) || iArticleUrl : ''),
    [iArticleUrl]
  )
  const deferLongVideoLoad = shouldDeferLongVideoAutoload(event, {
    forceLoadMedia: mustLoadMedia
  })

  // Use unified media extraction service
  const extractedMedia = useMediaExtraction(event, _content)
  const emojiInfos = useEmojiInfosForEvent(event ?? undefined)

  const customEmojiLightboxId = useMemo(() => `content-custom-emoji-lb-${randomString()}`, [])
  const { customEmojiSlides, customEmojiIndexByCleanedUrl } = useMemo(() => {
    const seen = new Set<string>()
    const ordered: TEmoji[] = []
    for (const e of emojiInfos) {
      const c = cleanUrl(e.url)
      if (!c || seen.has(c)) continue
      seen.add(c)
      ordered.push(e)
    }
    const slides = ordered.map((e) =>
      lightboxSlideFromImeta({ url: e.url, alt: `:${e.shortcode}:` })
    )
    const byUrl = new Map<string, number>()
    ordered.forEach((e, i) => {
      const c = cleanUrl(e.url)
      if (c) byUrl.set(c, i)
    })
    return { customEmojiSlides: slides, customEmojiIndexByCleanedUrl: byUrl }
  }, [emojiInfos])

  const [customEmojiLbIndex, setCustomEmojiLbIndex] = useState(-1)
  const [customEmojiLbPortal, setCustomEmojiLbPortal] = useState(false)

  useEffect(() => {
    if (customEmojiLbIndex >= 0) {
      modalManager.register(customEmojiLightboxId, () => setCustomEmojiLbIndex(-1))
    } else {
      modalManager.unregister(customEmojiLightboxId)
    }
  }, [customEmojiLightboxId, customEmojiLbIndex])

  const openCustomEmojiLightbox = useCallback(
    (emoji: TEmoji) => {
      const c = cleanUrl(emoji.url)
      const idx = c ? customEmojiIndexByCleanedUrl.get(c) : undefined
      if (typeof idx === 'number') {
        setCustomEmojiLbIndex(idx)
        setCustomEmojiLbPortal(true)
      }
    },
    [customEmojiIndexByCleanedUrl]
  )

  const nodes = useMemo(() => {
    if (!_content) return undefined

    const customShortcodes = emojiInfos.map((e) => e.shortcode)
    const normalized = replaceStandardEmojiShortcodesInContent(_content, customShortcodes)
    if (normalized.includes('nostr:')) {
      logContentSpacing('Content:useMemo', {
        rawRepr: reprString(_content),
        normalizedRepr: reprString(normalized),
        same: _content === normalized
      })
    }

    return parseContent(normalized, PARSE_CONTENT_PARSERS_NOTE_TEXT)
  }, [_content, emojiInfos])

  // Extract HTTP/HTTPS links from content nodes (in order of appearance) for WebPreview cards at bottom
  // Exclude YouTube URLs, images, and media (they're rendered separately)
  const contentLinks = useMemo(() => {
    if (!nodes) return []
    const links: string[] = []
    const seenUrls = new Set<string>()
    const appOrigin = typeof window !== 'undefined' ? window.location.origin : null

    nodes.forEach((node) => {
      if (node.type === 'url') {
        const url = node.data
        if (
          (url.startsWith('http://') || url.startsWith('https://')) &&
          !isPseudoNostrHttpsUrl(url) &&
          !isImage(url) &&
          !isMedia(url) &&
          !isHlsPlaylistUrl(url) &&
          !isYouTubeUrl(url) &&
          !isSpotifyOpenUrl(url) &&
          !isZapStreamWatchUrl(url)
        ) {
          const cleaned = cleanUrl(url)
          if (
            cleaned &&
            !seenUrls.has(cleaned) &&
            !(iArticleCleaned && cleaned === iArticleCleaned) &&
            !httpUrlSkipsBottomWebPreview(url, appOrigin)
          ) {
            links.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      }
    })

    return links
  }, [nodes, iArticleCleaned])

  // Extract YouTube URLs from r tags to render as players
  const youtubeUrlsFromTags = useMemo(() => {
    if (!event) return []
    const urls: string[] = []
    const seenUrls = new Set<string>()
    
    // Check if YouTube URL is already in content
    const hasYouTubeInContent = nodes?.some(node => node.type === 'youtube') || false

    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (isYouTubeUrl(url)) {
          const cleaned = cleanUrl(url)
          // Only include if not already in content and not already seen
          if (cleaned && !hasYouTubeInContent && !seenUrls.has(cleaned)) {
            urls.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      })

    return urls
  }, [event, nodes])

  const spotifyUrlsFromTags = useMemo(() => {
    if (!event) return []
    const urls: string[] = []
    const seenUrls = new Set<string>()
    const hasSpotifyInContent = nodes?.some((node) => node.type === 'spotify') || false

    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (isSpotifyOpenUrl(url)) {
          const cleaned = cleanUrl(url)
          if (cleaned && !hasSpotifyInContent && !seenUrls.has(cleaned)) {
            urls.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      })

    return urls
  }, [event, nodes])

  const zapStreamCanonicalInContent = useMemo(() => {
    if (!nodes) return new Set<string>()
    const s = new Set<string>()
    for (const n of nodes) {
      if (n.type !== 'zapstream') continue
      const raw = cleanUrl(n.data) || n.data
      const c = canonicalZapStreamWatchUrl(raw)
      if (c) s.add(c)
    }
    return s
  }, [nodes])

  const zapstreamUrlsFromTags = useMemo(() => {
    if (!event) return []
    const urls: string[] = []
    const seen = new Set<string>()
    event.tags
      .filter((tag) => tag[0] === 'r' && tag[1])
      .forEach((tag) => {
        const url = tag[1]!
        if (!isZapStreamWatchUrl(url)) return
        const canon = canonicalZapStreamWatchUrl(cleanUrl(url) || url)
        if (!canon || zapStreamCanonicalInContent.has(canon) || seen.has(canon)) return
        seen.add(canon)
        urls.push(canon)
      })
    return urls
  }, [event, zapStreamCanonicalInContent])

  // Extract HTTP/HTTPS links from r tags (excluding those already in content, YouTube URLs, images, and media)
  const tagLinks = useMemo(() => {
    if (!event) return []
    const links: string[] = []
    const seenUrls = new Set<string>()
    
    // Create a set of content link URLs for quick lookup
    const contentLinkUrls = new Set(contentLinks)
    
    event.tags
      .filter(tag => tag[0] === 'r' && tag[1])
      .forEach(tag => {
        const url = tag[1]
        if (
          (url.startsWith('http://') || url.startsWith('https://')) &&
          !isPseudoNostrHttpsUrl(url) &&
          !isImage(url) &&
          !isMedia(url) &&
          !isHlsPlaylistUrl(url) &&
          !isYouTubeUrl(url) &&
          !isSpotifyOpenUrl(url) &&
          !isZapStreamWatchUrl(url)
        ) {
          const cleaned = cleanUrl(url)
          // Only include if not already in content links and not already seen in tags
          if (cleaned && !contentLinkUrls.has(cleaned) && !seenUrls.has(cleaned)) {
            links.push(cleaned)
            seenUrls.add(cleaned)
          }
        }
      })

    return links
  }, [event, contentLinks])

  /** Maps, node scan, and tag-vs-content splits — memoized so feed/provider re-renders do not redo O(n²) work per note. */
  const contentMediaLayout = useMemo(() => {
    const imageMap = new Map<string, TImetaInfo>()
    const mediaMap = new Map<string, TImetaInfo>()
    extractedMedia.all.forEach((img: TImetaInfo) => {
      const cleaned = cleanUrl(img.url)
      if (!cleaned) return
      if (img.m?.startsWith('image/')) {
        imageMap.set(cleaned, img)
      } else if (
        img.m?.startsWith('video/') ||
        img.m?.startsWith('audio/') ||
        img.m === 'media/*' ||
        isHlsPlaylistUrl(cleaned)
      ) {
        mediaMap.set(cleaned, img)
      } else if (isImage(cleaned)) {
        imageMap.set(cleaned, img)
      } else if (isMedia(cleaned)) {
        mediaMap.set(cleaned, img)
      }
    })

    if (!nodes || nodes.length === 0) {
      if (
        extractedMedia.images.length === 0 &&
        extractedMedia.videos.length === 0 &&
        extractedMedia.audio.length === 0 &&
        !iArticleUrl
      ) {
        return null
      }
    }

    const pubkey = event?.pubkey
    const mediaInContent = new Set<string>()
    const imagesInContent: TImetaInfo[] = []

    if (nodes && nodes.length > 0) {
      nodes.forEach((node) => {
        if (node.type === 'image') {
          const cleanedUrl = cleanUrl(node.data)
          mediaInContent.add(cleanedUrl)
          const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey }
          if (!imagesInContent.find((img) => img.url === cleanedUrl)) {
            imagesInContent.push(imageInfo)
          }
        } else if (node.type === 'images') {
          const urls = Array.isArray(node.data) ? node.data : [node.data]
          urls.forEach((url) => {
            const cleaned = cleanUrl(url)
            mediaInContent.add(cleaned)
            const imageInfo = imageMap.get(cleaned) || { url: cleaned, pubkey }
            if (!imagesInContent.find((img) => img.url === cleaned)) {
              imagesInContent.push(imageInfo)
            }
          })
        } else if (node.type === 'media') {
          const cleanedUrl = cleanUrl(node.data)
          mediaInContent.add(cleanedUrl)
        } else if (node.type === 'url') {
          const cleanedUrl = cleanUrl(node.data)
          if (isImage(cleanedUrl)) {
            mediaInContent.add(cleanedUrl)
            const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey }
            if (!imagesInContent.find((img) => img.url === cleanedUrl)) {
              imagesInContent.push(imageInfo)
            }
          } else if (isVideo(cleanedUrl) || isHlsPlaylistUrl(cleanedUrl)) {
            mediaInContent.add(cleanedUrl)
          } else if (isAudio(cleanedUrl)) {
            mediaInContent.add(cleanedUrl)
          } else if (isMedia(cleanedUrl)) {
            mediaInContent.add(cleanedUrl)
          }
        }
      })
    }

    const carouselImages = extractedMedia.images.filter((img: TImetaInfo) => {
      const cleaned = cleanUrl(img.url)
      return cleaned && !mediaInContent.has(cleaned)
    })
    const videosFromTags = extractedMedia.videos.filter((video: TImetaInfo) => {
      const cleaned = cleanUrl(video.url)
      return cleaned && !mediaInContent.has(cleaned)
    })
    const audioFromTags = extractedMedia.audio.filter((audio: TImetaInfo) => {
      const cleaned = cleanUrl(audio.url)
      return cleaned && !mediaInContent.has(cleaned)
    })

    return {
      imageMap,
      mediaMap,
      mediaInContent,
      imagesInContent,
      carouselImages,
      videosFromTags,
      audioFromTags
    }
  }, [nodes, extractedMedia, event?.pubkey, iArticleUrl])

  if (!contentMediaLayout) return null

  const {
    imageMap,
    mediaMap,
    mediaInContent,
    imagesInContent,
    carouselImages,
    videosFromTags,
    audioFromTags
  } = contentMediaLayout

  // Track which images/media have been rendered individually to prevent duplicates
  const renderedUrls = new Set<string>()
  
  return (
    <div className={cn('text-wrap break-words whitespace-pre-wrap', className)}>
      {iArticleUrl && (
        <div className="mb-2 max-w-full">
          <WebPreview url={iArticleUrl} className="w-full" />
        </div>
      )}
      {/* Render images that appear in content in a single carousel at the top */}
      {imagesInContent.length > 0 && (
        <ImageGallery
          className="mt-2 mb-4"
          key="content-images-gallery"
          images={imagesInContent}
          start={0}
          end={imagesInContent.length}
          mustLoad={mustLoadMedia}
        />
      )}
      
      {/* Render images/media that aren't in content in a single carousel */}
      {/* This includes images from imeta tags when content is empty */}
      {carouselImages.length > 0 && (
        <ImageGallery
          className="mt-2 mb-4"
          key="tag-images-gallery"
          images={carouselImages}
          start={0}
          end={carouselImages.length}
          mustLoad={mustLoadMedia}
        />
      )}
      
      {/* Render videos from tags that don't appear in content */}
      {videosFromTags.map((video) => (
        <div key={`tag-video-${video.url}`} className="mt-2 w-full max-w-full overflow-hidden">
          <MediaPlayer
            src={video.url}
            className="w-full max-w-full"
            mustLoad={mustLoadMedia}
            deferLoadUntilClick={deferLongVideoLoad}
            poster={video.image || video.thumb}
            blurHash={video.blurHash}
          />
        </div>
      ))}
      
      {/* Render audio from tags that don't appear in content */}
      {audioFromTags.map((audio) => (
        <MediaPlayer
          key={`tag-audio-${audio.url}`}
          src={audio.url}
          className="mt-2"
          mustLoad={mustLoadMedia}
          poster={audio.thumb}
          blurHash={audio.blurHash}
        />
      ))}
      
      {/* Render YouTube URLs from r tags that don't appear in content */}
      {youtubeUrlsFromTags.map((url) => (
        <YoutubeEmbeddedPlayer
          key={`tag-youtube-${url}`}
          url={url}
          className="mt-2"
          mustLoad={mustLoadMedia}
        />
      ))}

      {spotifyUrlsFromTags.map((url) => (
        <SpotifyEmbeddedPlayer
          key={`tag-spotify-${url}`}
          url={url}
          className="mt-2"
          mustLoad={mustLoadMedia}
        />
      ))}

      {zapstreamUrlsFromTags.map((url) => (
        <ZapStreamLiveEventEmbed
          key={`tag-zapstream-${url}`}
          url={url}
          className="mt-2"
          containingEvent={event}
          showFull={mustLoadMedia}
        />
      ))}
      
      {nodes && nodes.length > 0 && nodes.map((node, index) => {
        if (node.type === 'text') {
          // Skip only completely empty text nodes, but preserve whitespace (important for spacing)
          if (!node.data || node.data.length === 0) {
            return null
          }
          return renderRedirectText(node.data, index)
        }
        // Skip image nodes - they're rendered in the carousel at the top
        if (node.type === 'image' || node.type === 'images') {
          return null
        }
        // Render media individually in their content position
        if (node.type === 'media') {
          const cleanedUrl = cleanUrl(node.data)
          // Skip if already rendered
          if (renderedUrls.has(cleanedUrl)) {
            return null
          }
          renderedUrls.add(cleanedUrl)
          const tagMediaInfo = mediaMap.get(cleanedUrl)
          return (
            <MediaPlayer
              className="mt-2"
              key={index}
              src={cleanedUrl}
              mustLoad={mustLoadMedia}
              deferLoadUntilClick={deferLongVideoLoad}
              poster={tagMediaInfo?.image || tagMediaInfo?.thumb}
              blurHash={tagMediaInfo?.blurHash}
            />
          )
        }
        if (node.type === 'url') {
          const cleanedUrl = cleanUrl(node.data)
          // Check if it's an image, video, or audio that should be rendered inline
          const isImageUrl = isImage(cleanedUrl)
          const isVideoUrl = isVideo(cleanedUrl)
          const isAudioUrl = isAudio(cleanedUrl)
          
          // Skip if already rendered (regardless of type)
          if (renderedUrls.has(cleanedUrl)) {
            return null
          }
          
          // Check video/audio/HLS first - never put them in ImageGallery
          if (isVideoUrl || isAudioUrl || isHlsPlaylistUrl(cleanedUrl) || mediaMap.has(cleanedUrl)) {
            renderedUrls.add(cleanedUrl)
            const mediaInfo = mediaMap.get(cleanedUrl)
            const poster = mediaInfo?.image || mediaInfo?.thumb
            return (
              <MediaPlayer
                className="mt-2"
                key={`url-media-${index}`}
                src={cleanedUrl}
                mustLoad={mustLoadMedia}
                deferLoadUntilClick={deferLongVideoLoad}
                poster={poster}
                blurHash={mediaInfo?.blurHash}
              />
            )
          }
          
          // Skip image URLs - they're rendered in the carousel at the top if they're in content
          // Only render if they're NOT in content (from r tags, etc.)
          if (isImageUrl) {
            // If it's in content, skip it (already in carousel)
            if (mediaInContent.has(cleanedUrl)) {
              return null
            }
            // Otherwise it's an image from r tags not in content, render it
            renderedUrls.add(cleanedUrl)
            const imageInfo = imageMap.get(cleanedUrl) || { url: cleanedUrl, pubkey: event?.pubkey }
            return (
              <ImageGallery
                className="mt-2"
                key={`url-img-${index}`}
                images={[imageInfo]}
                start={0}
                end={1}
                mustLoad={mustLoadMedia}
              />
            )
          }
          // Regular URL, not an image or media - show WebPreview (skip if same as i-tag article)
          if (iArticleCleaned && cleanedUrl === iArticleCleaned) {
            return null
          }
          return (
            <HttpNostrAwareUrl
              key={index}
              url={node.data}
              renderMode="note-content"
              containingEvent={event}
            />
          )
        }
        if (node.type === 'invoice') {
          return <EmbeddedLNInvoice invoice={node.data} key={index} className="mt-2" />
        }
        if (node.type === 'payto') {
          return (
            <PaytoLink key={index} paytoUri={node.data} />
          )
        }
        if (node.type === 'websocket-url') {
          return <EmbeddedWebsocketUrl url={node.data} key={index} />
        }
        if (node.type === 'event') {
          const id = node.data.split(':')[1]
          return <EmbeddedNote key={index} noteId={id} className="mt-2" containingEvent={event} />
        }
        if (node.type === 'mention') {
          return <EmbeddedMention key={index} userId={node.data.split(':')[1]} />
        }
        if (node.type === 'hashtag') {
          return <EmbeddedHashtag hashtag={node.data} key={index} />
        }
        if (node.type === 'emoji') {
          const shortcode = node.data.slice(1, -1).trim()
          const emoji = emojiInfos.find((e) => e.shortcode === shortcode)
          if (emoji) {
            const canOpen = customEmojiIndexByCleanedUrl.has(cleanUrl(emoji.url) || '')
            return (
              <Emoji
                classNames={{ img: 'mb-1' }}
                emoji={emoji}
                key={index}
                onImageClick={canOpen ? () => openCustomEmojiLightbox(emoji) : undefined}
              />
            )
          }
          const native = shortcodeToEmoji(shortcode, emojis) ?? shortcodeToEmoji(shortcode.replace(/\s+/g, '_'), emojis)
          if (native?.emoji) return <Emoji classNames={{ img: 'mb-1' }} emoji={native.emoji} key={index} />
          return <span key={index}>{node.data}</span>
        }
        if (node.type === 'youtube') {
          return (
            <YoutubeEmbeddedPlayer
              key={index}
              url={node.data}
              className="mt-2"
              mustLoad={mustLoadMedia}
            />
          )
        }
        if (node.type === 'spotify') {
          return (
            <SpotifyEmbeddedPlayer
              key={index}
              url={node.data}
              className="mt-2"
              mustLoad={mustLoadMedia}
            />
          )
        }
        if (node.type === 'zapstream') {
          return (
            <ZapStreamLiveEventEmbed
              key={index}
              url={node.data}
              className="mt-2"
              containingEvent={event}
              showFull={mustLoadMedia}
            />
          )
        }
        return null
      })}

      {/* WebPreview cards for links from content (in order of appearance) */}
      {contentLinks.length > 0 && (
        <div className="space-y-3 mt-6 pt-4 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Links</h3>
          {contentLinks.map((url, index) => (
            <WebPreview key={`content-${index}-${url}`} url={url} className="w-full" />
          ))}
        </div>
      )}

      {/* WebPreview cards for links from tags */}
      {tagLinks.length > 0 && (
        <div className="space-y-3 mt-6 pt-4 border-t">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Related Links</h3>
          {tagLinks.map((url, index) => (
            <WebPreview key={`tag-${index}-${url}`} url={url} className="w-full" />
          ))}
        </div>
      )}

      {customEmojiLbPortal &&
        customEmojiSlides.length > 0 &&
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
              index={customEmojiLbIndex}
              slides={customEmojiSlides}
              plugins={[Video, Zoom, Captions]}
              open={customEmojiLbIndex >= 0}
              close={() => setCustomEmojiLbIndex(-1)}
              on={{
                exited: () => setCustomEmojiLbPortal(false)
              }}
              controller={{
                closeOnBackdropClick: false,
                closeOnPullUp: true,
                closeOnPullDown: true
              }}
              render={{
                buttonPrev: customEmojiSlides.length <= 1 ? () => null : undefined,
                buttonNext: customEmojiSlides.length <= 1 ? () => null : undefined
              }}
              styles={{
                toolbar: { paddingTop: '2.25rem' }
              }}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
