import type { Event } from 'nostr-tools'

/** Dispatched after the signed-in user's kind 10001 pin list is published. */
export const PIN_LIST_UPDATED_EVENT = 'jumble:pinListUpdated'

export type PinListUpdatedDetail = {
  ownerPubkey: string
  toggledEvent?: Event
  pinned?: boolean
}

export function dispatchPinListUpdated(detail: PinListUpdatedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<PinListUpdatedDetail>(PIN_LIST_UPDATED_EVENT, {
      detail: {
        ...detail,
        ownerPubkey: detail.ownerPubkey.trim().toLowerCase()
      }
    })
  )
}
