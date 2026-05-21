import { getConnectorConfig } from '@getalby/bitcoin-connect-react'

export type TWalletConnectionDetails = {
  connectorName: string
  connectorType: string
  nwcRelayUrl: string | null
}

/** Parse `relay=` from a nostr+walletconnect:// connection string. */
export function parseNwcRelayUrl(nwcUrl: string): string | null {
  try {
    const httpLike = nwcUrl
      .replace(/^nostr\+walletconnect:\/\//i, 'http://')
      .replace(/^nostrwalletconnect:\/\//i, 'http://')
      .replace(/^nostr\+walletconnect:/i, 'http://')
      .replace(/^nostrwalletconnect:/i, 'http://')
    return new URL(httpLike).searchParams.get('relay')
  } catch {
    return null
  }
}

/** Read the active Bitcoin Connect wallet config (from localStorage-backed store). */
export function getBitcoinConnectWalletDetails(): TWalletConnectionDetails | null {
  const config = getConnectorConfig()
  if (!config) return null
  return {
    connectorName: config.connectorName,
    connectorType: config.connectorType,
    nwcRelayUrl: config.nwcUrl ? parseNwcRelayUrl(config.nwcUrl) : null
  }
}
