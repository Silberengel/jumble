import { queueRelayAuthSign } from '@/lib/relay-auth-sign-queue'
import {
  authenticateNip42Relay,
  isRelayAuthAccessDeniedMessage,
  isRelayAuthRequiredCloseReason,
  isRelaySubscriptionClosedByCaller,
  RelayAuthAccessDeniedError
} from '@/lib/relay-nip42-auth'
import { applyRelayNip42AckTimeout } from '@/lib/relay-nip42-tuning'
import { normalizeUrl } from '@/lib/url'
import { patchRelayNoticeForFetchFailures } from '@/services/relay-notice-fetch-failure'
import type { Event as NEvent, EventTemplate, Filter, VerifiedEvent } from 'nostr-tools'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'

export type GroupedRelaySubscribeRequest = {
  url: string
  filters: Filter[]
}

export type RelaySubscribeSlotOps = {
  acquireGlobal: (opts?: { priority?: boolean }) => Promise<void>
  releaseGlobal: () => void
  acquireSub: (relayKey: string) => Promise<void>
  releaseSub: (relayKey: string) => void
}

export type RelaySubscriptionCloser = {
  relayKey: string
  close: () => void
}

export type OpenGroupedRelaySubscriptionsParams = {
  groupedRequests: GroupedRelaySubscribeRequest[]
  eoseTimeoutMs: number
  connectionSlotPriority?: boolean
  slots: RelaySubscribeSlotOps
  ensureRelay: (url: string) => Promise<AbstractRelay>
  onRelayNoticeFetchFailure?: (relayUrl: string, message: string) => void
  trackEventSeenOn: (eventId: string, relay: AbstractRelay) => void
  canSignerAuthenticateRelay: () => boolean
  signAuthEvent: (template: EventTemplate) => Promise<VerifiedEvent | null>
  forwardOnevent?: (evt: NEvent) => void
  /** Optional hook to wrap each relay's onevent handler (logging, first-response metrics). */
  wrapOnevent?: (
    relayKey: string,
    deliver: (evt: NEvent) => void,
    ctx: { afterAuth: boolean }
  ) => (evt: NEvent) => void
  localAlreadyHaveEvent: (id: string) => boolean
  handleEose: (index: number) => void
  handleClose: (index: number, reason: string) => void
  onStartLogin?: () => void
  recordConnectionFailure: (url: string, err: unknown, phase: 'initial' | 'resubscribe') => void
  onSubscribed?: (relayKey: string, ctx: { afterAuth: boolean }) => void
}

function deliverOnevent(
  params: OpenGroupedRelaySubscriptionsParams,
  relayKey: string,
  evt: NEvent,
  ctx: { afterAuth: boolean }
) {
  if (params.wrapOnevent) {
    params.wrapOnevent(relayKey, (e) => params.forwardOnevent?.(e), ctx)(evt)
    return
  }
  params.forwardOnevent?.(evt)
}

/**
 * Open parallel relay subscriptions with NIP-42 auth + resubscribe handling shared by
 * {@link ClientService.subscribe} and {@link QueryService.subscribe}.
 */
export function openGroupedRelaySubscriptionsWithNip42(
  params: OpenGroupedRelaySubscriptionsParams
): { subs: RelaySubscriptionCloser[]; allOpened: Promise<void> } {
  const subs: RelaySubscriptionCloser[] = []
  const nip42ResubscribePending = new Set<number>()
  const nip42HasAuthedOnce = new Set<number>()
  const slotPriority = params.connectionSlotPriority === true

  const allOpened = Promise.all(
    params.groupedRequests.map(async ({ url, filters: relayFilters }, i) => {
      await params.slots.acquireGlobal(slotPriority ? { priority: true } : undefined)
      try {
        const relayKey = normalizeUrl(url) || url
        await params.slots.acquireSub(relayKey)
        let relay: AbstractRelay
        try {
          relay = await params.ensureRelay(url)
          patchRelayNoticeForFetchFailures(relay, relayKey, params.onRelayNoticeFetchFailure ?? (() => {}))
        } catch (err) {
          params.recordConnectionFailure(url, err, 'initial')
          params.slots.releaseSub(relayKey)
          params.handleClose(i, (err as Error)?.message ?? String(err))
          return
        }

        let slotReleased = false
        const releaseOnce = () => {
          if (!slotReleased) {
            slotReleased = true
            params.slots.releaseSub(relayKey)
          }
        }

        const sub = relay.subscribe(relayFilters, {
          receivedEvent: (_relay, id) => params.trackEventSeenOn(id, _relay),
          onevent: (evt: NEvent) => deliverOnevent(params, relayKey, evt, { afterAuth: false }),
          oneose: () => params.handleEose(i),
          onclose: (reason: string) => {
            if (isRelaySubscriptionClosedByCaller(reason) && nip42ResubscribePending.has(i)) {
              return
            }
            releaseOnce()
            if (
              isRelayAuthRequiredCloseReason(reason) &&
              params.canSignerAuthenticateRelay() &&
              !nip42HasAuthedOnce.has(i)
            ) {
              nip42ResubscribePending.add(i)
              applyRelayNip42AckTimeout(relay)
              authenticateNip42Relay(relay, async (authEvt: EventTemplate) => {
                const evt = await queueRelayAuthSign(() => params.signAuthEvent(authEvt))
                if (!evt) throw new Error('sign event failed')
                return evt
              })
                .then(async () => {
                  nip42HasAuthedOnce.add(i)
                  await params.slots.acquireGlobal(slotPriority ? { priority: true } : undefined)
                  try {
                    await params.slots.acquireSub(relayKey)
                    let liveRelay: AbstractRelay
                    try {
                      liveRelay = await params.ensureRelay(url)
                      patchRelayNoticeForFetchFailures(
                        liveRelay,
                        relayKey,
                        params.onRelayNoticeFetchFailure ?? (() => {})
                      )
                    } catch (err) {
                      params.recordConnectionFailure(url, err, 'resubscribe')
                      nip42ResubscribePending.delete(i)
                      params.slots.releaseSub(relayKey)
                      params.handleClose(i, (err as Error)?.message ?? String(err))
                      return
                    }
                    let slotReleased2 = false
                    const releaseSlot2 = () => {
                      if (!slotReleased2) {
                        slotReleased2 = true
                        params.slots.releaseSub(relayKey)
                      }
                    }
                    try {
                      const sub2 = liveRelay.subscribe(relayFilters, {
                        receivedEvent: (_relay, id) => params.trackEventSeenOn(id, _relay),
                        onevent: (evt: NEvent) =>
                          deliverOnevent(params, relayKey, evt, { afterAuth: true }),
                        oneose: () => params.handleEose(i),
                        onclose: (reason2: string) => {
                          releaseSlot2()
                          params.handleClose(i, reason2)
                        },
                        alreadyHaveEvent: params.localAlreadyHaveEvent,
                        eoseTimeout: params.eoseTimeoutMs
                      })
                      params.onSubscribed?.(relayKey, { afterAuth: true })
                      subs.push({
                        relayKey,
                        close: () => {
                          releaseSlot2()
                          sub2.close()
                        }
                      })
                      nip42ResubscribePending.delete(i)
                    } catch (err) {
                      params.recordConnectionFailure(url, err, 'resubscribe')
                      nip42ResubscribePending.delete(i)
                      releaseSlot2()
                      params.handleClose(i, (err as Error)?.message ?? String(err))
                    }
                  } finally {
                    params.slots.releaseGlobal()
                  }
                })
                .catch((err) => {
                  nip42ResubscribePending.delete(i)
                  const authMsg = err instanceof Error ? err.message : String(err)
                  if (
                    err instanceof RelayAuthAccessDeniedError ||
                    isRelayAuthAccessDeniedMessage(authMsg)
                  ) {
                    nip42HasAuthedOnce.add(i)
                    params.recordConnectionFailure(url, authMsg, 'resubscribe')
                  }
                  params.handleClose(i, authMsg || reason)
                })
              return
            }
            if (isRelayAuthRequiredCloseReason(reason)) {
              params.onStartLogin?.()
            }
            params.handleClose(i, reason)
          },
          alreadyHaveEvent: params.localAlreadyHaveEvent,
          eoseTimeout: params.eoseTimeoutMs
        })
        params.onSubscribed?.(relayKey, { afterAuth: false })
        subs.push({
          relayKey,
          close: () => {
            releaseOnce()
            sub.close()
          }
        })
      } finally {
        params.slots.releaseGlobal()
      }
    })
  ).then(() => {})

  return { subs, allOpened }
}
