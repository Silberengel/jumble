import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import packageJson from './package.json'
/// <reference types="vitest" />

const getGitHash = () => {
  try {
    return JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim())
  } catch (error) {
    console.warn('Failed to retrieve commit hash:', error)
    return '"unknown"'
  }
}

const getAppVersion = () => {
  try {
    return JSON.stringify(packageJson.version)
  } catch (error) {
    console.warn('Failed to retrieve app version:', error)
    return '"unknown"'
  }
}

/**
 * React Fast Refresh can remount provider children without matching context after editing providers
 * or pages. Full page reload keeps the tree consistent. `nostr-context.tsx` fixes duplicate Nostr
 * `createContext` identity across HMR for most cases.
 */
function fullReloadOnProvidersAndPages(): Plugin {
  return {
    name: 'full-reload-providers-pages',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      const normalized = file.replace(/\\/g, '/')
      if (
        normalized.includes('/src/providers/') ||
        normalized.includes('/src/pages/') ||
        normalized.endsWith('/src/PageManager.tsx')
      ) {
        server.ws.send({ type: 'full-reload' })
        return []
      }
    }
  }
}

/** Loopback targets in `server.proxy` — optional in dev; see PROXY_SETUP.md. */
const OPTIONAL_DEV_PROXY_LOOPBACK_PORTS = [4000, 5000, 8010, 8090, 9876] as const

function blobFromLogArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
      return ''
    })
    .join('\n')
}

/**
 * `http-proxy` logs `Error: connect ECONNREFUSED …` via `console.error`, bypassing Vite's `logger.error`.
 */
const DEV_INDEX_RELAY_PROXY_PATH_MARKERS = [
  '/api/languagetool',
  '/v2/',
  '/api/piper-tts',
  '/api/translate',
  '/sites',
  '/dev-index-relay',
  '/dev-cors-index-relay',
  '/api/events'
] as const

function isDevProxyConnectivityNoise(blob: string): boolean {
  return (
    blob.includes('ECONNREFUSED') ||
    blob.includes('ETIMEDOUT') ||
    blob.includes('ECONNRESET') ||
    blob.includes('EHOSTUNREACH')
  )
}

function isOptionalDevProxyConnRefusedNoise(args: unknown[]): boolean {
  const blob = blobFromLogArgs(args)
  if (!isDevProxyConnectivityNoise(blob)) return false
  if (DEV_INDEX_RELAY_PROXY_PATH_MARKERS.some((m) => blob.includes(m))) return true
  if (blob.includes('127.0.0.1:') || blob.includes('localhost:')) return true
  return OPTIONAL_DEV_PROXY_LOOPBACK_PORTS.some((port) => new RegExp(`\\b:${port}\\b`).test(blob))
}

function isOptionalDevProxyHttpError(text: string): boolean {
  if (!text.includes('http proxy error')) return false
  if (!isDevProxyConnectivityNoise(text)) return false
  if (DEV_INDEX_RELAY_PROXY_PATH_MARKERS.some((m) => text.includes(m))) {
    return true
  }
  return OPTIONAL_DEV_PROXY_LOOPBACK_PORTS.some((port) => text.includes(`127.0.0.1:${port}`))
}

/**
 * When optional localhost backends are down, `http-proxy` otherwise logs a multiline stack per request.
 */
function quietOptionalDevProxyErrors(): Plugin {
  return {
    name: 'quiet-optional-dev-proxy-errors',
    apply: 'serve',
    configureServer(server) {
      const prevConsoleError = console.error.bind(console)
      console.error = (...args: unknown[]) => {
        if (isOptionalDevProxyConnRefusedNoise(args)) return
        prevConsoleError(...args)
      }
      server.httpServer?.on('close', () => {
        console.error = prevConsoleError
      })
    },
    configResolved(config) {
      const prevError = config.logger.error.bind(config.logger)
      config.logger.error = (msg, options) => {
        const text = typeof msg === 'string' ? msg : ''
        if (isOptionalDevProxyHttpError(text)) return
        prevError(msg, options)
      }
    }
  }
}

function jsonProxyErrorHandler(status: number, body: Record<string, unknown>) {
  return (proxy: { on: (event: string, handler: (...args: unknown[]) => void) => void }) => {
    proxy.on('error', (_err, _req, res) => {
      const r = res as {
        headersSent?: boolean
        writeHead?: (c: number, h: Record<string, string>) => void
        end?: (b: string) => void
      }
      if (r.headersSent) return
      if (typeof r?.writeHead === 'function' && typeof r?.end === 'function') {
        r.writeHead(status, { 'Content-Type': 'application/json' })
        r.end(JSON.stringify(body))
      }
    })
  }
}

/**
 * Loopback / RFC1918 / ULA — mirrors `isLocalNetworkUrl` in `src/lib/url.ts` without importing it
 * (Vite's config bundle does not resolve `@/` for transitive deps).
 */
function isLocalNetworkHostForSw(url: URL): boolean {
  const hostname = url.hostname
  if (hostname === 'localhost' || hostname === '::1') return true
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number)
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 127 && b === 0 && c === 0 && d === 1)
    )
  }
  if (hostname.includes(':')) {
    const lower = hostname.toLowerCase()
    if (lower.startsWith('fe80:')) return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  }
  return false
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // `.env.local` is not on `process.env` when this file is evaluated unless we load it.
  const env = loadEnv(mode, process.cwd(), '')
  /** gc_index_relay (or compatible) HTTP API; app POSTs to /api/events/filter. HTTP 500 in the browser means this process errored, not that Vite failed. */
  const devIndexRelayTarget =
    env.VITE_DEV_INDEX_RELAY_TARGET?.trim() || 'http://127.0.0.1:4000'
  /** Target for `/dev-cors-index-relay` (allowlisted HTTPS index hosts in dev). */
  const devCorsIndexRelayTarget =
    env.VITE_DEV_CORS_INDEX_RELAY_TARGET?.trim()?.replace(/\/+$/, '') ||
    (/^https:\/\//i.test(devIndexRelayTarget)
      ? devIndexRelayTarget.replace(/\/+$/, '')
      : 'https://mercury-relay.imwald.eu')

  /**
   * Desktop shell (`vite build --mode electron`): always bake public Imwald API origins into the bundle.
   * Relying on `cross-env` in npm scripts alone is fragile (skipped builds, CI, wrong script). `define`
   * wins over empty/missing `.env.*` for these keys.
   */
  const electronImwaldPublicDefaults = {
    VITE_PROXY_SERVER: 'https://jumble.imwald.eu',
    VITE_READ_ALOUD_TTS_URL: 'https://jumble.imwald.eu/api/piper-tts',
    VITE_LANGUAGE_TOOL_URL: 'https://jumble.imwald.eu/api/languagetool',
    VITE_TRANSLATE_URL: 'https://jumble.imwald.eu/api/translate'
  } as const
  const electronImwaldDefines: Record<string, string> =
    mode === 'electron'
      ? Object.fromEntries(
          (
            [
              'VITE_PROXY_SERVER',
              'VITE_READ_ALOUD_TTS_URL',
              'VITE_LANGUAGE_TOOL_URL',
              'VITE_TRANSLATE_URL'
            ] as const
          ).map((key) => {
            const fromEnv = env[key]?.trim()
            const fallback = electronImwaldPublicDefaults[key]
            return [`import.meta.env.${key}`, JSON.stringify(fromEnv || fallback)]
          })
        )
      : {}

  return {
    base: '/',
    define: {
      'import.meta.env.GIT_COMMIT': getGitHash(),
      'import.meta.env.APP_VERSION': getAppVersion(),
      ...electronImwaldDefines
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      },
      /** Avoid invalid hook call / `dispatcher is null` when lazy chunks resolve a second `react` copy. */
      dedupe: ['react', 'react-dom']
    },
    server: {
      // OG/link preview uses `/sites/?url=…`. Without this, Vite serves `index.html` and WebService parses the app shell.
      // Run the scraper on 8090 per PROXY_SETUP.md, or rely on allorigins fallback in dev (web.service.ts).
      proxy: {
        // Read-aloud Piper: same path as production Apache → aitherboard (avoid cross-origin CORS in dev).
        '/api/piper-tts': {
          target: 'http://127.0.0.1:9876',
          changeOrigin: true,
          configure: jsonProxyErrorHandler(503, {
            ok: false,
            error: 'piper_proxy_unreachable',
            hint: 'Start Piper TTS on :9876 — see PROXY_SETUP.md'
          })
        },
        '/api/languagetool': {
          target: 'http://127.0.0.1:8010',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/languagetool/u, '') || '/',
          configure: jsonProxyErrorHandler(503, {
            ok: false,
            error: 'languagetool_proxy_unreachable',
            hint: 'Start LanguageTool on :8010 — see PROXY_SETUP.md'
          })
        },
        '/api/translate': {
          target: 'http://127.0.0.1:5000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/translate/u, '') || '/',
          configure: jsonProxyErrorHandler(503, {
            ok: false,
            error: 'translate_proxy_unreachable',
            hint: 'Start LibreTranslate (or compatible API) on :5000 — see PROXY_SETUP.md'
          })
        },
        '/sites': {
          target: 'http://127.0.0.1:8090',
          changeOrigin: true,
          configure: jsonProxyErrorHandler(502, {
            ok: false,
            error: 'og_proxy_unreachable',
            hint: 'Start OG scraper on :8090 (see PROXY_SETUP.md)'
          })
        },
        // Loopback HTTP index relay: `import.meta.env.DEV` rewrites kind 10243 URLs through this path.
        '/dev-index-relay': {
          target: devIndexRelayTarget,
          changeOrigin: true,
          timeout: 12_000,
          proxyTimeout: 12_000,
          rewrite: (p) => p.replace(/^\/dev-index-relay/, '') || '/',
          configure: jsonProxyErrorHandler(502, {
            ok: false,
            error: 'dev_index_relay_unreachable',
            hint: 'Start the local index relay (VITE_DEV_INDEX_RELAY_TARGET, default :4000) or disable that kind-10243 URL in dev'
          })
        },
        /**
         * Some public index relays (e.g. nos.lol) omit `Content-Type` from CORS preflight
         * `Access-Control-Allow-Headers`, so browser POST /api/events/filter fails from localhost.
         * Same-origin proxy only — allowlisted hosts in {@link devProxyCorsProblematicHttpsIndexRelayBase}.
         */
        '/dev-cors-index-relay': {
          target: devCorsIndexRelayTarget,
          changeOrigin: true,
          secure: true,
          timeout: 12_000,
          proxyTimeout: 12_000,
          rewrite: (p) => p.replace(/^\/dev-cors-index-relay/, '') || '/',
          configure: jsonProxyErrorHandler(502, {
            ok: false,
            error: 'cors_index_relay_unreachable',
            hint: 'Remote index relay unreachable — check network or VITE_DEV_CORS_INDEX_RELAY_TARGET'
          })
        }
      }
    },
    build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/')

          // One chunk per locale file — `i18n/index` statically imports all of them; splitting keeps
          // the main app chunk smaller and allows parallel fetch + finer cache invalidation.
          const localeMatch = norm.match(/\/i18n\/locales\/([^/]+)\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/)
          if (localeMatch) {
            const code = localeMatch[1].replace(/[^a-zA-Z0-9_-]/g, '_')
            return `i18n-locale-${code}`
          }

          if (!norm.includes('node_modules')) return undefined

          // Lazy-loaded only — must not share a chunk with sync vendors or it gets preloaded
          if (norm.includes('@asciidoctor')) {
            return 'vendor-asciidoctor'
          }

          if (norm.includes('/katex/') || norm.includes('node_modules/katex/')) {
            return 'vendor-katex'
          }

          // React core (load first; keep together)
          if (/node_modules\/(react-dom|react\/|scheduler\/|use-sync-external-store\/)/.test(norm)) {
            return 'vendor-react'
          }

          // ProseMirror vs TipTap — avoids one ~750k editor blob; both load together when editor mounts
          if (norm.includes('prosemirror-')) {
            return 'vendor-prosemirror'
          }
          if (norm.includes('@tiptap')) {
            return 'vendor-tiptap'
          }

          // Radix UI primitives
          if (norm.includes('@radix-ui')) {
            return 'vendor-radix'
          }

          // Nostr + crypto used by the stack
          if (
            norm.includes('nostr-tools') ||
            norm.includes('@noble') ||
            norm.includes('@scure')
          ) {
            return 'vendor-nostr'
          }

          if (norm.includes('lucide-react')) {
            return 'vendor-lucide'
          }

          if (norm.includes('i18next') || norm.includes('react-i18next')) {
            return 'vendor-i18n-runtime'
          }

          if (norm.includes('@dnd-kit')) {
            return 'vendor-dnd'
          }

          if (norm.includes('highlight.js') || norm.includes('/src/lib/highlight')) {
            return 'vendor-highlight'
          }

          if (norm.includes('flexsearch')) {
            return 'vendor-flexsearch'
          }

          if (norm.includes('emoji-picker-element')) {
            return 'vendor-emoji'
          }

          if (norm.includes('yet-another-react-lightbox')) {
            return 'vendor-lightbox'
          }

          if (norm.includes('@getalby') || norm.includes('bitcoin-connect')) {
            return 'vendor-lightning-alby'
          }
          if (norm.includes('embla-carousel')) {
            return 'vendor-embla'
          }

          if (norm.includes('qr-code-styling') || norm.includes('/qr-scanner/')) {
            return 'vendor-qr'
          }

          if (norm.includes('/cmdk/')) {
            return 'vendor-cmdk'
          }

          if (norm.includes('/vaul/')) {
            return 'vendor-vaul'
          }

          if (norm.includes('tippy.js')) {
            return 'vendor-tippy'
          }

          if (norm.includes('/zod/') || norm.includes('node_modules/zod')) {
            return 'vendor-zod'
          }

          if (norm.includes('/dayjs/')) {
            return 'vendor-dayjs'
          }

          if (norm.includes('/sonner/')) {
            return 'vendor-sonner'
          }

          if (norm.includes('blossom-client-sdk')) {
            return 'vendor-blossom'
          }

          if (norm.includes('@popperjs')) {
            return 'vendor-popper'
          }

          if (norm.includes('@floating-ui')) {
            return 'vendor-floating-ui'
          }

          if (norm.includes('/blurhash/') || norm.includes('node_modules/blurhash')) {
            return 'vendor-blurhash'
          }

          if (norm.includes('/dataloader/') || norm.includes('node_modules/dataloader')) {
            return 'vendor-dataloader'
          }

          if (
            norm.includes('tailwind-merge') ||
            norm.includes('/clsx/') ||
            norm.includes('class-variance-authority')
          ) {
            return 'vendor-clsx-tailwind'
          }

          return 'vendor-misc'
        }
      },
      onwarn(warning, warn) {
        // Suppress vite:reporter warnings about mixed static/dynamic imports
        // These are informational warnings about code splitting, not errors
        if (warning.plugin === 'vite:reporter' && warning.message.includes('dynamically imported') && warning.message.includes('statically imported')) {
          return
        }
        // Use default warning handler for other warnings
        warn(warning)
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  },
  plugins: [
    react(),
    fullReloadOnProvidersAndPages(),
    quietOptionalDevProxyErrors(),
    VitePWA({
      // Prompt mode + virtual:pwa-register (main bundle) — do not auto-activate; VersionUpdateBanner calls updateSW().
      registerType: 'prompt',
      // Use public/manifest.webmanifest and index.html <link> only; avoid duplicate manifest link in build
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,webmanifest}'],
        globDirectory: 'dist/',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/_/, /^\/admin/],
        // Exclude source files and development files from precaching
        globIgnores: [
          '**/src/**',
          '**/node_modules/**',
          '**/*.map',
          '**/sw.js',
          '**/workbox-*.js'
        ],
        runtimeCaching: [
          {
            // Exclude upload endpoints from service worker handling - use NetworkOnly to bypass cache
            // Match various upload URL patterns - comprehensive regex to catch all upload services
            // This ensures uploads (POST) and discovery endpoints (GET) bypass the service worker
            // Note: XMLHttpRequest should bypass service workers, but we add this as a safety measure
            urlPattern: ({ url, request }) => {
              const urlString = url.toString()
              const method = request.method?.toUpperCase() || 'GET'
              
              // Always bypass service worker for POST requests (uploads)
              if (method === 'POST') {
                return /(?:api\/v2\/nip96\/upload|\.well-known\/nostr\/nip96\.json|nostr\.build|nostrcheck\.me|void\.cat|\/upload|\/nip96\/)/i.test(urlString)
              }
              
              // Also bypass for GET requests to upload-related endpoints
              return /(?:\.well-known\/nostr\/nip96\.json|api\/v2\/nip96\/upload)/i.test(urlString)
            },
            handler: 'NetworkOnly'
          },
          {
            // Well-known nostr media CDNs: cache aggressively since content is addressed by hash
            urlPattern:
              /^https:\/\/(?:image\.nostr\.build|cdn\.satellite\.earth|nostrimg\.com|void\.cat\/d|files\.sovbit\.host|cdn\.hzrd149\.com|blossom\.band|r2[a-z]?\.primal\.net)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'nostr-media-cdn',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 24 * 60 * 60 // 60 days — hash-addressed, effectively immutable
              },
              // Only cache genuine 200 OK responses; prevents opaque/error responses from
              // filling storage quota with unusable entries.
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Project Gutenberg covers: bypass SW cache — CacheFirst can serve stale/truncated
            // HTML error bodies for .jpg URLs and the browser reports "image corrupt or truncated".
            urlPattern: /^https:\/\/(?:www\.)?gutenberg\.org\//i,
            handler: 'NetworkOnly'
          },
          {
            // Generic cross-origin images by file extension (covers hosts not matched above)
            urlPattern: /^https?:\/\/.+\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)(?:\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-images',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // Audio files (podcasts, voice notes) — stale-while-revalidate so playback starts
            // immediately from cache while the network check runs in the background.
            urlPattern: /^https?:\/\/.+\.(?:mp3|ogg|opus|flac|m4a|aac|wav)(?:\?.*)?$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'external-audio',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 7 * 24 * 60 * 60 // 7 days
              },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            // NIP-11 relay info documents: short-lived cache so relay metadata is fresh but
            // the app can render offline or on a slow connection without blocking on network.
            // Do not intercept loopback/LAN: cross-origin + CORS often yields no cacheable response;
            // StaleWhileRevalidate then rejects (Firefox: SW "no-response") and breaks relay pages.
            urlPattern: ({ request, url }: { request: Request; url: URL }) => {
              if (!(request.headers.get('accept')?.includes('application/nostr+json') ?? false)) {
                return false
              }
              if (isLocalNetworkHostForSw(url)) return false
              return true
            },
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'nip11-relay-info',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 // 1 hour
              },
              cacheableResponse: { statuses: [200] }
            }
          }
        ]
      },
      devOptions: {
        // Disable in dev to avoid registerSW.js 404 → index.html returned → SyntaxError (expected expression, got '<')
        enabled: false,
        type: 'module'
      }
    })
  ]
  }
})
