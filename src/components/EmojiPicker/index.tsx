import { EMOJI_PICKER_DATA_SOURCE } from '@/lib/emoji-picker-data-source'
import { cn } from '@/lib/utils'
import { preloadEmojiPicker } from '@/lib/emoji-picker-preload'
import { DEFAULT_LIKE_REACTION_CONTENT, DEFAULT_LIKE_REACTION_DISPLAY_EMOJI, DEFAULT_SUGGESTED_EMOJIS } from '@/lib/like-reaction-emojis'
import { recordEmojiUsed } from '@/lib/recently-used-emojis'
import { useNostr } from '@/providers/NostrProvider'
import { useTheme } from '@/providers/ThemeProvider'
import customEmojiService from '@/services/custom-emoji.service'
import { TEmoji } from '@/types'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export { DEFAULT_SUGGESTED_EMOJIS as EMOJI_PICKER_REACTIONS } from '@/lib/like-reaction-emojis'

/** Cap custom emoji in the grid so the picker stays responsive with a large network index. */
const CUSTOM_EMOJI_PICKER_LIMIT = 300

type PickerElement = HTMLElement & {
  customEmoji: unknown[]
  database?: { ready(): Promise<void> }
}

export default function EmojiPicker({
  onEmojiClick,
  reactionsDefaultOpen,
  reactions,
  layout = 'popover'
}: {
  onEmojiClick: (emoji: string | TEmoji | undefined, event: Event) => void
  reactionsDefaultOpen?: boolean
  reactions?: string[]
  /** `drawer` fills the mobile sheet; `popover` uses a fixed height for dropdowns. */
  layout?: 'drawer' | 'popover'
}) {
  const inDrawer = layout === 'drawer'
  const { themeSetting } = useTheme()
  const { pubkey } = useNostr()
  const [mode, setMode] = useState<'reactions' | 'full'>(
    reactionsDefaultOpen ? 'reactions' : 'full'
  )
  const [customEmojiTick, setCustomEmojiTick] = useState(0)
  const [pickerReady, setPickerReady] = useState(false)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<PickerElement | null>(null)
  const onEmojiClickRef = useRef(onEmojiClick)
  onEmojiClickRef.current = onEmojiClick

  useEffect(() => {
    void preloadEmojiPicker()
  }, [])

  useEffect(() => customEmojiService.subscribeIndexUpdate(() => setCustomEmojiTick((t) => t + 1)), [])

  const customEmojis = useMemo(
    () =>
      customEmojiService
        .getAllCustomEmojisForPicker(pubkey ?? null)
        .slice(0, CUSTOM_EMOJI_PICKER_LIMIT),
    [pubkey, customEmojiTick]
  )

  const ownEmojis = useMemo(
    () => (pubkey ? customEmojiService.getOwnCustomEmojis(pubkey) : []),
    [pubkey, customEmojiTick]
  )

  // Create the web component once; keep it mounted (hide off-screen in reactions mode) so
  // switching to the full grid and reopening the popover does not cold-start IndexedDB again.
  useEffect(() => {
    let cancelled = false

    preloadEmojiPicker()
      .then(async ([mod]) => {
        if (cancelled || !containerRef.current || pickerRef.current) return
        const { Picker } = mod

        const picker = new Picker({
          dataSource: EMOJI_PICKER_DATA_SOURCE,
          customEmoji: customEmojis
        }) as PickerElement
        pickerRef.current = picker

        if (themeSetting === 'dark') {
          picker.className = 'dark'
        } else if (themeSetting === 'light') {
          picker.className = 'light'
        }

        const handleClick = (e: Event) => {
          const detail = (e as CustomEvent).detail as {
            unicode?: string
            emoji?: {
              custom?: boolean
              unicode?: string
              name?: string
              shortcodes?: string[]
              url?: string
            }
          }
          let result: string | TEmoji | undefined
          /**
           * emoji-picker-element only puts `unicode` on the event detail when `skinTonedUnicode` is truthy
           * (see getDetailForClickEvent in picker.js). Native picks often expose the sequence on `detail.emoji.unicode`
           * instead, so we must fall back — otherwise `insertEmoji` receives undefined and “most emojis don’t work”.
           */
          const top = typeof detail.unicode === 'string' && detail.unicode.length > 0 ? detail.unicode : undefined
          const nested =
            typeof detail.emoji?.unicode === 'string' && detail.emoji.unicode.length > 0
              ? detail.emoji.unicode
              : undefined
          const nativeUnicode = top ?? nested
          if (nativeUnicode) {
            result = nativeUnicode
          } else {
            const em = detail.emoji
            // Custom entries: `url` (+ shortcodes / name); avoid treating native `unicode` as custom.
            if (em?.url && !em.unicode) {
              const shortcode = em.shortcodes?.[0] ?? em.name
              if (shortcode) {
                result = { shortcode, url: em.url }
              }
            } else if (em?.custom && em.shortcodes?.[0] && em.url) {
              result = { shortcode: em.shortcodes[0], url: em.url }
            }
          }
          if (result !== undefined) recordEmojiUsed(result)
          onEmojiClickRef.current(result, e)
        }

        picker.addEventListener('emoji-click', handleClick)
        containerRef.current.appendChild(picker)
        return picker.database?.ready()
      })
      .then(() => {
        if (!cancelled) setPickerReady(true)
      })
      .catch((err) => {
        if (!cancelled) {
          setPickerError(err instanceof Error ? err.message : 'Failed to load emojis')
        }
      })

    return () => {
      cancelled = true
      setPickerReady(false)
      if (pickerRef.current) {
        pickerRef.current.remove()
        pickerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (pickerRef.current) {
      pickerRef.current.customEmoji = customEmojis
    }
  }, [customEmojis])

  useEffect(() => {
    if (!pickerRef.current) return
    if (themeSetting === 'dark') {
      pickerRef.current.className = 'dark'
    } else if (themeSetting === 'light') {
      pickerRef.current.className = 'light'
    } else {
      pickerRef.current.className = ''
    }
  }, [themeSetting])

  const reactionsList = reactions ?? [...DEFAULT_SUGGESTED_EMOJIS]

  const ownEmojisRow =
    ownEmojis.length > 0 ? (
      <div className="flex shrink-0 items-center gap-0.5 px-1 py-1 border-b overflow-x-auto scrollbar-hide">
        {ownEmojis.map((emoji) => (
          <button
            key={emoji.shortcode}
            type="button"
            title={`:${emoji.shortcode}:`}
            className="shrink-0 w-8 h-8 rounded hover:bg-muted flex items-center justify-center"
            onClick={(e) => {
              recordEmojiUsed(emoji)
              onEmojiClick(emoji, e.nativeEvent)
            }}
          >
            <img src={emoji.url} alt={emoji.shortcode} className="w-6 h-6 object-contain" />
          </button>
        ))}
      </div>
    ) : null

  const pickerHost = (
    <div
      ref={containerRef}
      data-emoji-picker-root
      className={cn(
        'relative w-full min-w-0 max-w-[350px]',
        inDrawer ? 'min-h-0 flex-1 flex flex-col' : 'h-[min(320px,45dvh)] min-h-[240px] shrink-0',
        mode === 'reactions' &&
          'pointer-events-none fixed left-[-9999px] top-0 h-[320px] w-[350px] overflow-hidden opacity-0'
      )}
    >
      {!pickerReady && !pickerError && mode === 'full' ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Loading emojis…
        </div>
      ) : null}
      {pickerError && mode === 'full' ? (
        <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-sm text-muted-foreground">
          {pickerError}
        </div>
      ) : null}
    </div>
  )

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        inDrawer && mode === 'full' && 'min-h-0 flex-1'
      )}
    >
      {ownEmojisRow}
      {mode === 'reactions' ? (
        <div className="flex flex-wrap items-center gap-1 p-2">
          {reactionsList.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="text-2xl p-1 rounded hover:bg-muted leading-none"
              onClick={(e) => {
                recordEmojiUsed(emoji)
                onEmojiClick(emoji, e.nativeEvent)
              }}
            >
              {emoji === DEFAULT_LIKE_REACTION_CONTENT ? DEFAULT_LIKE_REACTION_DISPLAY_EMOJI : emoji}
            </button>
          ))}
          <button
            type="button"
            title="More emojis"
            className="p-1 rounded hover:bg-muted text-muted-foreground flex items-center justify-center"
            onClick={() => setMode('full')}
          >
            <Plus size={20} />
          </button>
        </div>
      ) : null}
      {pickerHost}
    </div>
  )
}
