import { getConnectorConfig } from '@getalby/bitcoin-connect-react'

export type TWalletConnectionDetails = {
  connectorName: string
  connectorType: string
  nwcRelayUrl: string | null
  /** `lud16` query param on the NWC connection URI, when present. */
  nwcLud16FromUrl: string | null
}

function nwcUrlAsHttpUrl(nwcUrl: string): URL | null {
  try {
    const httpLike = nwcUrl
      .replace(/^nostr\+walletconnect:\/\//i, 'http://')
      .replace(/^nostrwalletconnect:\/\//i, 'http://')
      .replace(/^nostr\+walletconnect:/i, 'http://')
      .replace(/^nostrwalletconnect:/i, 'http://')
    return new URL(httpLike)
  } catch {
    return null
  }
}

/** Parse `relay=` from a nostr+walletconnect:// connection string. */
export function parseNwcRelayUrl(nwcUrl: string): string | null {
  return nwcUrlAsHttpUrl(nwcUrl)?.searchParams.get('relay') ?? null
}

/** Parse optional `lud16=` from a nostr+walletconnect:// connection string. */
export function parseNwcLud16FromUrl(nwcUrl: string): string | null {
  const lud16 = nwcUrlAsHttpUrl(nwcUrl)?.searchParams.get('lud16')?.trim()
  return lud16 || null
}

/** Read the active Bitcoin Connect wallet config (from localStorage-backed store). */
export function getBitcoinConnectWalletDetails(): TWalletConnectionDetails | null {
  const config = getConnectorConfig()
  if (!config) return null
  return {
    connectorName: config.connectorName,
    connectorType: config.connectorType,
    nwcRelayUrl: config.nwcUrl ? parseNwcRelayUrl(config.nwcUrl) : null,
    nwcLud16FromUrl: config.nwcUrl ? parseNwcLud16FromUrl(config.nwcUrl) : null
  }
}
