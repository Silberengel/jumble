import { describe, expect, it } from 'vitest'
import {
  cleanUrl,
  migrateLegacyHappyTavernMediaUrl,
  migrateLegacyHappyTavernNip94Tags,
  resolvePrimalBlossomPlayableUrl
} from '@/lib/url'

describe('migrateLegacyHappyTavernMediaUrl', () => {
  it('rewrites 0x0.happytavern.co to 0x0.oslim.dev', () => {
    expect(migrateLegacyHappyTavernMediaUrl('https://0x0.happytavern.co/upload')).toBe(
      'https://0x0.oslim.dev/upload'
    )
  })

  it('rewrites blossom.happytavern.co and upgrades http to https', () => {
    const hash = '759e5aa127171d3c26be9e515e2a3c9afe998c807d3b34c78961b2463bd55770'
    expect(migrateLegacyHappyTavernMediaUrl(`http://blossom.happytavern.co/${hash}.gif`)).toBe(
      `https://blossom.oslim.dev/${hash}.gif`
    )
  })

  it('leaves unrelated hosts unchanged', () => {
    const url = 'https://blossom.primal.net/abc123.jpg'
    expect(migrateLegacyHappyTavernMediaUrl(url)).toBe(url)
  })
})

describe('resolvePrimalBlossomPlayableUrl', () => {
  it('applies Happy Tavern migration before Primal mirror logic', () => {
    const hash = '759e5aa127171d3c26be9e515e2a3c9afe998c807d3b34c78961b2463bd55770'
    expect(
      resolvePrimalBlossomPlayableUrl(`http://blossom.happytavern.co/${hash}.gif`)
    ).toBe(`https://blossom.oslim.dev/${hash}.gif`)
  })
})

describe('cleanUrl', () => {
  it('migrates legacy Happy Tavern hosts before stripping tracking params', () => {
    const hash = '2a68d217adaa2a60df5c739c32b952b5b906dd6f8f358121b4487889681d8c80'
    expect(cleanUrl(`https://0x0.happytavern.co/${hash}.webp`)).toBe(
      `https://0x0.oslim.dev/${hash}.webp`
    )
  })
})

describe('migrateLegacyHappyTavernNip94Tags', () => {
  it('rewrites url tag values', () => {
    const hash = '2a68d217adaa2a60df5c739c32b952b5b906dd6f8f358121b4487889681d8c80'
    expect(
      migrateLegacyHappyTavernNip94Tags([
        ['url', `https://0x0.happytavern.co/${hash}.webp`],
        ['m', 'image/webp']
      ])
    ).toEqual([
      ['url', `https://0x0.oslim.dev/${hash}.webp`],
      ['m', 'image/webp']
    ])
  })
})
