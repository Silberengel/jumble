export type ConsoleLogEntry = {
  type: string
  message: string
  formattedParts?: Array<{ text: string; style?: string }>
  timestamp: number
}

const MAX_ENTRIES = 1000

const buffer: ConsoleLogEntry[] = []
const listeners = new Set<() => void>()
let initialized = false
/** Skip ring-buffer capture while activity trace (or similar) writes directly + mirrors to console. */
let consoleCaptureSuppressed = 0
/** Same reference between mutations so `useSyncExternalStore` does not loop (React #185). */
let snapshot: readonly ConsoleLogEntry[] = buffer

function refreshSnapshot() {
  snapshot = buffer.length === 0 ? buffer : [...buffer]
}

function notifyListeners() {
  refreshSnapshot()
  for (const listener of listeners) {
    listener()
  }
}

function formatArgs(args: unknown[]): { message: string; formattedParts: Array<{ text: string; style?: string }> } {
  if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('%c')) {
    const formatString = args[0]
    const parts = formatString.split(/%c/g)
    const formattedParts: Array<{ text: string; style?: string }> = []

    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]
      const style = i < args.length - 1 && typeof args[i + 1] === 'string' ? String(args[i + 1]) : undefined
      formattedParts.push({ text, style })
    }

    const remainingArgs = args.slice(parts.length)
    if (remainingArgs.length > 0) {
      const remainingText = remainingArgs
        .map((arg) => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2)
            } catch {
              return String(arg)
            }
          }
          return String(arg)
        })
        .join(' ')
      if (formattedParts.length > 0) {
        formattedParts[formattedParts.length - 1].text += ' ' + remainingText
      } else {
        formattedParts.push({ text: remainingText })
      }
    }

    return { message: formattedParts.map((p) => p.text).join(''), formattedParts }
  }

  const message = args
    .map((arg) => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return String(arg)
        }
      }
      return String(arg)
    })
    .join(' ')

  return { message, formattedParts: [{ text: message }] }
}

function pushEntry(entry: ConsoleLogEntry) {
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES)
  }
  notifyListeners()
}

/** Append a log line to the in-app console modal (and notify subscribers). */
export function appendConsoleLogEntry(
  entry: Omit<ConsoleLogEntry, 'timestamp'> & { timestamp?: number }
): void {
  pushEntry({
    type: entry.type,
    message: entry.message,
    formattedParts: entry.formattedParts,
    timestamp: entry.timestamp ?? Date.now()
  })
}

/** Run `fn` without double-capturing mirrored `console.*` output. */
export function withConsoleCaptureSuppressed(fn: () => void): void {
  consoleCaptureSuppressed++
  try {
    fn()
  } finally {
    consoleCaptureSuppressed--
  }
}

export function isActivityTraceLogEntry(log: ConsoleLogEntry): boolean {
  return log.type === 'trace' || log.message.includes('[ActivityTrace]')
}

function captureLog(type: string, ...args: unknown[]) {
  if (consoleCaptureSuppressed > 0) return
  const { message, formattedParts } = formatArgs(args)
  // nostr-tools emits relay NOTICE via console.debug; keep buffer useful for real diagnostics.
  if (message.includes('NOTICE from')) {
    return
  }
  if (import.meta.env.DEV && message.includes('[feed:')) {
    return
  }
  pushEntry({ type, message, formattedParts, timestamp: Date.now() })
}

/** Ring buffer of recent console output (installed at app startup). */
export function getConsoleLogBuffer(): readonly ConsoleLogEntry[] {
  return snapshot
}

export function clearConsoleLogBuffer() {
  buffer.length = 0
  notifyListeners()
}

export function subscribeConsoleLogBuffer(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Wrap console.* after other patches (e.g. error-suppression) so all output is retained. */
export function initConsoleLogCapture() {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  const originalLog = console.log.bind(console)
  const originalError = console.error.bind(console)
  const originalWarn = console.warn.bind(console)
  const originalInfo = console.info.bind(console)
  const originalDebug = console.debug.bind(console)

  console.log = (...args: unknown[]) => {
    captureLog('log', ...args)
    originalLog(...args)
  }
  console.error = (...args: unknown[]) => {
    captureLog('error', ...args)
    originalError(...args)
  }
  console.warn = (...args: unknown[]) => {
    captureLog('warn', ...args)
    originalWarn(...args)
  }
  console.info = (...args: unknown[]) => {
    captureLog('info', ...args)
    originalInfo(...args)
  }
  console.debug = (...args: unknown[]) => {
    captureLog('debug', ...args)
    originalDebug(...args)
  }
}

if (typeof window !== 'undefined') {
  initConsoleLogCapture()
}
