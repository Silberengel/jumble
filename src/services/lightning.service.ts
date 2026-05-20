import {
  CODY_PUBKEY,
  FAST_READ_RELAY_URLS,
  FAST_WRITE_RELAY_URLS,
  IMWALD_MAINTAINER_PUBKEY,
  ZAP_SENDING_ENABLED
} from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { TProfile } from '@/types'
import { init, launchPaymentModal } from '@getalby/bitcoin-connect-react'
import { Invoice } from '@getalby/lightning-tools'
import { bech32 } from '@scure/base'
import { WebLNProvider } from '@webbtc/webln-types'
import dayjs from 'dayjs'
import { Filter, kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { makeZapRequest } from 'nostr-tools/nip57'
import { utf8Decoder } from 'nostr-tools/utils'
import client from './client.service'
import storage from './local-storage.service'
import { queryService, replaceableEventService } from './client.service'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { clampZapSats } from '@/lib/lightning'
import { prioritizeZapLightningAddress } from '@/lib/merge-payment-methods'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { buildLnurlPayCallbackUrl, parseLnurlCommentAllowed } from '@/lib/lnurl-pay'
import logger from '@/lib/logger'
import { runAfterReleasingRadixScrollLock } from '@/lib/react-remove-scroll-body-cleanup'

export type TRecentSupporter = { pubkey: string; amount: number; comment?: string }

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
    includePublicReceipt: boolean = storage.getIncludePublicZapReceipt(),
    zapLightning?: { address?: string; candidates?: string[] }
  ): Promise<{ preimage: string; invoice: string } | null> {
    if (!ZAP_SENDING_ENABLED) {
      throw new Error('NIP-57 zaps are disabled; use LNURL-pay invoices instead')
    }
    if (!client.signer) {
      throw new Error('You need to be logged in to zap')
    }
    const { recipient, event } =
      typeof recipientOrEvent === 'string'
        ? { recipient: recipientOrEvent }
        : { recipient: recipientOrEvent.pubkey, event: recipientOrEvent }

    // Privacy: Only use current user's relays + defaults
    const [profile, senderRelayList] = await Promise.all([
      (async () => {
        const profileEvent = await replaceableEventService.fetchReplaceableEvent(recipient, kinds.Metadata)
        return profileEvent ? getProfileFromEvent(profileEvent) : undefined
      })(),
      sender
        ? client.fetchRelayList(sender) // Keep using client for relay list merging
        : Promise.resolve({ read: FAST_READ_RELAY_URLS, write: FAST_WRITE_RELAY_URLS })
    ])
    if (!profile) {
      throw new Error('Recipient not found')
    }
    const zapEndpoint = await this.getZapEndpoint(profile, zapLightning)
    if (!zapEndpoint) {
      throw new Error("Recipient's lightning address is invalid")
    }
    const { callback, lnurl } = zapEndpoint
    const amount = sats * 1000
    const zapRelays = includePublicReceipt
      ? senderRelayList.write.slice(0, 4).concat(FAST_READ_RELAY_URLS)
      : []
    const zapRequestDraft = makeZapRequest({
      ...(event ? { event } : { pubkey: recipient }),
      amount,
      relays: zapRelays,
      comment
    })
    const zapRequest = await client.signer.signEvent(zapRequestDraft)
    const zapRequestUrl = buildLnurlPayCallbackUrl(callback, {
      amount: String(amount),
      nostr: JSON.stringify(zapRequest),
      lnurl
    })
    const zapRequestRes = await fetchWithTimeout(zapRequestUrl, { timeoutMs: 25_000 })
    const zapRequestResBody = await zapRequestRes.json()
    if (zapRequestResBody.error) {
      throw new Error(zapRequestResBody.message)
    }
    const { pr, verify, reason } = zapRequestResBody
    if (!pr) {
      throw new Error(reason ?? 'Failed to create invoice')
    }

    if (this.provider) {
      const { preimage } = await this.provider.sendPayment(pr)
      closeOuterModel?.()
      return { preimage, invoice: pr }
    }

    return new Promise((resolve) => {
      runAfterReleasingRadixScrollLock(closeOuterModel, () => {
        let checkPaymentInterval: ReturnType<typeof setInterval> | undefined
        let subCloser: SubCloser | undefined
        const { setPaid } = launchPaymentModal({
          invoice: pr,
          onPaid: (response) => {
            clearInterval(checkPaymentInterval)
            subCloser?.close()
            resolve({ preimage: response.preimage, invoice: pr })
          },
          onCancelled: () => {
            clearInterval(checkPaymentInterval)
            subCloser?.close()
            resolve(null)
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

  async payInvoice(
    invoice: string,
    closeOuterModel?: () => void
  ): Promise<{ preimage: string; invoice: string } | null> {
    if (this.provider) {
      const { preimage } = await this.provider.sendPayment(invoice)
      closeOuterModel?.()
      return { preimage, invoice: invoice }
    }

    return new Promise((resolve) => {
      runAfterReleasingRadixScrollLock(closeOuterModel, () => {
        launchPaymentModal({
          invoice: invoice,
          onPaid: (response) => {
            resolve({ preimage: response.preimage, invoice: invoice })
          },
          onCancelled: () => {
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

  private async getZapEndpoint(
    profile: TProfile,
    zapLightning?: { address?: string; candidates?: string[] }
  ): Promise<null | {
    callback: string
    lnurl: string
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

  private async fetchLnurlPayZapEndpoint(lightningAddress: string): Promise<null | {
    callback: string
    lnurl: string
  }> {
    const meta = await this.resolveLnurlPayMetadata(lightningAddress)
    if (!meta?.allowsNostr || !meta.nostrPubkey) return null
    return { callback: meta.callback, lnurl: meta.lnurl }
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
