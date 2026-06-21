import storage from '@/services/local-storage.service'
import { StorageKey } from '@/constants'
import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import { parseEditorJsonToText } from '@/lib/tiptap'
import { TPollCreateData } from '@/types'
import { Content } from '@tiptap/react'
import { Event } from 'nostr-tools'

const PERSIST_DEBOUNCE_MS = 5_000

type TPostSettings = {
  isNsfw?: boolean
  contentWarningLabel?: string
  isPoll?: boolean
  pollCreateData?: TPollCreateData
  addClientTag?: boolean
}

type TCacheKeyParams = {
  kind: number
  defaultContent?: string
  parentEvent?: Event
}

/** Cached draft for the Discussions "Create Thread" dialog (kind 11). */
export type TThreadDraft = {
  title: string
  content: string
  topic: string
}

type TPersistedDraft = {
  accountPubkey: string
  postContentCache: Record<string, Content>
  postSettingsCache: Record<string, TPostSettings>
  threadDraft: TThreadDraft | null
  /** Advanced event lab (CodeMirror) drafts keyed by {@link PostEditorCacheService.generateCacheKey} or custom keys. */
  advancedLabDrafts?: Record<string, AdvancedEventLabSlice>
}

class PostEditorCacheService {
  static instance: PostEditorCacheService

  private postContentCache: Map<string, Content> = new Map()
  private postSettingsCache: Map<string, TPostSettings> = new Map()
  private advancedLabDrafts: Map<string, AdvancedEventLabSlice> = new Map()
  private threadDraftCache: TThreadDraft | null = null
  private persistTimeoutId: ReturnType<typeof setTimeout> | null = null
  private restoredFromStorage = false
  private keysRestoredThisSession = new Set<string>()

  constructor() {
    if (!PostEditorCacheService.instance) {
      PostEditorCacheService.instance = this
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => this.flushPersist())
      }
    }
    return PostEditorCacheService.instance
  }

  /** Flush pending draft to localStorage immediately. Called on beforeunload so drafts survive reload. */
  flushPersist() {
    if (this.persistTimeoutId) {
      clearTimeout(this.persistTimeoutId)
      this.persistTimeoutId = null
    }
    this.persistNow()
  }

  /**
   * Escape ampersands so that when TipTap parses initial content as HTML,
   * sequences like &notify in URLs are not interpreted as the &not; entity (¬).
   */
  private escapeAmpersandsForHtml(text: string): string {
    return text.replace(/&/g, '&amp;')
  }

  /** Normalize cache key so hex event ids are lowercase; ensures consistent lookup across sessions. */
  private normalizeCacheKey(key: string): string {
    const [, parentPart] = key.split(':', 2)
    if (!parentPart) return key
    const normalized = /^[0-9a-f]{64}$/i.test(parentPart) ? parentPart.toLowerCase() : parentPart
    return `${key.split(':')[0]}:${normalized}`
  }

  private restoreFromStorageIfNeeded() {
    if (this.restoredFromStorage) return
    this.restoredFromStorage = true
    const account = storage.getCurrentAccount()
    if (!account?.pubkey) return
    try {
      const raw = window.localStorage.getItem(StorageKey.POST_EDITOR_DRAFT)
      if (!raw) return
      const data = JSON.parse(raw) as TPersistedDraft
      if (data.accountPubkey !== account.pubkey) return
      if (data.postContentCache && typeof data.postContentCache === 'object') {
        Object.entries(data.postContentCache).forEach(([k, v]) => {
          if (v) {
            const key = this.normalizeCacheKey(k)
            this.postContentCache.set(key, v)
            this.keysRestoredThisSession.add(key)
          }
        })
      }
      if (data.postSettingsCache && typeof data.postSettingsCache === 'object') {
        Object.entries(data.postSettingsCache).forEach(([k, v]) => {
          if (v) this.postSettingsCache.set(this.normalizeCacheKey(k), v)
        })
      }
      if (data.threadDraft) {
        this.threadDraftCache = data.threadDraft
      }
      if (data.advancedLabDrafts && typeof data.advancedLabDrafts === 'object') {
        Object.entries(data.advancedLabDrafts).forEach(([k, v]) => {
          if (v && typeof v === 'object' && typeof (v as AdvancedEventLabSlice).content === 'string') {
            this.advancedLabDrafts.set(k, v as AdvancedEventLabSlice)
          }
        })
      }
    } catch {
      // Ignore corrupt or stale data
    }
  }

  private schedulePersist() {
    if (this.persistTimeoutId) {
      clearTimeout(this.persistTimeoutId)
    }
    this.persistTimeoutId = setTimeout(() => {
      this.persistTimeoutId = null
      this.persistNow()
    }, PERSIST_DEBOUNCE_MS)
  }

  private persistNow() {
    const account = storage.getCurrentAccount()
    if (!account?.pubkey) return
    try {
      const postContentCache: Record<string, Content> = {}
      this.postContentCache.forEach((v, k) => {
        postContentCache[k] = v
      })
      const postSettingsCache: Record<string, TPostSettings> = {}
      this.postSettingsCache.forEach((v, k) => {
        postSettingsCache[k] = v
      })
      const advancedLabDrafts: Record<string, AdvancedEventLabSlice> = {}
      this.advancedLabDrafts.forEach((v, k) => {
        advancedLabDrafts[k] = v
      })
      const data: TPersistedDraft = {
        accountPubkey: account.pubkey,
        postContentCache,
        postSettingsCache,
        threadDraft: this.threadDraftCache,
        advancedLabDrafts
      }
      window.localStorage.setItem(StorageKey.POST_EDITOR_DRAFT, JSON.stringify(data))
    } catch {
      // Ignore quota / serialization errors
    }
  }

  /** Call when user logs out or switches accounts. Clears in-memory cache and persisted draft. */
  clearOnAccountChange() {
    if (this.persistTimeoutId) {
      clearTimeout(this.persistTimeoutId)
      this.persistTimeoutId = null
    }
    this.postContentCache.clear()
    this.postSettingsCache.clear()
    this.advancedLabDrafts.clear()
    this.threadDraftCache = null
    this.keysRestoredThisSession.clear()
    this.restoredFromStorage = false
    try {
      window.localStorage.removeItem(StorageKey.POST_EDITOR_DRAFT)
    } catch {
      // Ignore
    }
  }

  getPostContentCache({ kind, defaultContent, parentEvent }: TCacheKeyParams) {
    this.restoreFromStorageIfNeeded()
    const cacheKey = this.generateCacheKey({ kind, defaultContent, parentEvent })
    const cached = this.postContentCache.get(cacheKey)
    if (cached !== undefined) {
      const cachedText = (
        typeof cached === 'string' ? cached : parseEditorJsonToText(cached ?? undefined)
      ).trim()
      // Seeded composers (e.g. Quote): an empty cached doc must not hide `defaultContent` on reopen.
      if (
        cachedText === '' &&
        defaultContent !== undefined &&
        defaultContent.trim() !== ''
      ) {
        return this.escapeAmpersandsForHtml(defaultContent)
      }
      return cached
    }
    if (defaultContent !== undefined && defaultContent !== '') {
      return this.escapeAmpersandsForHtml(defaultContent)
    }
    return defaultContent
  }

  setPostContentCache({ kind, defaultContent, parentEvent }: TCacheKeyParams, content: Content) {
    this.restoreFromStorageIfNeeded()
    const cacheKey = this.generateCacheKey({ kind, defaultContent, parentEvent })
    const incomingText = (
      typeof content === 'string' ? content : parseEditorJsonToText(content ?? undefined)
    ).trim()
    const existing = this.postContentCache.get(cacheKey)
    const existingText = existing
      ? (typeof existing === 'string' ? existing : parseEditorJsonToText(existing)).trim()
      : ''
    if (
      incomingText === '' &&
      existingText !== '' &&
      this.keysRestoredThisSession.has(cacheKey)
    ) {
      return
    }
    if (incomingText === '' && defaultContent !== undefined && defaultContent.trim() !== '') {
      this.keysRestoredThisSession.delete(cacheKey)
      if (this.postContentCache.delete(cacheKey)) {
        this.schedulePersist()
      }
      return
    }
    this.keysRestoredThisSession.delete(cacheKey)
    this.postContentCache.set(cacheKey, content)
    this.schedulePersist()
  }

  getPostSettingsCache({ kind, defaultContent, parentEvent }: TCacheKeyParams): TPostSettings | undefined {
    this.restoreFromStorageIfNeeded()
    return this.postSettingsCache.get(this.generateCacheKey({ kind, defaultContent, parentEvent }))
  }

  setPostSettingsCache({ kind, defaultContent, parentEvent }: TCacheKeyParams, settings: TPostSettings) {
    const cacheKey = this.generateCacheKey({ kind, defaultContent, parentEvent })
    this.postSettingsCache.set(cacheKey, settings)
    this.schedulePersist()
  }

  getAdvancedLabDraft(key: string): AdvancedEventLabSlice | undefined {
    this.restoreFromStorageIfNeeded()
    return this.advancedLabDrafts.get(key)
  }

  setAdvancedLabDraft(key: string, slice: AdvancedEventLabSlice) {
    this.restoreFromStorageIfNeeded()
    const copy: AdvancedEventLabSlice = {
      kind: slice.kind,
      content: slice.content,
      tags: slice.tags.map((row) => [...row])
    }
    this.advancedLabDrafts.set(key, copy)
    this.schedulePersist()
  }

  clearAdvancedLabDraft(key: string) {
    this.restoreFromStorageIfNeeded()
    if (!this.advancedLabDrafts.delete(key)) return
    // Avoid synchronous JSON.stringify(localStorage) of the full draft blob here — that blocks
    // the main thread when TipTap caches are large. Debounced persist is enough; tab close still
    // uses {@link flushPersist} via beforeunload.
    this.schedulePersist()
  }

  clearPostCache({ kind, defaultContent, parentEvent }: TCacheKeyParams, options?: { flush?: boolean }) {
    const cacheKey = this.generateCacheKey({ kind, defaultContent, parentEvent })
    this.keysRestoredThisSession.delete(cacheKey)
    this.postContentCache.delete(cacheKey)
    this.postSettingsCache.delete(cacheKey)
    this.advancedLabDrafts.delete(cacheKey)
    if (options?.flush) {
      if (this.persistTimeoutId) {
        clearTimeout(this.persistTimeoutId)
        this.persistTimeoutId = null
      }
      this.persistNow()
    } else {
      this.schedulePersist()
    }
  }

  /** Clear all post and settings drafts. Use when user explicitly clears caches. */
  clearAllPostCaches() {
    this.keysRestoredThisSession.clear()
    this.postContentCache.clear()
    this.postSettingsCache.clear()
    this.advancedLabDrafts.clear()
    this.schedulePersist()
  }

  /** Stable suffix for composers opened with pre-filled content (quote, highlight, PM). */
  private seedCacheSuffix(defaultContent: string): string {
    const trimmed = defaultContent.trim()
    if (!trimmed) return ''
    const nostrRef = trimmed.match(/nostr:(note1|nevent1|naddr1|npub1)[a-z0-9]+/i)?.[0]
    if (nostrRef) return nostrRef.toLowerCase()
    let h = 5381
    for (let i = 0; i < trimmed.length; i++) {
      h = ((h << 5) + h) ^ trimmed.charCodeAt(i)
    }
    return `h${(h >>> 0).toString(36)}`
  }

  generateCacheKey({ kind, defaultContent, parentEvent }: TCacheKeyParams): string {
    if (!parentEvent?.id) {
      const trimmed = defaultContent?.trim() ?? ''
      if (trimmed) {
        return `${kind}:seed:${this.seedCacheSuffix(defaultContent!)}`
      }
      return `${kind}:`
    }
    const id = parentEvent.id.trim()
    const parentPart = /^[0-9a-f]{64}$/i.test(id) ? id.toLowerCase() : id
    return `${kind}:${parentPart}`
  }

  getThreadDraft(): TThreadDraft | null {
    this.restoreFromStorageIfNeeded()
    return this.threadDraftCache
  }

  setThreadDraft(draft: TThreadDraft): void {
    this.threadDraftCache = draft
    this.schedulePersist()
  }

  clearThreadDraft(): void {
    this.threadDraftCache = null
    this.schedulePersist()
  }
}

const instance = new PostEditorCacheService()
export default instance
