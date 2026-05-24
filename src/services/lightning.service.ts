import {
  CODY_PUBKEY,
  FAST_READ_RELAY_URLS,
  IMWALD_MAINTAINER_PUBKEY
} from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { closeModal, init, launchPaymentModal } from '@getalby/bitcoin-connect-react'
import {
  isNwcWalletServiceInfoError,
  sendWebLNPaymentWithRetry
} from '@/lib/webln-payment'
import { bech32 } from '@scure/base'
import { WebLNProvider } from '@webbtc/webln-types'
import dayjs from 'dayjs'
import { kinds, NostrEvent } from 'nostr-tools'
import { utf8Decoder } from 'nostr-tools/utils'

import { queryService } from './client.service'
import { clampZapSats } from '@/lib/lightning'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { buildLnurlPayCallbackUrl, parseLnurlCommentAllowed } from '@/lib/lnurl-pay'
import logger from '@/lib/logger'
import { runAfterReleasingRadixScrollLock } from '@/lib/react-remove-scroll-body-cleanup'

export type TRecentSupporter = { pubkey: string; amount: number; comment?: string }

export type PaymentFlowResult = { preimage: string; invoice: string } | null

/** LNURL-pay limits from the recipient’s `.well-known/lnurlp` metadata. */
export type LnurlPayInvoiceOptions = {
  /** Max description length; `0` means the endpoint does not accept comments. */
  commentAllowed: number
  minSendableMsat?: number
  maxSendableMsat?: number
}

const OFFICIAL_PUBKEYS = [IMWALD_MAINTAINER_PUBKEY, CODY_PUBKEY]

class LightningService {
  static instance: LightningService
  provider: WebLNProvider | null = null
  private recentSupportersCache: TRecentSupporter[] | null = null
  private lnurlPayMetadataCache = new Map<
    string,
    { fetchedAt: number; meta: NonNullable<Awaited<ReturnType<LightningService['resolveLnurlPayMetadata']>>> }
  >()

  constructor() {
    if (!LightningService.instance) {
      LightningService.instance = this
      init({
        appName: 'Imwald',
        showBalance: false
      })
    }
    return LightningService.instance
  }

  async zap(
    sender: string,
    recipientOrEvent: string | NostrEvent,
    sats: number,
    comment: string,
    closeOuterModel?: () => void,
    onPaymentFlowComplete?: (result: PaymentFlowResult) => void,
    zapLightning?: { address?: string; candidates?: string[] }
  ): Promise<PaymentFlowResult> {
    void sender
    void recipientOrEvent
    void sats
    void comment
    void closeOuterModel
    void onPaymentFlowComplete
    void zapLightning
    throw new Error('NIP-57 zaps are not supported; use payment targets or LNURL-pay invoices')
  }

  async payInvoice(
    invoice: string,
    closeOuterModel?: () => void,
    onPaymentFlowComplete?: (result: PaymentFlowResult) => void
  ): Promise<PaymentFlowResult> {
    if (this.provider) {
      try {
        const { preimage } = await sendWebLNPaymentWithRetry(this.provider, invoice)
        closeOuterModel?.()
        const result = { preimage, invoice }
        onPaymentFlowComplete?.(result)
        return result
      } catch (error) {
        if (!isNwcWalletServiceInfoError(error)) {
          throw error
        }
      }
    }

    return new Promise((resolve) => {
      runAfterReleasingRadixScrollLock(closeOuterModel, () => {
        closeModal()
        launchPaymentModal({
          invoice: invoice,
          onPaid: (response) => {
            const result = { preimage: response.preimage, invoice: invoice }
            onPaymentFlowComplete?.(result)
            resolve(result)
          },
          onCancelled: () => {
            onPaymentFlowComplete?.(null)
            resolve(null)
          }
        })
      })
    })
  }

  async fetchRecentSupporters() {
    if (this.recentSupportersCache) {
      return this.recentSupportersCache
    }
    // Privacy: Use defaults instead of fetching CODY_PUBKEY's relays
    const events = await queryService.fetchEvents(FAST_READ_RELAY_URLS.slice(0, 4), {
      authors: ['79f00d3f5a19ec806189fcab03c1be4ff81d18ee4f653c88fac41fe03570f432'], // alby
      kinds: [kinds.Zap],
      '#p': OFFICIAL_PUBKEYS,
      since: dayjs().subtract(1, 'month').unix()
    })
    events.sort((a, b) => b.created_at - a.created_at)
    const map = new Map<string, { pubkey: string; amount: number; comment?: string }>()
    events.forEach((event) => {
      const info = getZapInfoFromEvent(event)
      if (!info || !info.senderPubkey || OFFICIAL_PUBKEYS.includes(info.senderPubkey)) return

      const { amount, comment, senderPubkey } = info
      const item = map.get(senderPubkey)
      if (!item) {
        map.set(senderPubkey, { pubkey: senderPubkey, amount, comment })
      } else {
        item.amount += amount
        if (!item.comment && comment) item.comment = comment
      }
    })
    this.recentSupportersCache = Array.from(map.values())
      .filter((item) => item.amount >= 1000)
      .sort((a, b) => b.amount - a.amount)
    return this.recentSupportersCache
  }

  /**
   * LNURL-pay metadata for a lightning address (LUD-16 or lnurl bech32).
   * Does not require Nostr zap support — use {@link createLnurlInvoice} for plain invoices.
   */
  async getLnurlPayInvoiceOptions(lightningAddress: string): Promise<LnurlPayInvoiceOptions | null> {
    const meta = await this.resolveLnurlPayMetadata(lightningAddress)
    if (!meta) return null
    return {
      commentAllowed: meta.commentAllowed,
      minSendableMsat: meta.minSendable,
      maxSendableMsat: meta.maxSendable
    }
  }

  async createLnurlInvoice(
    lightningAddress: string,
    sats: number,
    options?: { description?: string }
  ): Promise<string> {
    const meta = await this.resolveLnurlPayMetadata(lightningAddress)
    if (!meta) {
      throw new Error('Lightning address could not be resolved')
    }
    const clamped = clampZapSats(sats)
    if (clamped < 1) {
      throw new Error('Amount must be at least 1 sat')
    }
    const amountMsat = clamped * 1000
    if (meta.minSendable != null && amountMsat < meta.minSendable) {
      throw new Error(`Minimum amount is ${Math.ceil(meta.minSendable / 1000)} sats`)
    }
    if (meta.maxSendable != null && amountMsat > meta.maxSendable) {
      throw new Error(`Maximum amount is ${Math.floor(meta.maxSendable / 1000)} sats`)
    }

    const description = options?.description?.trim() ?? ''
    if (description) {
      if (meta.commentAllowed < 1) {
        throw new Error('This Lightning address does not accept payment descriptions')
      }
      if (description.length > meta.commentAllowed) {
        throw new Error(`Description must be at most ${meta.commentAllowed} characters`)
      }
    }

    // Plain LNURL-pay only — never NIP-57 (`nostr`); relay-visible zap receipts use {@link zap} when enabled.
    const payParams: Record<string, string> = { amount: String(amountMsat) }
    if (description) {
      payParams.comment = description
    }

    const res = await fetchWithTimeout(buildLnurlPayCallbackUrl(meta.callback, payParams), {
      timeoutMs: 25_000
    })
    const body = (await res.json()) as { pr?: string; reason?: string; error?: string; message?: string }
    if (body.error) {
      throw new Error(body.message ?? String(body.error))
    }
    if (!body.pr) {
      throw new Error(body.reason ?? 'Failed to create invoice')
    }
    return body.pr
  }

  private async resolveLnurlPayMetadata(lightningAddress: string): Promise<null | {
    callback: string
    lnurl: string
    allowsNostr: boolean
    nostrPubkey?: string
    commentAllowed: number
    minSendable?: number
    maxSendable?: number
  }> {
    const cacheKey = lightningAddress.trim().toLowerCase()
    const cached = this.lnurlPayMetadataCache.get(cacheKey)
    if (cached && Date.now() - cached.fetchedAt < 30_000) {
      return cached.meta
    }

    try {
      let lnurl = ''

      if (lightningAddress.includes('@')) {
        const [name, domain] = lightningAddress.split('@')
        if (!name?.trim() || !domain?.trim()) return null
        lnurl = new URL(`/.well-known/lnurlp/${name}`, `https://${domain}`).toString()
      } else {
        const { words } = bech32.decode(lightningAddress as any, 1000)
        const data = bech32.fromWords(words)
        lnurl = utf8Decoder.decode(data)
      }

      const res = await fetchWithTimeout(lnurl, { timeoutMs: 15_000 })
      if (!res.ok) {
        logger.warn('LNURL-pay metadata HTTP error', {
          status: res.status,
          statusText: res.statusText,
          lnurl,
          lightningAddress
        })
        return null
      }

      const text = await res.text()
      let body: {
        allowsNostr?: unknown
        nostrPubkey?: unknown
        callback?: unknown
        commentAllowed?: unknown
        minSendable?: unknown
        maxSendable?: unknown
      }
      try {
        body = JSON.parse(text) as typeof body
      } catch {
        logger.warn('LNURL-pay metadata was not valid JSON (HTML error page or empty redirect target?)', {
          lnurl,
          lightningAddress,
          preview: text.slice(0, 160)
        })
        return null
      }

      if (typeof body.callback !== 'string' || !body.callback) return null

      const commentAllowed = parseLnurlCommentAllowed(body.commentAllowed)

      const meta = {
        callback: body.callback,
        lnurl,
        allowsNostr: Boolean(body.allowsNostr && body.nostrPubkey),
        nostrPubkey: typeof body.nostrPubkey === 'string' ? body.nostrPubkey : undefined,
        commentAllowed,
        minSendable: typeof body.minSendable === 'number' ? body.minSendable : undefined,
        maxSendable: typeof body.maxSendable === 'number' ? body.maxSendable : undefined
      }
      this.lnurlPayMetadataCache.set(cacheKey, { fetchedAt: Date.now(), meta })
      return meta
    } catch (err) {
      const failedFetch =
        err instanceof TypeError || (err instanceof Error && err.message === 'Failed to fetch')
      logger.error('Failed to resolve LNURL from profile', {
        error: err,
        lightningAddress,
        /** Browser blocks reading cross-origin LNURL without `Access-Control-Allow-Origin`. */
        hint: typeof window !== 'undefined' && failedFetch ? 'possible_missing_cors_on_lnurl_host' : undefined
      })
    }

    return null
  }
}

const instance = new LightningService()
export default instance
