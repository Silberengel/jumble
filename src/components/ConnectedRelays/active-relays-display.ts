import { simplifyUrl } from '@/lib/url'

export const ACTIVE_RELAYS_MAX_ICONS = 14

export function activeRelayRowMuted(connected: boolean) {
  return !connected
}

export function activeRelayRowTitle(url: string, connected: boolean, t: (k: string) => string) {
  const base = simplifyUrl(url)
  if (!connected) return `${base} — ${t('Not connected')}`
  return base
}
