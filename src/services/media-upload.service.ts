/** Compression runs entirely in-app before upload (`compress-upload-media`). */
import { compressMediaForUpload } from '@/lib/compress-upload-media'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import logger from '@/lib/logger'
import {
  buildClientNip94Pairs,
  extractVideoNip94Preview,
  mergeNip94Pairs,
  nip94PairsToImetaTag
} from '@/lib/upload-nip94-imeta'
import { simplifyUrl } from '@/lib/url'
import { TDraftEvent, TMediaUploadServiceConfig } from '@/types'
import { BlossomClient } from 'blossom-client-sdk'
import { z } from 'zod'
import client from './client.service'
import storage from './local-storage.service'

type UploadOptions = {
  onProgress?: (progressPercent: number) => void
  signal?: AbortSignal
  /** Fires synchronously before client-side compression (images/audio/video). */
  onCompressStart?: () => void
  /** Fires after compression finishes (or throws), before the HTTP upload. */
  onCompressEnd?: () => void
  /** 0–100 during local compression (encode), not network upload. */
  onCompressProgress?: (percent: number) => void
  /**
   * Reject when the compressed file size (bytes sent to the server) exceeds this limit.
   * Checked after `compressMediaForUpload`, before HTTP upload.
   */
  maxCompressedSizeMb?: number
}

export const UPLOAD_ABORTED_ERROR_MSG = 'Upload aborted'

class MediaUploadService {
  static instance: MediaUploadService

  private serviceConfig: TMediaUploadServiceConfig = storage.getMediaUploadServiceConfig()
  private nip96ServiceUploadUrlMap = new Map<string, string | undefined>()
  private imetaTagMap = new Map<string, string[]>()

  constructor() {
    if (!MediaUploadService.instance) {
      MediaUploadService.instance = this
    }
    return MediaUploadService.instance
  }

  setServiceConfig(config: TMediaUploadServiceConfig) {
    this.serviceConfig = config
  }

  async upload(file: File, options?: UploadOptions) {
    options?.onCompressStart?.()
    let toUpload: File
    try {
      toUpload = await compressMediaForUpload(file, {
        signal: options?.signal,
        onCompressProgress: options?.onCompressProgress
      })
    } finally {
      options?.onCompressEnd?.()
    }

    if (
      options?.maxCompressedSizeMb !== undefined &&
      toUpload.size > options.maxCompressedSizeMb * 1024 * 1024
    ) {
      const mb = (toUpload.size / (1024 * 1024)).toFixed(1)
      throw new Error(
        `After compression the file is ${mb} MB; maximum allowed is ${options.maxCompressedSizeMb} MB.`
      )
    }

    try {
      const diag =
        import.meta.env.DEV ||
        (typeof localStorage !== 'undefined' && localStorage.getItem('jumble-upload-log') === 'true')
      if (diag) {
        console.log('[media-upload] sending to server', {
          backend: this.serviceConfig.type,
          bytes: toUpload.size,
          name: toUpload.name,
          type: toUpload.type || '(empty)'
        })
      }
    } catch {
      // ignore
    }

    const videoPreviewPromise =
      toUpload.type.startsWith('video/') ? extractVideoNip94Preview(toUpload) : Promise.resolve(null)

    const uploadPromise =
      this.serviceConfig.type === 'nip96'
        ? this.uploadByNip96(this.serviceConfig.service, toUpload, options)
        : this.uploadByBlossom(toUpload, options)

    const [videoPreview, result] = await Promise.all([videoPreviewPromise, uploadPromise])

    const clientPairs = await buildClientNip94Pairs(toUpload, result.url, videoPreview)

    if (videoPreview?.posterJpeg) {
      try {
        const posterResult =
          this.serviceConfig.type === 'nip96'
            ? await this.uploadByNip96(this.serviceConfig.service, videoPreview.posterJpeg, options)
            : await this.uploadByBlossom(videoPreview.posterJpeg, options)
        clientPairs.push(['image', posterResult.url], ['thumb', posterResult.url])
      } catch (e) {
        logger.warn('Video poster frame upload failed; imeta may omit image/thumb', {
          error: String(e)
        })
      }
    }

    const mergedTags = mergeNip94Pairs(clientPairs, result.tags)
    this.imetaTagMap.set(result.url, nip94PairsToImetaTag(mergedTags))
    return { url: result.url, tags: mergedTags }
  }

  private async uploadByBlossom(file: File, options?: UploadOptions) {
    const pubkey = client.pubkey
    const signer = async (draft: TDraftEvent) => {
      if (!client.signer) {
        throw new Error('You need to be logged in to upload media')
      }
      return client.signer.signEvent(draft)
    }
    if (!pubkey) {
      throw new Error('You need to be logged in to upload media')
    }

    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }

    options?.onProgress?.(0)

    // Pseudo-progress: advance gradually until main upload completes
    let pseudoProgress = 1
    let pseudoTimer: number | undefined
    const startPseudoProgress = () => {
      if (pseudoTimer !== undefined) return
      pseudoTimer = window.setInterval(() => {
        // Cap pseudo progress to 90% until we get real completion
        pseudoProgress = Math.min(pseudoProgress + 3, 90)
        options?.onProgress?.(pseudoProgress)
        if (pseudoProgress >= 90) {
          stopPseudoProgress()
        }
      }, 300)
    }
    const stopPseudoProgress = () => {
      if (pseudoTimer !== undefined) {
        clearInterval(pseudoTimer)
        pseudoTimer = undefined
      }
    }
    startPseudoProgress()

    const servers = await client.fetchBlossomServerList(pubkey)
    if (servers.length === 0) {
      throw new Error('No Blossom services available')
    }
    const [mainServer, ...mirrorServers] = servers

    const auth = await BlossomClient.createUploadAuth(signer, file, {
      message: 'Uploading media file'
    })

    // first upload blob to main server
    const blob = await BlossomClient.uploadBlob(mainServer, file, { auth })
    // Main upload finished
    stopPseudoProgress()
    options?.onProgress?.(80)

    if (mirrorServers.length > 0) {
      await Promise.allSettled(
        mirrorServers.map((server) => BlossomClient.mirrorBlob(server, blob, { auth }))
      )
    }

    let tags: string[][] = []
    const parseResult = z.array(z.array(z.string())).safeParse((blob as any).nip94 ?? [])
    if (parseResult.success) {
      tags = parseResult.data
    }

    options?.onProgress?.(100)
    return { url: blob.url, tags }
  }

  private async uploadByNip96(service: string, file: File, options?: UploadOptions) {
    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }
    let uploadUrl = this.nip96ServiceUploadUrlMap.get(service)
    if (!uploadUrl) {
      const response = await fetchWithTimeout(`${service}/.well-known/nostr/nip96.json`, {
        signal: options?.signal,
        timeoutMs: 15_000
      })
      if (!response.ok) {
        throw new Error(
          `${simplifyUrl(service)} does not work, please try another service in your settings`
        )
      }
      const data = await response.json()
      uploadUrl = data?.api_url
      if (!uploadUrl) {
        throw new Error(
          `${simplifyUrl(service)} does not work, please try another service in your settings`
        )
      }
      this.nip96ServiceUploadUrlMap.set(service, uploadUrl)
    }

    if (options?.signal?.aborted) {
      throw new Error(UPLOAD_ABORTED_ERROR_MSG)
    }
    const formData = new FormData()
    formData.append('file', file)

    const auth = await client.signHttpAuth(uploadUrl, 'POST', 'Uploading media file')

    // Use XMLHttpRequest for upload progress support
    const result = await new Promise<{ url: string; tags: string[][] }>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', uploadUrl as string)
      xhr.responseType = 'json'
      xhr.setRequestHeader('Authorization', auth)

      let pseudoTimer: number | undefined
      let pseudo = 0
      const stopPseudo = () => {
        if (pseudoTimer !== undefined) {
          window.clearInterval(pseudoTimer)
          pseudoTimer = undefined
        }
      }
      const startPseudo = () => {
        if (pseudoTimer !== undefined) return
        pseudoTimer = window.setInterval(() => {
          pseudo = Math.min(pseudo + 2, 92)
          options?.onProgress?.(pseudo)
        }, 220)
      }

      const handleAbort = () => {
        stopPseudo()
        try {
          xhr.abort()
        } catch {
          // ignore
        }
        reject(new Error(UPLOAD_ABORTED_ERROR_MSG))
      }
      if (options?.signal) {
        if (options.signal.aborted) {
          return handleAbort()
        }
        options.signal.addEventListener('abort', handleAbort, { once: true })
      }

      options?.onProgress?.(0)
      startPseudo()

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          stopPseudo()
          const percent = Math.round((event.loaded / event.total) * 100)
          options?.onProgress?.(percent)
        }
      }
      xhr.onerror = () => {
        stopPseudo()
        reject(new Error('Network error'))
      }
      xhr.onload = () => {
        stopPseudo()
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = xhr.response
          try {
            const tags = z.array(z.array(z.string())).parse(data?.nip94_event?.tags ?? [])
            const url = tags.find(([tagName]: string[]) => tagName === 'url')?.[1]
            if (url) {
              options?.onProgress?.(100)
              resolve({ url, tags })
            } else {
              reject(new Error('No url found'))
            }
          } catch (e) {
            reject(e as Error)
          }
        } else {
          reject(new Error(xhr.status.toString() + ' ' + xhr.statusText))
        }
      }
      xhr.send(formData)
    })

    return result
  }

  getImetaTagByUrl(url: string) {
    return this.imetaTagMap.get(url)
  }
}

const instance = new MediaUploadService()
export default instance
