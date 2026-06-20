import { fetchPageHtml } from '@/lib/fetch-page-html'
import { parseOpenGraphFromHtml } from '@/lib/open-graph'
import { TWebMetadata } from '@/types'
import DataLoader from 'dataloader'
import logger from '@/lib/logger'

class WebService {
  static instance: WebService

  private webMetadataDataLoader = new DataLoader<string, TWebMetadata>(
    async (urls) => {
      return await Promise.all(
        urls.map(async (url) => {
          try {
            const loaded = await fetchPageHtml(url)
            if (!loaded) {
              logger.debug('[WebService] No HTML for OG metadata', { url })
              return {}
            }

            logger.debug('[WebService] Received HTML for OG', {
              url,
              via: loaded.via,
              htmlLength: loaded.html.length
            })

            return parseOpenGraphFromHtml(loaded.html, url)
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
              logger.warn('[WebService] Fetch aborted (timeout)', { url })
            } else {
              logger.error('[WebService] Failed to fetch OG metadata', { url, error })
            }
            return {}
          }
        })
      )
    },
    { maxBatchSize: 16, batchScheduleFn: (callback) => setTimeout(callback, 50) }
  )

  constructor() {
    if (!WebService.instance) {
      WebService.instance = this
    }
    return WebService.instance
  }

  async fetchWebMetadata(url: string) {
    return await this.webMetadataDataLoader.load(url)
  }
}

const instance = new WebService()

export default instance
