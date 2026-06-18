/**
 * Debug utilities for development and troubleshooting
 *
 * Usage in browser console:
 * - imwaldDebug.enable() - Enable debug logging
 * - imwaldDebug.disable() - Disable debug logging
 * - imwaldDebug.traceOn({ verbose: true }) - Activity tracer (renders, relays, ingest, …)
 * - imwaldDebug.traceSummary() - Print activity counters now
 * - imwaldDebug.status() - Check current debug status
 */

import activityTrace from './activity-trace'
import logger from './logger'

interface DebugUtils {
  enable: () => void
  disable: () => void
  status: () => { enabled: boolean; level: string }
  log: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  perf: (message: string, ...args: unknown[]) => void
  traceOn: (options?: { verbose?: boolean; debug?: boolean }) => void
  traceOff: () => void
  traceSummary: () => void
}

const debugUtils: DebugUtils = {
  enable: () => {
    logger.setDebugMode(true)
    logger.info('🔧 Imwald debug logging enabled')
  },

  disable: () => {
    logger.setDebugMode(false)
    logger.info('🔧 Imwald debug logging disabled')
  },

  status: () => {
    const enabled = logger.isDebugEnabled()
    logger.info(`🔧 Imwald debug status: ${enabled ? 'ENABLED' : 'DISABLED'}`)
    logger.info(`🔧 Activity trace: ${activityTrace.isEnabled() ? 'ENABLED' : 'DISABLED'}`)
    return { enabled, level: enabled ? 'debug' : 'info' }
  },

  log: (message: string, ...args: unknown[]) => {
    logger.debug(message, ...args)
  },

  warn: (message: string, ...args: unknown[]) => {
    logger.warn(message, ...args)
  },

  error: (message: string, ...args: unknown[]) => {
    logger.error(message, ...args)
  },

  perf: (message: string, ...args: unknown[]) => {
    logger.perf(message, ...args)
  },

  traceOn: (options) => {
    activityTrace.enable({ debug: true, ...options })
  },

  traceOff: () => {
    activityTrace.disable()
  },

  traceSummary: () => {
    activityTrace.summary(true)
  }
}

// Expose debug utilities globally in development
if (import.meta.env.DEV) {
  ;(window as unknown as { imwaldDebug: DebugUtils; jumbleDebug: DebugUtils }).imwaldDebug = debugUtils
  ;(window as unknown as { jumbleDebug: DebugUtils }).jumbleDebug = debugUtils
}
