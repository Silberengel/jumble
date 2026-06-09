import { ExtendedKind, USER_STATUS_BACKGROUND_REFRESH_MS } from '@/constants'
import {
  NIP38_USER_STATUS_TYPES,
  parseUserStatusEvent,
  type Nip38UserStatusType,
  type TUserStatus
} from '@/lib/nip38-user-status'
import { userIdToPubkey } from '@/lib/pubkey'
import client from '@/services/client.service'
import { useCallback, useEffect, useState } from 'react'

export type UserStatusSnapshot = {
  general: TUserStatus | null
  music: TUserStatus | null
  byType: Partial<Record<string, TUserStatus>>
}

const EMPTY_SNAPSHOT: UserStatusSnapshot = {
  general: null,
  music: null,
  byType: {}
}

async function loadStatusFromCache(pubkey: string, type: Nip38UserStatusType): Promise<TUserStatus | null> {
  const cached = client.getCachedUserStatusEvent(pubkey, type)
  if (cached) {
    return parseUserStatusEvent(cached)
  }
  const session = client.eventService.findSessionReplaceableByNaddr({
    pubkey,
    kind: ExtendedKind.USER_STATUS,
    identifier: type
  })
  if (session) {
    return parseUserStatusEvent(session)
  }
  return null
}

async function fetchStatusFromNetwork(pubkey: string, type: Nip38UserStatusType): Promise<TUserStatus | null> {
  const ev = await client.fetchUserStatusEvent(pubkey, type)
  return ev ? parseUserStatusEvent(ev) : null
}

function snapshotFromStatuses(statuses: (TUserStatus | null)[]): UserStatusSnapshot {
  const byType: Partial<Record<string, TUserStatus>> = {}
  let general: TUserStatus | null = null
  let music: TUserStatus | null = null
  for (const s of statuses) {
    if (!s) continue
    byType[s.type] = s
    if (s.type === 'general') general = s
    if (s.type === 'music') music = s
  }
  return { general, music, byType }
}

export function useUserStatus(userId: string | undefined) {
  const [snapshot, setSnapshot] = useState<UserStatusSnapshot>(EMPTY_SNAPSHOT)
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async (opts?: { network?: boolean }) => {
    const pubkey = userId ? userIdToPubkey(userId) : ''
    if (!pubkey) {
      setSnapshot(EMPTY_SNAPSHOT)
      return
    }
    setIsLoading(true)
    try {
      const cached = await Promise.all(
        NIP38_USER_STATUS_TYPES.map((type) => loadStatusFromCache(pubkey, type))
      )
      setSnapshot(snapshotFromStatuses(cached))
      if (opts?.network !== false) {
        const network = await Promise.all(
          NIP38_USER_STATUS_TYPES.map((type) => fetchStatusFromNetwork(pubkey, type))
        )
        setSnapshot(snapshotFromStatuses(network))
      }
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const pubkey = userId ? userIdToPubkey(userId) : ''
    if (!pubkey) return

    const refresh = () => {
      void load({ network: true })
    }

    const intervalId = window.setInterval(refresh, USER_STATUS_BACKGROUND_REFRESH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, load])

  const hasStatus = snapshot.general != null || snapshot.music != null

  return { ...snapshot, hasStatus, isLoading, refresh: () => load({ network: true }) }
}
