/**
 * Pre-upload compression for Blossom / NIP-96: images (WebP/JPEG), audio (MP3), video (WebM).
 *
 * All compression runs entirely on-device (Canvas, Web Audio, bundled lamejs, MediaRecorder).
 * No files or pixels are sent to third-party transcoding services — only your chosen upload
 * step (Blossom / NIP-96) sends the already-compressed blob out.
 *
 * Falls back to the original file when decode, encode, or APIs fail.
 */

import { compressImage } from '@/lib/compress-image'
import logger from '@/lib/logger'

/**
 * Dev always; otherwise set `localStorage.setItem('jumble-upload-log', 'true')` (e.g. for `vite preview`).
 * Uses console.log (not console.info): many browsers hide the "Info" level in DevTools by default, so info looked like "no logs" even in vite dev.
 */
function uploadCompressionDiag(message: string, data?: Record<string, unknown>): void {
  try {
    const enabled =
      import.meta.env.DEV ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('jumble-upload-log') === 'true')
    if (!enabled) return
    if (data !== undefined) console.log(`[compress-upload] ${message}`, data)
    else console.log(`[compress-upload] ${message}`)
  } catch {
    // private mode / no storage
  }
}

const AUDIO_TARGET_SAMPLE_RATE = 44100
const AUDIO_MP3_KBPS = 96
const MP3_FRAME_SAMPLES = 1152

const MAX_VIDEO_DURATION_SEC = 15 * 60
const MAX_VIDEO_WIDTH_PX = 1280
const VIDEO_TARGET_BITRATE_MAX = 2_500_000
/** Floor so short clips don’t balloon vs efficient H.264 in MP4. */
const VIDEO_TARGET_BITRATE_MIN = 450_000
const VIDEO_AUDIO_BITRATE = 96_000

/** Browsers often leave `File.type` empty for some paths; still treat as video. */
const VIDEO_FILENAME_RE = /\.(mp4|m4v|mov|mkv|webm|ogv|avi|mpeg|mpg)$/i

/** Image/audio extensions for drag/drop and paste when `File.type` is empty (common on Linux). */
const IMAGE_FILENAME_RE = /\.(jpe?g|png|gif|webp|bmp|svg|ico|heic|heif|avif)$/i
const AUDIO_FILENAME_RE = /\.(mp3|m4a|mka|wav|ogg|opus|aac|flac|mpeg)$/i

/**
 * True if the file is likely a user media upload (image, video, or audio) from MIME or filename.
 * Use for clipboard/drop filters where `DataTransferItem.type` / `File.type` may be empty.
 */
export function fileLooksLikeUploadableMedia(file: File): boolean {
  const t = file.type
  if (t.startsWith('image/') || t.startsWith('video/') || t.startsWith('audio/')) return true
  if (VIDEO_FILENAME_RE.test(file.name)) return true
  if (IMAGE_FILENAME_RE.test(file.name)) return true
  if (AUDIO_FILENAME_RE.test(file.name)) return true
  return false
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const out = new Int16Array(f32.length)
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]))
    out[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0
  }
  return out
}

function fileLooksLikeMatroskaAudio(file: File): boolean {
  return /\.mka$/i.test(file.name) || file.type === 'audio/x-matroska'
}

async function compressAudioToMp3(file: File, signal?: AbortSignal): Promise<File> {
  if (!file.type.startsWith('audio/') && !fileLooksLikeMatroskaAudio(file)) return file

  const ctx = new AudioContext()
  try {
    const ab = await file.arrayBuffer()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    let audioBuffer: AudioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(ab.slice(0))
    } catch {
      return file
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (audioBuffer.duration <= 0 || !Number.isFinite(audioBuffer.duration)) return file

    const length = Math.ceil(audioBuffer.duration * AUDIO_TARGET_SAMPLE_RATE)
    const offline = new OfflineAudioContext(1, length, AUDIO_TARGET_SAMPLE_RATE)
    const monoSrc = offline.createBuffer(1, audioBuffer.length, audioBuffer.sampleRate)
    if (audioBuffer.numberOfChannels === 1) {
      monoSrc.copyToChannel(audioBuffer.getChannelData(0), 0)
    } else {
      const m = new Float32Array(audioBuffer.length)
      for (let i = 0; i < audioBuffer.length; i++) {
        let s = 0
        for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
          s += audioBuffer.getChannelData(c)[i]
        }
        m[i] = s / audioBuffer.numberOfChannels
      }
      monoSrc.copyToChannel(m, 0)
    }
    const src = offline.createBufferSource()
    src.buffer = monoSrc
    src.connect(offline.destination)
    src.start(0)
    const rendered = await offline.startRendering()
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const pcm = float32ToInt16(rendered.getChannelData(0))
    const { Mp3Encoder } = await import('lamejs')
    const enc = new Mp3Encoder(1, AUDIO_TARGET_SAMPLE_RATE, AUDIO_MP3_KBPS)
    const chunks: BlobPart[] = []

    for (let i = 0; i < pcm.length; i += MP3_FRAME_SAMPLES) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (i % (MP3_FRAME_SAMPLES * 200) === 0) {
        await new Promise((r) => setTimeout(r, 0))
      }
      const block = new Int16Array(MP3_FRAME_SAMPLES)
      const take = Math.min(MP3_FRAME_SAMPLES, pcm.length - i)
      block.set(pcm.subarray(i, i + take))
      const mp3 = enc.encodeBuffer(block)
      if (mp3.length > 0) {
        chunks.push(new Uint8Array(mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength)) as BlobPart)
      }
    }
    const tail = enc.flush()
    if (tail.length > 0) {
      chunks.push(new Uint8Array(tail.buffer.slice(tail.byteOffset, tail.byteOffset + tail.byteLength)) as BlobPart)
    }

    const blob = new Blob(chunks, { type: 'audio/mpeg' })
    if (blob.size === 0 || blob.size >= file.size * 0.97) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'audio'
    return new File([blob], `${base}.mp3`, { type: 'audio/mpeg' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    return file
  } finally {
    await ctx.close().catch(() => {})
  }
}

function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  // Prefer explicit audio codec where supported (better mux with captured audio).
  for (const m of [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4'
  ] as const) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return null
}

function isMediaRecorderAudioMuxUnsupportedError(e: unknown): boolean {
  if (!(e instanceof DOMException) || e.name !== 'NotSupportedError') return false
  const m = (e.message || '').toLowerCase()
  return m.includes('audio') || m.includes('cannot be recorded')
}

function fileLooksLikeVideo(file: File): boolean {
  return file.type.startsWith('video/') || VIDEO_FILENAME_RE.test(file.name)
}

function extensionForRecordedMime(mime: string): string {
  if (mime.includes('mp4')) return '.mp4'
  return '.webm'
}

type VideoElementWithCapture = HTMLVideoElement & {
  captureStream?: () => MediaStream
  mozCaptureStream?: () => MediaStream
}

/** Firefox historically used `mozCaptureStream`; some builds expose capture only on instances, not via `in` on prototype. */
function captureStreamFromVideoElement(video: HTMLVideoElement): MediaStream | null {
  const v = video as VideoElementWithCapture
  if (typeof v.captureStream === 'function') {
    try {
      return v.captureStream()
    } catch {
      /* fall through */
    }
  }
  if (typeof v.mozCaptureStream === 'function') {
    try {
      return v.mozCaptureStream()
    } catch {
      return null
    }
  }
  return null
}

function waitVideoEvent(el: HTMLVideoElement, name: keyof HTMLMediaElementEventMap): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup()
      resolve()
    }
    const onErr = () => {
      cleanup()
      reject(new Error('video error'))
    }
    const cleanup = () => {
      el.removeEventListener(name, onOk)
      el.removeEventListener('error', onErr)
    }
    el.addEventListener(name, onOk, { once: true })
    el.addEventListener('error', onErr, { once: true })
  })
}

async function compressVideoToWebm(file: File, signal?: AbortSignal): Promise<File> {
  if (!fileLooksLikeVideo(file)) return file
  const mime = pickVideoMime()
  if (!mime) {
    uploadCompressionDiag('video skip: no MediaRecorder MIME supported in this browser')
    logger.debug('[compress-upload] MediaRecorder has no supported video MIME in this browser')
    return file
  }
  if (typeof HTMLCanvasElement === 'undefined') {
    return file
  }
  const probeCanvas = document.createElement('canvas')
  if (typeof probeCanvas.captureStream !== 'function') {
    uploadCompressionDiag('video skip: canvas.captureStream not available')
    return file
  }

  const objUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = objUrl
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')

  try {
    await waitVideoEvent(video, 'loadedmetadata')
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const probeStream = captureStreamFromVideoElement(video)
    if (!probeStream) {
      uploadCompressionDiag(
        'video skip: video.captureStream / mozCaptureStream not available (try another browser or disable strict privacy flags)'
      )
      return file
    }
    probeStream.getTracks().forEach((t) => t.stop())

    const { duration, videoWidth, videoHeight } = video
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_DURATION_SEC) {
      uploadCompressionDiag('video skip: bad or too long duration', { duration })
      logger.debug('[compress-upload] video duration skip', { duration })
      return file
    }
    if (videoWidth < 2 || videoHeight < 2) {
      uploadCompressionDiag('video skip: dimensions too small', { videoWidth, videoHeight })
      return file
    }

    const durationSec = Math.max(0.1, duration)
    const sourceBitrate = (file.size * 8) / durationSec
    const primaryVideoBps = Math.min(
      VIDEO_TARGET_BITRATE_MAX,
      Math.max(VIDEO_TARGET_BITRATE_MIN, Math.floor(sourceBitrate * 0.42))
    )

    const seekVideoToStart = async () => {
      video.pause()
      if (video.currentTime < 0.05) return
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked)
          video.removeEventListener('error', onErr)
          resolve()
        }
        const onErr = () => {
          video.removeEventListener('seeked', onSeeked)
          video.removeEventListener('error', onErr)
          reject(new Error('video seek error'))
        }
        video.addEventListener('seeked', onSeeked, { once: true })
        video.addEventListener('error', onErr, { once: true })
        video.currentTime = 0
      })
    }

    const encodePass = async (maxWidthPx: number, videoBitsPerSecond: number): Promise<File | null> => {
      const scale = Math.min(1, maxWidthPx / videoWidth)
      const w = Math.max(2, Math.floor((videoWidth * scale) / 2) * 2)
      const h = Math.max(2, Math.floor((videoHeight * scale) / 2) * 2)

      await seekVideoToStart()

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { alpha: false })
      if (!ctx) return null

      const canvasStream = canvas.captureStream(30)
      const vs = captureStreamFromVideoElement(video)
      const audioTracksFromVideo = vs ? [...vs.getAudioTracks()] : []

      const buildRecorder = (stream: MediaStream) => {
        const chunks: Blob[] = []
        const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond,
          ...(stream.getAudioTracks().length > 0 ? { audioBitsPerSecond: VIDEO_AUDIO_BITRATE } : {})
        })
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }
        const stopped = new Promise<void>((resolve, reject) => {
          recorder.onstop = () => resolve()
          recorder.onerror = () => reject(new Error('MediaRecorder error'))
        })
        return { recorder, chunks, stopped }
      }

      let activeStream: MediaStream =
        audioTracksFromVideo.length > 0
          ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracksFromVideo])
          : new MediaStream([...canvasStream.getVideoTracks()])

      let { recorder: rec, chunks, stopped } = buildRecorder(activeStream)

      try {
        rec.start(250)
      } catch (startErr) {
        if (audioTracksFromVideo.length > 0 && isMediaRecorderAudioMuxUnsupportedError(startErr)) {
          uploadCompressionDiag(
            'video pass: dropping audio (browser cannot mux source audio with this recorder codec)',
            { maxWidthPx, mime, detail: String((startErr as Error).message) }
          )
          audioTracksFromVideo.forEach((t) => t.stop())
          activeStream = new MediaStream([...canvasStream.getVideoTracks()])
          ;({ recorder: rec, chunks, stopped } = buildRecorder(activeStream))
          try {
            rec.start(250)
          } catch (e2) {
            uploadCompressionDiag('video pass: MediaRecorder.start failed after video-only fallback', {
              error: String(e2),
              maxWidthPx
            })
            return null
          }
        } else {
          uploadCompressionDiag('video pass: MediaRecorder.start failed', {
            error: String(startErr),
            maxWidthPx
          })
          return null
        }
      }

      try {
        await video.play()
      } catch (e) {
        uploadCompressionDiag('video pass: play() failed', { error: String(e), maxWidthPx })
        logger.debug('[compress-upload] video.play() failed', { e })
        rec.stop()
        await stopped.catch(() => {})
        return null
      }

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            try {
              ctx.drawImage(video, 0, 0, w, h)
            } catch {
              /* ignore */
            }
            resolve()
          }
          video.addEventListener('ended', finish, { once: true })
          video.addEventListener('error', () => reject(new Error('Video playback error')), { once: true })

          let frames = 0
          const maxFrames = Math.min(Math.ceil(durationSec * 100) + 2000, 500_000)
          /** Yield to the event loop so React can paint (compression is CPU-heavy). */
          const YIELD_EVERY_FRAMES = 30

          const step = () => {
            if (settled) return
            if (signal?.aborted) {
              video.pause()
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            if (video.ended) return
            try {
              ctx.drawImage(video, 0, 0, w, h)
            } catch {
              reject(new Error('drawImage failed'))
              return
            }
            frames++
            if (frames > maxFrames) {
              video.pause()
              finish()
              return
            }
            if (frames % YIELD_EVERY_FRAMES === 0) {
              setTimeout(() => requestAnimationFrame(step), 0)
            } else {
              requestAnimationFrame(step)
            }
          }
          requestAnimationFrame(step)
        })
      } catch (e) {
        rec.stop()
        await stopped.catch(() => {})
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        uploadCompressionDiag('video pass: playback/draw failed', { error: String(e), maxWidthPx })
        return null
      }

      rec.stop()
      await stopped

      const blob = new Blob(chunks, { type: mime })
      if (blob.size === 0) {
        uploadCompressionDiag('video pass: empty blob', { maxWidthPx })
        return null
      }
      if (blob.size >= file.size) {
        uploadCompressionDiag('video pass: output not smaller than source', {
          maxWidthPx,
          inBytes: file.size,
          outBytes: blob.size
        })
        return null
      }

      const base = file.name.replace(/\.[^.]+$/, '') || 'video'
      const ext = extensionForRecordedMime(mime)
      return new File([blob], `${base}${ext}`, { type: mime })
    }

    const attempts: { maxW: number; bps: number }[] = [
      { maxW: MAX_VIDEO_WIDTH_PX, bps: primaryVideoBps },
      { maxW: 854, bps: VIDEO_TARGET_BITRATE_MIN },
      { maxW: 640, bps: VIDEO_TARGET_BITRATE_MIN }
    ]

    for (const { maxW, bps } of attempts) {
      const out = await encodePass(maxW, bps)
      if (out) {
        uploadCompressionDiag('video: re-encoded for upload', {
          inBytes: file.size,
          outBytes: out.size,
          mime,
          maxWidthPx: maxW,
          outName: out.name
        })
        return out
      }
    }

    uploadCompressionDiag('video skip: all passes failed or did not beat source size', {
      inBytes: file.size,
      mime
    })
    logger.debug('[compress-upload] video re-encode: all passes kept original')
    return file
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    uploadCompressionDiag('video skip: encode pipeline error', { error: String(e) })
    logger.debug('[compress-upload] video compress failed', { e })
    return file
  } finally {
    URL.revokeObjectURL(objUrl)
    video.removeAttribute('src')
    video.load()
  }
}

export type CompressMediaOptions = {
  signal?: AbortSignal
  /** Raster images are scaled/encoded until under this size when possible (default 2 MiB — fits typical profile `picture` limits). */
  imageTargetMaxBytes?: number
}

/** Default cap for raster image uploads (profile pics and inline media). */
export const DEFAULT_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/**
 * Compress media before upload. Non-media types are returned unchanged.
 */
export async function compressMediaForUpload(file: File, options?: CompressMediaOptions): Promise<File> {
  const signal = options?.signal
  const imageTarget = options?.imageTargetMaxBytes ?? DEFAULT_IMAGE_UPLOAD_MAX_BYTES

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  let branch: 'image' | 'audio' | 'video' | 'none' = 'none'
  let out: File = file

  if (file.type.startsWith('image/')) {
    branch = 'image'
    out = await compressImage(file, imageTarget)
  } else if (file.type.startsWith('audio/') || fileLooksLikeMatroskaAudio(file)) {
    branch = 'audio'
    out = await compressAudioToMp3(file, signal)
  } else if (fileLooksLikeVideo(file)) {
    branch = 'video'
    out = await compressVideoToWebm(file, signal)
  }

  uploadCompressionDiag('compressMediaForUpload result', {
    branch,
    inName: file.name,
    inBytes: file.size,
    inType: file.type || '(empty)',
    outBytes: out.size,
    outType: out.type || '(empty)',
    outName: out.name,
    changed: out !== file || out.size !== file.size || out.name !== file.name
  })

  return out
}
