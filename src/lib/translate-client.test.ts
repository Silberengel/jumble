import { describe, expect, it } from 'vitest'
import { shouldSkipMachineTranslatePlainCore } from '@/lib/translate-client'

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
