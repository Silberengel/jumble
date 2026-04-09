import { describe, expect, it } from 'vitest'
import { mergeNip94Pairs, nip94PairsToImetaTag } from './upload-nip94-imeta'

describe('mergeNip94Pairs', () => {
  it('keeps client fields when server is empty', () => {
    const client = [
      ['url', 'https://cdn.example/a.webp'],
      ['m', 'image/webp'],
      ['x', 'abc'],
      ['size', '1234']
    ]
    const merged = mergeNip94Pairs(client, [])
    expect(merged).toEqual(client)
  })

  it('lets non-empty server values overwrite client', () => {
    const client = [
      ['url', 'https://cdn.example/a.webp'],
      ['m', 'image/webp'],
      ['x', 'clienthash'],
      ['dim', '100x100'],
      ['blurhash', 'clientbh']
    ]
    const server = [
      ['url', 'https://cdn.example/a.webp'],
      ['blurhash', 'serverbh'],
      ['dim', '200x200']
    ]
    const merged = mergeNip94Pairs(client, server)
    const map = Object.fromEntries(merged.filter(([k]) => k !== 'fallback'))
    expect(map.url).toBe('https://cdn.example/a.webp')
    expect(map.blurhash).toBe('serverbh')
    expect(map.dim).toBe('200x200')
    expect(map.x).toBe('clienthash')
    expect(map.m).toBe('image/webp')
  })

  it('ignores empty server values so client wins', () => {
    const client = [['url', 'https://x.test/u'], ['m', 'image/png'], ['x', 'deadbeef']]
    const server = [['blurhash', ''], ['m', '']]
    const merged = mergeNip94Pairs(client, server)
    const map = Object.fromEntries(merged.filter(([k]) => k !== 'fallback'))
    expect(map.m).toBe('image/png')
    expect(map.blurhash).toBeUndefined()
  })

  it('merges fallback with server first then unique client', () => {
    const client = [
      ['url', 'https://a'],
      ['fallback', 'https://mirror1'],
      ['fallback', 'https://mirror2']
    ]
    const server = [['fallback', 'https://mirror1'], ['fallback', 'https://srv']]
    const merged = mergeNip94Pairs(client, server)
    const fbs = merged.filter(([k]) => k === 'fallback').map(([, v]) => v)
    expect(fbs).toEqual(['https://mirror1', 'https://srv', 'https://mirror2'])
  })
})

describe('nip94PairsToImetaTag', () => {
  it('builds a single imeta row', () => {
    const row = nip94PairsToImetaTag([
      ['url', 'https://u'],
      ['m', 'image/jpeg']
    ])
    expect(row[0]).toBe('imeta')
    expect(row).toContain('url https://u')
    expect(row).toContain('m image/jpeg')
  })
})
