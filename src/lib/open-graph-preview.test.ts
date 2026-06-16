import { describe, expect, it } from 'vitest'
import { hasUsableOpenGraphMetadata } from './open-graph-preview'

describe('hasUsableOpenGraphMetadata', () => {
  it('is false when title, description, and image are empty', () => {
    expect(hasUsableOpenGraphMetadata({})).toBe(false)
    expect(hasUsableOpenGraphMetadata({ title: '  ', description: '', image: undefined })).toBe(false)
  })

  it('is true when any OG field is present', () => {
    expect(hasUsableOpenGraphMetadata({ title: 'Hello' })).toBe(true)
    expect(hasUsableOpenGraphMetadata({ description: 'Summary' })).toBe(true)
    expect(hasUsableOpenGraphMetadata({ image: 'https://example.com/og.jpg' })).toBe(true)
  })
})
