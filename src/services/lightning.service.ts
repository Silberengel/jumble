import {
  CODY_PUBKEY,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  IMWALD_MAINTAINER_PUBKEY
} from '@/constants'
import { getProfileFromEvent, getZapInfoFromEvent } from '@/lib/event-metadata'
import { closeModal, init, launchPaymentModal } from '@getalby/bitcoin-connect-react'
import { sendWebLNPaymentWithRetryAndTimeout } from '@/lib/webln-payment'
import { Invoice } from '@getalby/lightning-tools'
import { bech32 } from '@scure/base'
import { WebLNProvider } from '@webbtc/webln-types'
import dayjs from 'dayjs'
import { Filter, kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { utf8Decoder } from 'nostr-tools/utils'

import client, { queryService, replaceableEventService } from './client.service'
import { clampZapSats } from '@/lib/lightning'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { buildLnurlPayCallbackUrl, parseLnurlCommentAllowed } from '@/lib/lnurl-pay'
import { buildZapRequestDraft, encodeLnurlBech32 } from '@/lib/nip57-zap'
import { prioritizeZapLightningAddress } from '@/lib/merge-payment-methods'
import logger from '@/lib/logger'
import { runAfterReleasingRadixScrollLock } from '@/lib/react-remove-scroll-body-cleanup'
import storage from '@/services/local-storage.service'
import { TProfile } from '@/types'

export type TRecentSupporter = { pubkey: string; amount: number; comment?: string }

export type PaymentFlowResult = {
  preimage: string
  invoice: string
  /** Set when we waited for a kind 9735 receipt on relays (null = none seen in time). */
  zapReceipt?: NostrEvent | null
} | null

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
    { fetchedAt: number; meta: Awaited<ReturnType<LightningService['resolveLnurlPayMetadata']>> }
  >()
  private nip57EnabledAddressCache = new Map<string, { fetchedAt: number; addrs: string[] }>()

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
    if (!client.signer) {
      throw new Error('You need to be logged in to zap')
    }
    const clampedSats = clampZapSats(sats)
    if (clampedSats < 1) {
      throw new Error('Amount must be at least 1 sat')
    }

    const { recipient, event } =
      typeof recipientOrEvent === 'string'
        ? { recipient: recipientOrEvent }
        : { recipient: recipientOrEvent.pubkey, event: recipientOrEvent }

    const [profile, senderRelayList] = await Promise.all([
      (async () => {
        const profileEvent = await replaceableEventService.fetchReplaceableEvent(recipient, kinds.Metadata)
        return profileEvent ? getProfileFromEvent(profileEvent) : undefined
      })(),
      sender
        ? client.fetchRelayList(sender)
        : Promise.resolve({ read: FAST_READ_RELAY_URLS, write: FAST_WRITE_RELAY_URLS })
    ])
    if (!profile) {
      throw new Error('Recipient not found')
    }

    const zapEndpoint = await this.getZapEndpoint(profile, zapLightning)
    if (!zapEndpoint) {
      throw new Error("Recipient's lightning address does not support NIP-57 zaps")
    }
    const { callback, lnurlBech32 } = zapEndpoint
    const amount = clampedSats * 1000
    const relays = storage.getIncludePublicZapReceipt()
      ? senderRelayList.write.concat(FAST_READ_RELAY_URLS).slice(0, 8)
      : []

    const zapRequestDraft = buildZapRequestDraft({
      target: event ? { pubkey: recipient, event } : { pubkey: recipient },
      amountMsat: amount,
      lnurlBech32,
      relays,
      comment
    })
    const zapRequest = await client.signer.signEvent(zapRequestDraft)
    const zapRequestUrl = buildLnurlPayCallbackUrl(callback, {
      amount: String(amount),
      nostr: JSON.stringify(zapRequest),
      lnurl: lnurlBech32
    })
    const zapRequestRes = await fetchWithTimeout(zapRequestUrl, { timeoutMs: 25_000 })
    const zapRequestResBody = (await zapRequestRes.json()) as {
      pr?: string
      verify?: string
      reason?: string
      error?: string
      message?: string
    }
    if (zapRequestResBody.error) {
      throw new Error(zapRequestResBody.message ?? String(zapRequestResBody.error))
    }
    const { pr, verify, reason } = zapRequestResBody
    if (!pr) {
      throw new Error(reason ?? 'Failed to create invoice')
    }

    if (this.provider) {
      try {
        const { preimage } = await sendWebLNPaymentWithRetryAndTimeout(this.provider, pr)
        closeOuterModel?.()
        const zapReceipt =
          relays.length > 0
            ? await this.waitForZapReceipt({
                recipient,
                event,
                invoice: pr,
                relayUrls: relays
              })
            : undefined
        const result: PaymentFlowResult = { preimage, invoice: pr, zapReceipt }
        onPaymentFlowComplete?.(result)
        return result
      } catch (error) {
        logger.info('WebLN zap payment unavailable, falling back to invoice UI', { error })
      }
    }

    return new Promise((resolve) => {
      runAfterReleasingRadixScrollLock(closeOuterModel, () => {
        closeModal()
        let checkPaymentInterval: ReturnType<typeof setInterval> | undefined
        let subCloser: SubCloser | undefined
        const finish = async (result: PaymentFlowResult) => {
          clearInterval(checkPaymentInterval)
          subCloser?.close()
          if (result && relays.length > 0 && result.zapReceipt === undefined) {
            result.zapReceipt = await this.waitForZapReceipt({
              recipient,
              event,
              invoice: result.invoice,
              relayUrls: relays
            })
          }
          onPaymentFlowComplete?.(result)
          resolve(result)
        }
        const { setPaid } = launchPaymentModal({
          invoice: pr,
          onPaid: (response) => {
            void finish({ preimage: response.preimage, invoice: pr })
          },
          onCancelled: () => {
            void finish(null)
          }
        })

        if (verify) {
          checkPaymentInterval = setInterval(async () => {
            const invoice = new Invoice({ pr, verify })
            const paid = await invoice.verifyPayment()

            if (paid && invoice.preimage) {
              setPaid({
                preimage: invoice.preimage
              })
            }
          }, 1000)
        } else {
          const filter: Filter = {
            kinds: [kinds.Zap],
            '#p': [recipient],
            since: dayjs().subtract(1, 'minute').unix()
          }
          if (event) {
            filter['#e'] = [event.id]
          }
          subCloser = client.subscribe(
            senderRelayList.write.concat(FAST_READ_RELAY_URLS).slice(0, 4),
            filter,
            {
              onevent: (evt) => {
                const info = getZapInfoFromEvent(evt)
                if (!info) return

                if (info.invoice === pr) {
                  setPaid({ preimage: info.preimage ?? '' })
                }
              }
            }
          )
        }
      })
    })
  }

  /** Lightning addresses whose LNURL-pay endpoint supports NIP-57 (`allowsNostr` + `nostrPubkey`). */
  async filterNip57ZapEnabledAddresses(candidates: string[]): Promise<string[]> {
    const key = candidates
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
      .join('\u0001')
    if (!key) return []

    const cached = this.nip57EnabledAddressCache.get(key)
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      return cached.addrs
    }

    const enabled: string[] = []
    for (const addr of candidates) {
      const endpoint = await this.fetchLnurlPayZapEndpoint(addr)
      if (endpoint) enabled.push(addr)
    }
    const addrs = prioritizeZapLightningAddress(enabled, candidates[0])
    this.nip57EnabledAddressCache.set(key, { fetchedAt: Date.now(), addrs })
    return addrs
  }

  private waitForZapReceipt(params: {
    recipient: string
    event?: NostrEvent
    invoice: string
    relayUrls: string[]
    timeoutMs?: number
  }): Promise<NostrEvent | null> {
    const relayUrls = [...new Set([...params.relayUrls, ...FAST_READ_RELAY_URLS])].slice(0, 8)
    if (relayUrls.length === 0) return Promise.resolve(null)

    return new Promise((resolve) => {
      let subCloser: SubCloser | undefined
      const timeout = setTimeout(() => {
        subCloser?.close()
        resolve(null)
      }, params.timeoutMs ?? 20_000)

      const filter: Filter = {
        kinds: [kinds.Zap],
        '#p': [params.recipient],
        since: dayjs().subtract(2, 'minute').unix()
      }
      if (params.event) {
        filter['#e'] = [params.event.id]
      }

      subCloser = client.subscribe(relayUrls, filter, {
        onevent: (evt) => {
          const info = getZapInfoFromEvent(evt)
          if (!info || info.invoice !== params.invoice) return
          clearTimeout(timeout)
          subCloser?.close()
          resolve(evt)
        }
      })
    })
  }

  async payInvoice(
    invoice: string,
    closeOuterModel?: () => void,
    onPaymentFlowComplete?: (result: PaymentFlowResult) => void
  ): Promise<PaymentFlowResult> {
    if (this.provider) {
      try {
        const { preimage } = await sendWebLNPaymentWithRetryAndTimeout(this.provider, invoice)
        closeOuterModel?.()
        const result = { preimage, invoice }
        onPaymentFlowComplete?.(result)
        return result
      } catch (error) {
        logger.info('WebLN invoice payment unavailable, falling back to invoice UI', { error })
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

  private async getZapEndpoint(
    profile: TProfile,
    zapLightning?: { address?: string; candidates?: string[] }
  ): Promise<null | {
    callback: string
    lnurlBech32: string
  }> {
    const candidates = zapLightning?.candidates?.length
      ? prioritizeZapLightningAddress(zapLightning.candidates, zapLightning.address)
      : this.lightningAddressCandidates(profile, zapLightning?.address)
    for (const addr of candidates) {
      const resolved = await this.fetchLnurlPayZapEndpoint(addr)
      if (resolved) return resolved
    }
    return null
  }

  /** Ordered lightning identifiers from kind 0 (lud16/lud06 + `w` lightning rows); de-duplicated. */
  private lightningAddressCandidates(profile: TProfile, preferredFirst?: string): string[] {
    const raw =
      profile.lightningAddressList?.length && profile.lightningAddressList.length > 0
        ? profile.lightningAddressList
        : profile.lightningAddress
          ? [profile.lightningAddress]
          : []
    const out: string[] = []
    const seen = new Set<string>()
    for (const a of raw) {
      const t = a?.trim()
      if (!t) continue
      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(t)
    }
    return prioritizeZapLightningAddress(out, preferredFirst)
  }

  private async fetchLnurlPayZapEndpoint(lightningAddress: string): Promise<null | {
    callback: string
    lnurlBech32: string
  }> {
    const meta = await this.resolveLnurlPayMetadata(lightningAddress)
    if (!meta?.allowsNostr || !meta.nostrPubkey) return null
    const trimmed = lightningAddress.trim()
    const lnurlBech32 = trimmed.toLowerCase().startsWith('lnurl')
      ? trimmed
      : encodeLnurlBech32(meta.lnurl)
    return { callback: meta.callback, lnurlBech32 }
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
    if (cached && Date.now() - cached.fetchedAt < 60_000) {
      return cached.meta
    }

    const remember = (
      meta: Awaited<ReturnType<LightningService['resolveLnurlPayMetadata']>>
    ) => {
      this.lnurlPayMetadataCache.set(cacheKey, { fetchedAt: Date.now(), meta })
      return meta
    }

    try {
      let lnurl = ''

      if (lightningAddress.includes('@')) {
        const [name, domain] = lightningAddress.split('@')
        if (!name?.trim() || !domain?.trim()) return remember(null)
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
        return remember(null)
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
        return remember(null)
      }

      if (typeof body.callback !== 'string' || !body.callback) return remember(null)

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
      return remember(meta)
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

    return remember(null)
  }
}

const instance = new LightningService()
export default instance
