import { YouTubePlayer } from '@/types/youtube'
import logger from '@/lib/logger'

type Media = HTMLMediaElement | YouTubePlayer

class MediaManagerService {
  static instance: MediaManagerService

  private currentMedia: Media | null = null

  constructor() {
    if (!MediaManagerService.instance) {
      MediaManagerService.instance = this
    }
    return MediaManagerService.instance
  }

  pause(media: Media | null) {
    if (!media) {
      return
    }
    if (isPipElement(media)) {
      return
    }
    if (this.currentMedia === media) {
      this.currentMedia = null
    }
    pause(media)
  }

  autoPlay(media: Media) {
    if (
      document.pictureInPictureElement &&
      isMediaPlaying(document.pictureInPictureElement as HTMLMediaElement)
    ) {
      return
    }
    this.play(media)
  }

  play(media: Media | null) {
    if (!media) {
      return
    }
    if (document.pictureInPictureElement && document.pictureInPictureElement !== media) {
      ;(document.pictureInPictureElement as HTMLMediaElement).pause()
    }
    if (this.currentMedia && this.currentMedia !== media) {
      pause(this.currentMedia)
    }
    this.currentMedia = media
    if (isMediaPlaying(media)) {
      return
    }

    play(this.currentMedia).catch((error) => {
      const name = error instanceof Error ? error.name : ''
      const msg = error instanceof Error ? error.message : ''
      // Abort: pause / navigation / another element taking over.
      if (name === 'AbortError') return
      // Autoplay policy (user can still press play); muted autoplay usually avoids this.
      if (name === 'NotAllowedError') return
      // Codec / empty resource — surface elsewhere (video onerror); play() adds noise only.
      if (name === 'NotSupportedError') return
      if (/play\(\) request was interrupted|The operation was aborted/i.test(msg)) return
      logger.error('Error playing media', { error })
      this.currentMedia = null
    })
  }
}

const instance = new MediaManagerService()
export default instance

function isYouTubePlayer(media: Media): media is YouTubePlayer {
  return (media as YouTubePlayer).pauseVideo !== undefined
}

function isMediaPlaying(media: Media) {
  if (isYouTubePlayer(media)) {
    return media.getPlayerState() === window.YT.PlayerState.PLAYING
  }
  return media.currentTime > 0 && !media.paused && !media.ended && media.readyState >= 2
}

function isPipElement(media: Media) {
  if (isYouTubePlayer(media)) {
    return false // YouTube players do not support Picture-in-Picture
  }
  if (document.pictureInPictureElement === media) {
    return true
  }
  return (media as any).webkitPresentationMode === 'picture-in-picture'
}

function pause(media: Media) {
  if (isYouTubePlayer(media)) {
    return media.pauseVideo()
  }
  return media.pause()
}

async function play(media: Media) {
  if (isYouTubePlayer(media)) {
    return media.playVideo()
  }
  return media.play()
}
