import { afterEach, describe, expect, it, vi } from 'vitest'

describe('activityTrace', () => {
  afterEach(async () => {
    const { default: activityTrace } = await import('./activity-trace')
    activityTrace.disable()
    activityTrace.reset()
    vi.restoreAllMocks()
  })

  it('counts events when enabled', async () => {
    const { default: activityTrace } = await import('./activity-trace')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    activityTrace.enable({ summaryIntervalMs: 0 })
    activityTrace.trace('state', 'test.event', { ok: true })
    activityTrace.trace('relay', 'query.start', { source: 'TestHarness.demo', relayCount: 2 })
    activityTrace.summary(true)
    expect(logSpy).toHaveBeenCalled()
    const sources = activityTrace.relaySources(5)
    expect(sources.some((r) => r.source === 'TestHarness.demo')).toBe(true)
  })
})
