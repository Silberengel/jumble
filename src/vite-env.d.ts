/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
import { TNip07 } from '@/types'

declare module '*.md?raw' {
  const content: string
  export default content
}

declare global {
  interface Window {
    nostr?: TNip07
    /** Set by {@link electron/preload.cjs} when running inside Electron. */
    imwaldElectron?: {
      isElectron: true
      /** Loopback SOCKS bridge for `.onion` / `.i2p` relay URLs (packaged desktop). */
      hiddenRelayProxyBase?: (() => string | null) | string | null
      getHiddenNetworkRelayStatus?: (payload?: { force?: boolean }) => Promise<{
        runtime: string
        proxyAvailable: boolean
        tor: { reachable: boolean; socksUrl: string; source: string }
        i2p: { reachable: boolean; socksUrl: string; source: string }
        checkedAt: number
      }>
      /** Ask Electron main to reload index safely (avoids file:// history path reload issues). */
      reloadApp?: () => Promise<boolean>
      /**
       * Allowlisted HTTP(S) from main (translate + LanguageTool). See `electronAwareFetch`.
       */
      backendRequest?: (payload: {
        url: string
        method: string
        headers: Record<string, string>
        body: string | null
      }) => Promise<{
        status: number
        statusText: string
        headers: Record<string, string>
        body: string
      }>
    }
  }
}
