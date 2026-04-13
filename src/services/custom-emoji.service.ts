import { getEmojisAndEmojiSetsFromEvent, getEmojisFromEvent } from '@/lib/event-metadata'
import { recordEmojiUsed } from '@/lib/recently-used-emojis'
import client from '@/services/client.service'
import { TEmoji } from '@/types'
import { sha256 } from '@noble/hashes/sha2'
import FlexSearch from 'flexsearch'
import { Event, kinds } from 'nostr-tools'

class CustomEmojiService {
  static instance: CustomEmojiService

  private emojiMap = new Map<string, TEmoji>()
  /** Hex pubkey (lowercase) of the event that introduced each custom emoji into the index. */
  private emojiAuthorById = new Map<string, string>()
  private emojiIndex: FlexSearch.Index = new FlexSearch.Index({
    tokenize: 'full'
  })
  private indexUpdateListeners = new Set<() => void>()

  constructor() {
    if (!CustomEmojiService.instance) {
      CustomEmojiService.instance = this
    }
    return CustomEmojiService.instance
  }

  /** Subscribe to runs after {@link init} finishes loading emoji sets (picker can refresh custom list). */
  subscribeIndexUpdate(fn: () => void): () => void {
    this.indexUpdateListeners.add(fn)
    return () => this.indexUpdateListeners.delete(fn)
  }

  private notifyIndexUpdate() {
    this.indexUpdateListeners.forEach((f) => f())
  }

  private reset() {
    this.emojiMap.clear()
    this.emojiAuthorById.clear()
    this.emojiIndex = new FlexSearch.Index({ tokenize: 'full' })
  }

  /**
   * Load NIP-30 custom emoji for the account: kind 0 `emoji` tags, kind 10030 list (+ `a` → 30030 sets), and 30030 packs.
   * Merges `userEmojiListEvent` / `metadataEvent` with a relay fetch so we still load when hydrate missed events.
   */
  async init(
    userEmojiListEvent: Event | null,
    accountPubkey?: string | null,
    metadataEvent?: Event | null,
    /** Events we just published (or must win over a slow relay fetch), merged before inventory fetch. */
    seedEvents?: Event[] | null
  ) {
    this.reset()
    const pk = accountPubkey?.trim().toLowerCase() ?? ''
    const hasPk = /^[0-9a-f]{64}$/.test(pk)

    const byId = new Map<string, Event>()
    for (const ev of seedEvents ?? []) {
      if (!ev?.id || !hasPk) continue
      if (ev.pubkey.trim().toLowerCase() !== pk) continue
      if (
        ev.kind === kinds.Metadata ||
        ev.kind === kinds.UserEmojiList ||
        ev.kind === kinds.Emojisets
      ) {
        byId.set(ev.id, ev)
      }
    }
    if (
      userEmojiListEvent &&
      hasPk &&
      userEmojiListEvent.pubkey.trim().toLowerCase() === pk
    ) {
      byId.set(userEmojiListEvent.id, userEmojiListEvent)
    }
    if (hasPk) {
      const remote = await client.fetchAuthorEmojiInventory(pk).catch(() => [] as Event[])
      for (const ev of remote) {
        byId.set(ev.id, ev)
      }
    }

    const events = [...byId.values()]

    const latestMetadata =
      events
        .filter(
          (e) =>
            e.kind === kinds.Metadata && e.pubkey.trim().toLowerCase() === pk
        )
        .sort((a, b) => b.created_at - a.created_at)[0] ??
      (metadataEvent &&
      metadataEvent.kind === kinds.Metadata &&
      metadataEvent.pubkey.trim().toLowerCase() === pk
        ? metadataEvent
        : null)

    if (latestMetadata) {
      await this.addEmojisToIndex(getEmojisFromEvent(latestMetadata), pk)
    }

    if (events.length === 0) {
      this.notifyIndexUpdate()
      return
    }

    const listEvents = events
      .filter((e) => e.kind === kinds.UserEmojiList)
      .sort((a, b) => b.created_at - a.created_at)
    const latestList = listEvents[0] ?? null
    const packEvents = events.filter((e) => e.kind === kinds.Emojisets)

    if (latestList) {
      const authorPk = latestList.pubkey.toLowerCase()
      const { emojis, emojiSetPointers } = getEmojisAndEmojiSetsFromEvent(latestList)
      await this.addEmojisToIndex(emojis, authorPk)
      const emojiSetEvents = await client.fetchEmojiSetEvents(emojiSetPointers)
      await Promise.allSettled(
        emojiSetEvents.map(async (event) => {
          if (!event || (event as any) instanceof Error) return
          await this.addEmojisToIndex(getEmojisFromEvent(event), event.pubkey.toLowerCase())
        })
      )
    }

    await Promise.allSettled(
      packEvents.map(async (pack) => {
        await this.addEmojisToIndex(getEmojisFromEvent(pack), pack.pubkey.toLowerCase())
      })
    )

    this.notifyIndexUpdate()
  }

  private sortEmojiIdsForViewer(ids: string[], viewerPubkeyLower: string): string[] {
    if (!viewerPubkeyLower) return ids
    const own: string[] = []
    const rest: string[] = []
    for (const id of ids) {
      if (this.emojiAuthorById.get(id) === viewerPubkeyLower) own.push(id)
      else rest.push(id)
    }
    return [...own, ...rest]
  }

  async searchEmojis(query: string = '', viewerPubkey?: string | null): Promise<string[]> {
    const v = viewerPubkey?.toLowerCase() ?? ''
    if (!query) {
      const ids = this.sortEmojiIdsForViewer(Array.from(this.emojiMap.keys()), v)
      return ids
    }
    const results = await this.emojiIndex.searchAsync(query)
    const filtered = results.filter((id) => typeof id === 'string') as string[]
    return this.sortEmojiIdsForViewer(filtered, v)
  }

  getEmojiById(id?: string): TEmoji | undefined {
    if (!id) return undefined
    if (/^[0-9a-f]{64}$/.test(id)) return this.emojiMap.get(id)
    return Array.from(this.emojiMap.values()).find((e) => e.shortcode === id)
  }

  /** Returns the emojis that the viewer themselves authored, sorted by shortcode. */
  getOwnCustomEmojis(viewerPubkey: string): TEmoji[] {
    const v = viewerPubkey.toLowerCase()
    const own: TEmoji[] = []
    for (const [hashId, emoji] of this.emojiMap.entries()) {
      if (this.emojiAuthorById.get(hashId) === v) own.push(emoji)
    }
    return own.sort((a, b) => a.shortcode.localeCompare(b.shortcode))
  }

  getAllCustomEmojisForPicker(
    viewerPubkey?: string | null
  ): Array<{ name: string; shortcodes: [string]; url: string; category: string }> {
    const v = viewerPubkey?.toLowerCase() ?? ''
    const rows = Array.from(this.emojiMap.entries()).map(([hashId, emoji]) => ({
      emoji,
      author: this.emojiAuthorById.get(hashId) ?? ''
    }))
    rows.sort((a, b) => {
      if (v) {
        const aOwn = a.author === v ? 0 : 1
        const bOwn = b.author === v ? 0 : 1
        if (aOwn !== bOwn) return aOwn - bOwn
      }
      return a.emoji.shortcode.localeCompare(b.emoji.shortcode)
    })
    return rows.map((r) => ({
      name: r.emoji.shortcode,
      shortcodes: [r.emoji.shortcode] as [string],
      url: r.emoji.url,
      category: 'Custom'
    }))
  }

  isCustomEmojiId(name: string) {
    if (!name) return false
    if (/^[0-9a-f]{64}$/.test(name)) return this.emojiMap.has(name)
    return Array.from(this.emojiMap.values()).some((e) => e.shortcode === name)
  }

  private async addEmojisToIndex(emojis: TEmoji[], authorPubkeyLower: string) {
    await Promise.allSettled(
      emojis.map(async (emoji) => {
        const id = this.getEmojiId(emoji)
        this.emojiMap.set(id, emoji)
        this.emojiAuthorById.set(id, authorPubkeyLower)
        await this.emojiIndex.addAsync(id, emoji.shortcode)
      })
    )
  }

  getEmojiId(emoji: TEmoji) {
    const encoder = new TextEncoder()
    const data = encoder.encode(`${emoji.shortcode}:${emoji.url}`.toLowerCase())
    const hashBuffer = sha256(data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  updateSuggested(id: string) {
    const emoji = this.getEmojiById(id)
    if (!emoji) return
    recordEmojiUsed(emoji)
  }
}

const instance = new CustomEmojiService()
export default instance
