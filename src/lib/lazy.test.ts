import { describe, expect, it, vi } from 'vitest'
import { Lazy, LazyStatus } from '@/lib/lazy'

describe('Lazy', () => {
  it('memoizes successful resolution', async () => {
    const resolver = vi.fn(async () => 'ok')
    const lazy = new Lazy(resolver)

    expect(await lazy.value()).toBe('ok')
    expect(await lazy.value()).toBe('ok')
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(lazy.status).toBe(LazyStatus.Resolved)
  })

  it('memoizes error state and does not retry the resolver', async () => {
    const resolver = vi.fn(async () => {
      throw new Error('fail')
    })
    const lazy = new Lazy(resolver)

    expect(await lazy.value()).toBeNull()
    expect(await lazy.value()).toBeNull()
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(lazy.status).toBe(LazyStatus.Error)
  })

  it('dedupes concurrent value() calls while pending', async () => {
    let resolve!: (value: number) => void
    const resolver = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolve = r
        })
    )
    const lazy = new Lazy(resolver)

    const first = lazy.value()
    const second = lazy.value()
    expect(resolver).toHaveBeenCalledTimes(1)

    resolve(42)
    expect(await first).toBe(42)
    expect(await second).toBe(42)
  })
})
