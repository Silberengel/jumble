import { fetchHiddenNetworkRelayStatus, type HiddenNetworkRelayStatus } from '@/lib/hidden-network-relay-status'
import { useCallback, useEffect, useState } from 'react'

const DEFAULT_POLL_MS = 30_000

export function useHiddenNetworkRelayStatus(pollMs = DEFAULT_POLL_MS) {
  const [status, setStatus] = useState<HiddenNetworkRelayStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      setStatus(await fetchHiddenNetworkRelayStatus({ force }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(true)
    const id = window.setInterval(() => void refresh(false), pollMs)
    return () => window.clearInterval(id)
  }, [pollMs, refresh])

  return {
    status,
    loading,
    refresh: () => refresh(true)
  }
}
