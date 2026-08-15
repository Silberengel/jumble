/**
 * Suppress expected console errors that are not actionable
 * This helps reduce noise in the development console
 */

import { isRelayAuthAccessDeniedMessage } from '@/lib/relay-nip42-auth'

// Track suppressed errors to avoid spam
const suppressedErrors = new Set<string>()

/** Flatten console args so URLs and Error messages are visible (join(' ') loses nested fields). */
function formatConsoleArgs(args: readonly unknown[]): string {
  const parts: string[] = []
  for (const a of args) {
    if (typeof a === 'string') {
      parts.push(a)
    } else if (a instanceof Error) {
      parts.push(a.message, a.stack ?? '')
    } else if (a !== null && typeof a === 'object') {
      const o = a as Record<string, unknown>
      if (typeof o.message === 'string') parts.push(o.message)
      if (typeof o.reason === 'string') parts.push(o.reason)
      if (typeof o.url === 'string') parts.push(o.url)
    } else {
      parts.push(String(a))
    }
  }
  return parts.join(' ')
}

function isExpectedFaviconNetworkNoise(message: string): boolean {
  if (!message.includes('favicon.ico')) return false
  return (
    message.includes('NS_BINDING') ||
    message.includes('aborted') ||
    message.includes('ORB') ||
    message.includes('CORRUPTED') ||
    message.includes('404') ||
    message.includes('403') ||
    message.includes('blockiert') ||
    message.includes('blocked') ||
    message.includes('CORS') ||
    message.includes('Failed to load') ||
    message.includes('Laden fehlgeschlagen') ||
    message.includes('net::ERR_')
  )
}

/** Expected dev-only noise: optional proxies, profile cache misses, wallet timeouts, editor quirks. */
function isExpectedDevAppNoise(message: string): boolean {
  if (
    message.includes('[ReplaceableEventService] Profile batch network load timed out') ||
    message.includes('[ReplaceableEventService] fetchProfilesForPubkeys exceeded wall timeout')
  ) {
    return true
  }
  if (
    message.includes('[LanguageTool] HTTP error') ||
    message.includes('LanguageTool: 5') ||
    message.includes('[Translate] Optional translate proxy offline') ||
    message.includes('[Translate] /languages skipped') ||
    message.includes('[Optional proxy] Sites proxy returned')
  ) {
    return true
  }
  if (
    message.includes('Failed to request get_info') ||
    message.includes('Using minimal getInfo') ||
    message.includes('reply timeout: event')
  ) {
    return true
  }
  if (message.includes('NIP-04 encryption is about to be deprecated')) {
    return true
  }
  if (
    message.includes('TextSelection endpoint not pointing into a node with inline content') ||
    message.includes('scroll-verknüpften Positionierungseffekt') ||
    message.includes('scroll-linked positioning effect')
  ) {
    return true
  }
  if (
    message.includes('Cookie') &&
    (message.includes('abgelehnt') || message.includes('rejected')) &&
    message.includes('SameSite')
  ) {
    return true
  }
  if (
    message.includes('Cross-Origin-Resource-Policy') ||
    (message.includes('CORP') && message.includes('blockiert'))
  ) {
    return true
  }
  if (
    message.includes('[QueryService] req_end') ||
    message.includes('[relay-req]') ||
    message.includes('[FeedPaint]') ||
    message.includes('[LiveActivities] poll done') ||
    message.includes('[RelayPoolIdle]')
  ) {
    return true
  }
  if (message.includes('[vite]') && (message.includes('connected') || message.includes('connecting'))) {
    return true
  }
  if (message.includes('[feed:')) {
    return true
  }
  if (
    message.includes('[SpellsPage] Spell feed') ||
    message.includes('[NIP-42] Auth accepted') ||
    message.includes('[RelayInfo] NIP-11 received') ||
    message.includes('[client] Prewarm:')
  ) {
    return true
  }
  if (
    (message.includes('feeds.nostrarchives.com') || message.includes('search.nostrarchives.com')) &&
    (message.includes('CORS') ||
      message.includes('Gleiche-Quelle') ||
      message.includes('Cross-Origin') ||
      message.includes('Access-Control-Allow-Origin'))
  ) {
    return true
  }
  if (
    message.includes('api.nostrarchives.com') &&
    (message.includes('404') || message.includes('Not Found'))
  ) {
    return true
  }
  if (
    message.includes('localhost:4869') ||
    message.includes('127.0.0.1:4869') ||
    message.includes('ws://localhost:4869')
  ) {
    if (
      message.includes('[PublishEvent]') ||
      message.includes('[Publish]') ||
      message.includes('[RelayOp]') ||
      message.includes('connection failed') ||
      message.includes('connection timed out') ||
      message.includes('Local relay connection timeout') ||
      message.includes('kann keine Verbindung') ||
      message.includes('can\'t establish a connection') ||
      message.includes("can't establish a connection")
    ) {
      return true
    }
  }
  if (
    message.includes('profiles.nostrver.se') &&
    (message.includes('kann keine Verbindung') ||
      message.includes('can\'t establish a connection') ||
      message.includes("can't establish a connection"))
  ) {
    return true
  }
  if (message.includes('[FetchRelayLists] Network relay-list fetch exceeded budget')) {
    return true
  }
  return false
}

/** nostr-tools logs relay NOTICE via console.debug; timeout / too-many-steps are normal under load. */
function isExpectedNostrRelayNotice(message: string): boolean {
  return (
    message.includes('NOTICE from') ||
    message.includes('Too many subscriptions') ||
    message.includes('Subscription rejected') ||
    message.includes('too many concurrent REQs') ||
    message.includes('too many kinds')
  )
}

function isExpectedRelayWebSocketNoise(message: string): boolean {
  if (message.includes('WebSocket connection to') || message.includes('Close received after close')) {
    return true
  }
  // Firefox EN (straight and curly apostrophe)
  if (
    (message.includes('establish a connection to the server') ||
      message.includes('Firefox can') ||
      message.includes('Firefox can\u2019t')) &&
    (message.includes('wss://') || message.includes('ws://'))
  ) {
    return true
  }
  // Firefox DE + other locales often omit the word "WebSocket"
  if (
    message.includes('kann keine Verbindung') &&
    (message.includes('wss://') || message.includes('ws://') || message.includes('Server unter'))
  ) {
    return true
  }
  // Gecko network codes for dead relays / TLS issues
  if (
    message.includes('NS_ERROR_CONNECTION_REFUSED') ||
    message.includes('NS_ERROR_NET_RESET') ||
    message.includes('NS_ERROR_NET_INTERRUPT') ||
    message.includes('NS_ERROR_NET_TIMEOUT') ||
    message.includes('NS_ERROR_UNKNOWN_HOST')
  ) {
    return true
  }
  return false
}

function suppressExpectedErrors() {
  // Override console.error to filter out expected errors
  const originalConsoleError = console.error
  
  console.error = (...args: any[]) => {
    const message = formatConsoleArgs(args)

    if (isExpectedFaviconNetworkNoise(message)) {
      return
    }

    if (isExpectedRelayWebSocketNoise(message)) {
      return
    }

    if (import.meta.env.DEV && isExpectedDevAppNoise(message)) {
      return
    }

    if (message.includes('NS_BINDING_ABORTED')) {
      return
    }

    // Suppress CORS errors for external websites (EN + DE Firefox strings)
    if (message.includes('CORS policy') ||
        message.includes('Access-Control-Allow-Origin') ||
        message.includes('has been blocked by CORS policy') ||
        message.includes('blocked by CORS policy') ||
        message.includes('Quellübergreifende') ||
        message.includes('Gleiche-Quelle-Regel') ||
        message.includes('Cross-Origin') && message.includes('blockiert') ||
        (message.includes('Access to fetch at') && message.includes('has been blocked')) ||
        (message.includes('from origin') && message.includes('has been blocked'))) {
      return
    }
    
    // Suppress network errors for external websites (including CORS-related failures)
    // Suppress all ERR_FAILED errors as they're often CORS-related or expected failures
    if (message.includes('net::ERR_FAILED')) {
      return
    }
    
    // Suppress postMessage origin errors
    if (message.includes('Failed to execute \'postMessage\' on \'DOMWindow\'')) {
      return
    }
    
    // Suppress YouTube API warnings
    if (message.includes('Unrecognized feature: \'web-share\'')) {
      return
    }
    
    // Suppress Canvas2D warnings
    if (message.includes('Canvas2D: Multiple readback operations')) {
      return
    }
    
    // Suppress React "Maximum update depth exceeded" warnings
    // These are often caused by third-party libraries (e.g., Radix UI Popper)
    // where we cannot modify the source code directly
    if (message.includes('Maximum update depth exceeded')) {
      return
    }
    
    // Suppress Radix UI Dialog accessibility warnings
    // These are informational warnings about DialogTitle/Description
    // All our dialogs have titles (some hidden with sr-only for accessibility)
    const isRadixDialogWarning =
      (message.includes('DialogContent') || message.includes('DialogTitle')) &&
      (message.includes('requires') ||
        message.includes('Missing') ||
        message.includes('aria-describedby') ||
        message.includes('DialogTitle'))
    if (isRadixDialogWarning) {
      return
    }
    
    // Suppress Workbox precaching errors for development modules
    if (message.includes('Precaching did not find a match') && (
      message.includes('@vite/client') ||
      message.includes('main.tsx') ||
      message.includes('src/') ||
      message.includes('node_modules/')
    )) {
      return
    }

    // Firefox: SW CacheFirst/NetworkOnly reject when flaky cover CDNs fail (pre-update SW).
    if (
      message.includes('no-response') &&
      (message.includes('ServiceWorker') ||
        message.includes('FetchEvent.respondWith') ||
        message.includes('workbox') ||
        message.includes('covers.openlibrary.org') ||
        message.includes('githubassets.com'))
    ) {
      return
    }

    // Firefox ignores no-referrer-when-downgrade on cross-site images (one warn per cover).
    if (
      message.includes('Referrer Policy') ||
      message.includes('Referrer-Policy') ||
      message.includes('weniger eingeschränkte Referrer Policy')
    ) {
      return
    }
    
    // Suppress "too many concurrent REQs" errors (handled by circuit breaker)
    if (message.includes('too many concurrent REQs')) {
      return
    }
    
    // Suppress relay overload errors (handled by throttling)
    if (message.includes('Relay overloaded - too many concurrent requests')) {
      return
    }
    
    // Suppress nostr-tools relay NOTICE / overload errors
    if (isExpectedNostrRelayNotice(message)) {
      return
    }
    if (
      message.includes('NOTICE from') &&
      (message.includes('ERROR:') ||
        message.includes('connection closed') ||
        message.includes('connection errored'))
    ) {
      return
    }
    
    // Suppress Ping timeout errors
    if (message.includes('Ping timeout')) {
      return
    }
    
    // Suppress invalid URL errors (often from empty or malformed relay URLs)
    if (message.includes('Invalid URL') || 
        message.includes('Failed to construct \'URL\'') ||
        (message.includes('wss://') && message.includes('Invalid')) ||
        (message.includes('ws://') && message.includes('Invalid'))) {
      return
    }
    
    // Suppress invalid URI / media resource errors (e.g. empty img src resolving to origin)
    if (message.includes('Ungültige URI') ||
        message.includes('Invalid URI') ||
        message.includes('Medienressource') ||
        (message.includes('fehlgeschlagen') && message.includes('URI')) ||
        message.includes('Laden der Medienressource') ||
        message.includes('Failed to load media resource') ||
        message.includes('OpaqueResponseBlocking') ||
        (message.includes('image/svg+xml') &&
          (message.includes('nicht unterstützt') ||
            message.includes('Keine Decoder') ||
            message.includes('Medien können nicht'))) ||
        message.includes('A resource is blocked by OpaqueResponseBlocking') ||
        message.includes('NS_ERROR_CORRUPTED_CONTENT')) {
      return
    }
    
    // Suppress "unrecognised filter item" errors from relays
    if (message.includes('unrecognised filter item') || message.includes('unrecognized filter item')) {
      return
    }

    // Suppress "unreachable code after return" from third-party scripts (e.g. YouTube embed, bundled deps)
    if (message.includes('unreachable code after return statement')) {
      return
    }

    // Call original console.error for unexpected errors
    originalConsoleError.apply(console, args)
  }
  
  // Override console.warn to filter out expected warnings
  const originalConsoleWarn = console.warn
  
  console.warn = (...args: any[]) => {
    const message = formatConsoleArgs(args)

    if (isExpectedFaviconNetworkNoise(message)) {
      return
    }

    if (isExpectedRelayWebSocketNoise(message)) {
      return
    }

    if (import.meta.env.DEV && isExpectedDevAppNoise(message)) {
      return
    }
    
    // Suppress invalid URI / failed media resource (e.g. empty img src)
    if (message.includes('Ungültige URI') ||
        message.includes('Invalid URI') ||
        message.includes('Medienressource') ||
        (message.includes('fehlgeschlagen') && message.includes('URI')) ||
        message.includes('Laden der Medienressource') ||
        message.includes('Failed to load media resource') ||
        message.includes('OpaqueResponseBlocking') ||
        message.includes('A resource is blocked by OpaqueResponseBlocking') ||
        (message.includes('image/svg+xml') &&
          (message.includes('nicht unterstützt') ||
            message.includes('Keine Decoder') ||
            message.includes('Medien können nicht')))) {
      return
    }

    // German Firefox CORS (same-origin policy)
    if (message.includes('Quellübergreifende') ||
        message.includes('Gleiche-Quelle-Regel') ||
        (message.includes('Cross-Origin') && message.includes('blockiert'))) {
      return
    }

    if (message.includes('NS_BINDING_ABORTED')) {
      return
    }
    
    // Suppress React DevTools suggestion (only show once)
    if (message.includes('Download the React DevTools')) {
      if (suppressedErrors.has('react-devtools')) {
        return
      }
      suppressedErrors.add('react-devtools')
    }
    
    // Suppress Workbox warnings
    if (message.includes('workbox') && (
      message.includes('will not be cached') ||
      message.includes('Network request for') ||
      message.includes('returned a response with status') ||
      message.includes('no-response')
    )) {
      return
    }

    // Firefox ignores no-referrer-when-downgrade on cross-site images (one warn per cover).
    if (
      message.includes('Referrer Policy') ||
      message.includes('Referrer-Policy') ||
      message.includes('weniger eingeschränkte Referrer Policy')
    ) {
      return
    }
    
    // Suppress Canvas2D warnings (performance suggestions)
    if (message.includes('Canvas2D') || 
        message.includes('Multiple readback operations') ||
        message.includes('willReadFrequently') ||
        message.includes('getImageData')) {
      return
    }
    
    // Suppress CORS policy warnings (EN + DE)
    if (message.includes('CORS policy') ||
        message.includes('Access-Control-Allow-Origin') ||
        message.includes('has been blocked by CORS policy') ||
        message.includes('blocked by CORS policy') ||
        message.includes('Quellübergreifende') ||
        message.includes('Gleiche-Quelle-Regel') ||
        (message.includes('Cross-Origin') && message.includes('blockiert')) ||
        (message.includes('Access to fetch') && message.includes('blocked')) ||
        (message.includes('from origin') && message.includes('blocked'))) {
      return
    }
    
    // Suppress network fetch errors that are expected (CORS, etc.)
    if (message.includes('Failed to fetch') || 
        message.includes('net::ERR_FAILED') ||
        (message.includes('GET ') && message.includes('blocked')) ||
        (message.includes('fetch') && message.includes('blocked'))) {
      return
    }
    
    // Suppress Radix UI Dialog accessibility warnings
    // These are informational warnings about DialogTitle/Description
    // All our dialogs have titles (some hidden with sr-only for accessibility)
    const isRadixDialogWarn =
      (message.includes('DialogContent') || message.includes('DialogTitle')) &&
      (message.includes('requires') ||
        message.includes('Missing') ||
        message.includes('aria-describedby') ||
        message.includes('DialogTitle'))
    if (isRadixDialogWarn) {
      return
    }
    
    if (isExpectedNostrRelayNotice(message)) {
      return
    }

    // Suppress "unreachable code after return" from third-party scripts (e.g. YouTube embed, bundled deps)
    if (message.includes('unreachable code after return statement')) {
      return
    }

    // Call original console.warn for unexpected warnings
    originalConsoleWarn.apply(console, args)
  }
  
  // Override console.log to filter out expected logs
  const originalConsoleLog = console.log
  
  console.log = (...args: any[]) => {
    const message = formatConsoleArgs(args)

    if (isExpectedFaviconNetworkNoise(message) || isExpectedRelayWebSocketNoise(message)) {
      return
    }

    if (import.meta.env.DEV && isExpectedDevAppNoise(message)) {
      return
    }
    
    // Firefox ORB: cross-origin favicon / relay icon requests often hit HTML or wrong MIME; not actionable in-app.
    if (
      message.includes('OpaqueResponseBlocking') ||
      (message.includes('favicon.ico') &&
        (message.includes('blocked') || message.includes('blockiert')))
    ) {
      return
    }

    // Suppress React DevTools suggestion (only show once)
    if (message.includes('Download the React DevTools')) {
      return
    }
    
    // Suppress Workbox logs (do not filter [NoteStats] — app diagnostics use that tag)
    if (message.includes('workbox')) {
      return
    }
    
    if (isExpectedNostrRelayNotice(message)) {
      return
    }

    // Nostr browser extensions (signing / debug)
    if (message.includes('[nos2x') || message.includes('nos2x-fox:')) {
      return
    }
    
    // Call original console.log for unexpected logs
    originalConsoleLog.apply(console, args)
  }

  const originalConsoleDebug = console.debug

  console.debug = (...args: any[]) => {
    const message = formatConsoleArgs(args)

    if (isExpectedNostrRelayNotice(message)) {
      return
    }

    if (import.meta.env.DEV && isExpectedDevAppNoise(message)) {
      return
    }

    originalConsoleDebug.apply(console, args)
  }
}

// Suppress unhandled promise rejections that are expected (e.g. SW "operation is insecure" in dev)
function suppressExpectedRejections() {
  if (typeof window === 'undefined') return
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message ?? String(event.reason)
    if (msg.includes('The operation is insecure') || (event.reason?.name === 'SecurityError' && msg.includes('insecure'))) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    // nostr-tools: relay.send() attaches to connectionPromise without .catch(); if the socket
    // closes before the REQ is sent, the rejection was previously uncaught (SendingOnClosedConnection).
    if (event.reason?.name === 'SendingOnClosedConnection') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.reason?.name === 'RelayAuthAccessDeniedError' || isRelayAuthAccessDeniedMessage(msg)) {
      event.preventDefault()
      event.stopPropagation()
    }
  })
}

// Initialize error suppression
if (typeof window !== 'undefined') {
  suppressExpectedErrors()
  suppressExpectedRejections()
}
