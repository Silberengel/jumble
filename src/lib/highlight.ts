/**
 * Shared highlight.js instance with a curated language subset.
 * Replaces the full `highlight.js` import (~969 kB) with `lib/common` (~350 kB).
 * Loaded once via dynamic import(); safe to call from article code-block effects.
 */
import type { HLJSApi } from 'highlight.js'

let hljsPromise: Promise<HLJSApi> | null = null

const DEV_RELOAD_GUARD_KEY = 'jumble-hljs-vite-reload'

async function importHighlightCommon(): Promise<HLJSApi> {
  const mod = await import('highlight.js/lib/common')
  return mod.default
}

/**
 * Lazy singleton loader for highlight.js. In dev, retries once after a Vite HMR reconnect
 * and may hard-reload the tab when optimized-dep hashes are stale (see Vite `?v=` on `.vite/deps/`).
 */
export async function getHighlightJs(): Promise<HLJSApi> {
  if (!hljsPromise) {
    hljsPromise = (async () => {
      const hljs = await importHighlightCommon()
      sessionStorage?.removeItem(DEV_RELOAD_GUARD_KEY)
      return hljs
    })().catch(async (firstErr) => {
      if (!import.meta.env.DEV) throw firstErr
      await new Promise((r) => setTimeout(r, 350))
      try {
        const hljs = await importHighlightCommon()
        sessionStorage?.removeItem(DEV_RELOAD_GUARD_KEY)
        return hljs
      } catch (retryErr) {
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(DEV_RELOAD_GUARD_KEY)) {
          sessionStorage.setItem(DEV_RELOAD_GUARD_KEY, '1')
          window.location.reload()
        }
        sessionStorage?.removeItem(DEV_RELOAD_GUARD_KEY)
        throw retryErr
      }
    })
  }
  return hljsPromise
}

/** @deprecated Use {@link getHighlightJs} — kept for any legacy dynamic default import. */
export default getHighlightJs
