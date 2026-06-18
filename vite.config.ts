import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'
import type { Plugin, ProxyOptions } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import packageJson from './package.json'
import { hiddenRelayDevProxyPlugin } from './vite-hidden-relay-dev-proxy'
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
const OPTIONAL_DEV_PROXY_LOOPBACK_PORTS = [4000, 5000, 8010, 8090, 8091, 9876] as const

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
  '/api/asciidoctor',
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
    blob.includes('EHOSTUNREACH') ||
    blob.includes('ENOTFOUND') ||
    blob.includes('EAI_AGAIN') ||
    blob.includes('certificate has expired') ||
    blob.includes('CERT_HAS_EXPIRED') ||
    blob.includes('unable to verify the first certificate') ||
    blob.includes('self signed certificate')
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

function jsonProxyErrorHandler(
  status: number,
  body: Record<string, unknown>
): NonNullable<ProxyOptions['configure']> {
  return (proxy, _options) => {
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

const DEV_ANCILLARY_REMOTE_DEFAULT = 'https://jumble.imwald.eu'

/** Prod-like same-origin paths in `.env.development`; Vite forwards them in dev (see `devAncillaryProxy`). */
const DEV_ANCILLARY_PROXY_ROUTES = [
  {
    path: '/api/piper-tts',
    service: 'Read-aloud Piper TTS',
    localPort: 9876,
    unreachableError: 'piper_proxy_unreachable',
    unreachableHint: 'Start Piper TTS on :9876 — see PROXY_SETUP.md (or use default remote dev proxy)'
  },
  {
    path: '/api/languagetool',
    service: 'LanguageTool grammar',
    localPort: 8010,
    stripApiPrefix: '/api/languagetool',
    unreachableError: 'languagetool_proxy_unreachable',
    unreachableHint: 'Start LanguageTool on :8010 — see PROXY_SETUP.md (or use default remote dev proxy)'
  },
  {
    path: '/api/translate',
    service: 'LibreTranslate',
    localPort: 5000,
    stripApiPrefix: '/api/translate',
    unreachableError: 'translate_proxy_unreachable',
    unreachableHint: 'Start LibreTranslate on :5000 — see PROXY_SETUP.md (or use default remote dev proxy)'
  },
  {
    path: '/api/asciidoctor',
    service: 'AsciiDoctor EPUB/PDF export',
    localPort: 8091,
    stripApiPrefix: '/api/asciidoctor',
    unreachableError: 'asciidoctor_proxy_unreachable',
    unreachableHint:
      'Start the Wikistr AsciiDoctor server on :8091 (see ../wikistr/deployment) (or use default remote dev proxy)'
  },
  {
    path: '/sites',
    service: 'OG link preview (Puppeteer scraper)',
    localPort: 8090,
    unreachableError: 'og_proxy_unreachable',
    unreachableHint: 'Start OG scraper on :8090 — see PROXY_SETUP.md (or use default remote dev proxy)'
  }
] as const

/**
 * Where Vite proxies optional editor APIs (/api/translate, /api/languagetool, …) and /sites in dev.
 * - unset or `remote` → jumble.imwald.eu (prod-like, no local Docker)
 * - `local` → loopback sidecars (npm run dev:all)
 * - any https origin → that host (same path layout as prod)
 */
function resolveDevAncillaryRemoteOrigin(env: Record<string, string>): string | null {
  const raw = env.VITE_DEV_ANCILLARY_PROXY?.trim() ?? ''
  const norm = raw.toLowerCase()
  if (norm === 'local' || norm === '127.0.0.1' || norm === 'localhost') {
    return null
  }
  if (!raw || norm === 'remote') {
    return DEV_ANCILLARY_REMOTE_DEFAULT
  }
  return raw.replace(/\/+$/, '')
}

type DevAncillaryProxySpec = {
  localPort: number
  stripApiPrefix?: string
  unreachableHint: string
  unreachableError: string
}

function devAncillaryProxy(remoteOrigin: string | null, spec: DevAncillaryProxySpec) {
  const unreachableBody = remoteOrigin
    ? {
        ok: false,
        error: `${spec.unreachableError}_remote`,
        hint: `Cannot reach ${new URL(remoteOrigin).host} — check network/DNS, TLS certificate renewal, or set VITE_DEV_ANCILLARY_PROXY=local in .env.local`
      }
    : {
        ok: false,
        error: spec.unreachableError,
        hint: spec.unreachableHint
      }

  if (remoteOrigin) {
    return {
      target: remoteOrigin,
      changeOrigin: true,
      secure: true,
      configure: jsonProxyErrorHandler(502, unreachableBody)
    }
  }
  return {
    target: `http://127.0.0.1:${spec.localPort}`,
    changeOrigin: true,
    ...(spec.stripApiPrefix
      ? { rewrite: (p: string) => p.replace(new RegExp(`^${spec.stripApiPrefix}`), '') || '/' }
      : {}),
    configure: jsonProxyErrorHandler(503, unreachableBody)
  }
}

function logDevAncillaryProxyTarget(remoteOrigin: string | null): Plugin {
  return {
    name: 'log-dev-ancillary-proxy-target',
    apply: 'serve',
    configureServer(server) {
      const target = remoteOrigin ?? 'local Docker sidecars (127.0.0.1)'
      const services = DEV_ANCILLARY_PROXY_ROUTES.map((r) => `${r.path} (${r.service})`).join(', ')
      server.config.logger.info(`[dev] Optional services → ${target}\n[dev]   ${services}`)
    }
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
  /** Default: prod-like remote sidecars; `VITE_DEV_ANCILLARY_PROXY=local` for npm run dev:all. */
  const devAncillaryRemoteOrigin = resolveDevAncillaryRemoteOrigin(env)

  return {
    base: '/',
    define: {
      'import.meta.env.GIT_COMMIT': getGitHash(),
      'import.meta.env.APP_VERSION': getAppVersion()
    },
    optimizeDeps: {
      include: ['highlight.js/lib/common', 'highlight.js/lib/core']
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
        ...Object.fromEntries(
          DEV_ANCILLARY_PROXY_ROUTES.map((route) => [
            route.path,
            devAncillaryProxy(devAncillaryRemoteOrigin, route)
          ])
        ),
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
    /** Vendor + app entry chunks are intentionally large after manualChunks splitting. */
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
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

          if (norm.includes('/marked/') || norm.includes('node_modules/marked')) {
            return 'vendor-marked'
          }

          if (norm.includes('@codemirror/')) {
            return 'vendor-codemirror'
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
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts'
  },
  plugins: [
    logDevAncillaryProxyTarget(devAncillaryRemoteOrigin),
    react(),
    hiddenRelayDevProxyPlugin(),
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
          '**/workbox-*.js',
          // Lazy-loaded editor / locale chunks — precache on first use instead of blocking SW install.
          '**/vendor-asciidoctor*.js',
          '**/vendor-codemirror*.js',
          '**/vendor-tiptap*.js',
          '**/vendor-prosemirror*.js',
          '**/vendor-katex*.js',
          '**/vendor-highlight*.js',
          '**/vendor-marked*.js',
          '**/vendor-lightbox*.js',
          '**/i18n-locale-*.js'
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
            // Gutenberg cover JPGs are immutable; cache valid image responses only.
            urlPattern:
              /^https:\/\/(?:www\.)?gutenberg\.org\/cache\/epub\/\d+\/pg\d+\.cover\.(?:small|medium|large)\.jpg$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gutenberg-covers',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60
              },
              cacheableResponse: { statuses: [200] },
              plugins: [
                {
                  cacheWillUpdate: async ({ response }: { response: Response | undefined }) => {
                    if (!response?.ok) return null
                    const ct = (response.headers.get('content-type') ?? '').toLowerCase()
                    if (!ct.includes('image/')) return null
                    return response
                  }
                }
              ]
            }
          },
          {
            // Other Gutenberg pages (ebooks HTML, etc.) — never cache as images.
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
    }),
    process.env.ANALYZE === 'true' &&
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        open: false
      })
  ].filter(Boolean)
  }
})
