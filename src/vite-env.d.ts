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
  }
}
