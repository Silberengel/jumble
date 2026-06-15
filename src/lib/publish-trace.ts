import logger from '@/lib/logger'

let traceCounter = 0

export type PublishTrace = {
  readonly id: string
  step: (phase: string, detail?: Record<string, unknown>) => void
  end: (detail?: Record<string, unknown>) => void
}

/** Phased publish logging at INFO — visible in dev without `imwald-debug`. */
export function startPublishTrace(label: string): PublishTrace {
  const id = `${label}#${++traceCounter}`
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let last = t0

  const step = (phase: string, detail?: Record<string, unknown>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const totalMs = Math.round(now - t0)
    const stepMs = Math.round(now - last)
    last = now
    if (detail && Object.keys(detail).length > 0) {
      logger.info(`[PublishTrace] ${id} +${totalMs}ms (Δ${stepMs}ms) ${phase}`, detail)
    } else {
      logger.info(`[PublishTrace] ${id} +${totalMs}ms (Δ${stepMs}ms) ${phase}`)
    }
  }

  step('start')

  return {
    id,
    step,
    end: (detail?: Record<string, unknown>) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const totalMs = Math.round(now - t0)
      if (detail && Object.keys(detail).length > 0) {
        logger.info(`[PublishTrace] ${id} finished in ${totalMs}ms`, detail)
      } else {
        logger.info(`[PublishTrace] ${id} finished in ${totalMs}ms`)
      }
    }
  }
}
