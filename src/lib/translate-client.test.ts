import { afterEach, describe, expect, it, vi } from 'vitest'
import { shouldSkipMachineTranslatePlainCore, translatePlainText } from '@/lib/translate-client'

vi.mock('@/constants', () => ({
  TRANSLATE_URL: 'http://test/translate'
}))

vi.mock('@/lib/electron-aware-fetch', () => ({
  electronAwareFetch: vi.fn()
}))

describe('shouldSkipMachineTranslatePlainCore', () => {
  it('returns true for one or more ASCII hashtags with spaces', () => {
    expect(shouldSkipMachineTranslatePlainCore('#meme #memes #memestr #plebchain')).toBe(true)
    expect(shouldSkipMachineTranslatePlainCore('  #a #b  ')).toBe(true)
  })

  it('returns false when there is non-hashtag prose', () => {
    expect(shouldSkipMachineTranslatePlainCore('#meme is cool')).toBe(false)
    expect(shouldSkipMachineTranslatePlainCore('see #meme')).toBe(false)
  })

  it('returns true for unicode hashtag letters', () => {
    expect(shouldSkipMachineTranslatePlainCore('#café #naïve')).toBe(true)
  })
})

describe('translatePlainText', () => {
  afterEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('throws when the translate proxy returns 503 instead of returning the source text', async () => {
    const { electronAwareFetch } = await import('@/lib/electron-aware-fetch')
    vi.mocked(electronAwareFetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 503 })
    )

    await expect(translatePlainText('Hello world', 'bn', 'auto')).rejects.toThrow(
      /Translation service is unavailable/
    )
  })
})
