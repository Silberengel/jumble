import { describe, expect, it } from 'vitest'
import { isPromiseTimeoutError, racePromiseWithTimeout } from './async-timeout'

describe('racePromiseWithTimeout', () => {
  it('resolves when promise finishes before deadline', async () => {
    await expect(racePromiseWithTimeout(Promise.resolve(42), 500)).resolves.toBe(42)
  })

  it('rejects with PromiseTimeoutError when deadline elapses first', async () => {
    await expect(
      racePromiseWithTimeout(new Promise<number>(() => {}), 20, 'slow')
    ).rejects.toMatchObject({ name: 'PromiseTimeoutError', message: 'slow' })
  })

  it('isPromiseTimeoutError identifies timeout errors', async () => {
    try {
      await racePromiseWithTimeout(new Promise(() => {}), 10)
    } catch (err) {
      expect(isPromiseTimeoutError(err)).toBe(true)
    }
  })
})
