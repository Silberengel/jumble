import { EMOJI_PICKER_DATA_SOURCE } from '@/lib/emoji-picker-data-source'
import { cn } from '@/lib/utils'
import { preloadEmojiPickerModule } from '@/lib/emoji-picker-preload'
import { DEFAULT_LIKE_REACTION_CONTENT, DEFAULT_LIKE_REACTION_DISPLAY_EMOJI, DEFAULT_SUGGESTED_EMOJIS } from '@/lib/like-reaction-emojis'
import { recordEmojiUsed } from '@/lib/recently-used-emojis'
import { useNostr } from '@/providers/NostrProvider'
import { useTheme } from '@/providers/ThemeProvider'
import customEmojiService from '@/services/custom-emoji.service'
import { TEmoji } from '@/types'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

export { DEFAULT_SUGGESTED_EMOJIS as EMOJI_PICKER_REACTIONS } from '@/lib/like-reaction-emojis'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<(HTMLElement & { customEmoji: unknown[] }) | null>(null)

  useEffect(() => customEmojiService.subscribeIndexUpdate(() => setCustomEmojiTick((t) => t + 1)), [])

  const customEmojis = useMemo(
    () => customEmojiService.getAllCustomEmojisForPicker(pubkey ?? null),
    [pubkey, customEmojiTick]
  )

  const ownEmojis = useMemo(
    () => (pubkey ? customEmojiService.getOwnCustomEmojis(pubkey) : []),
    [pubkey, customEmojiTick]
  )

  useEffect(() => {
    if (mode !== 'full') return

    let cancelled = false
    setPickerReady(false)

    preloadEmojiPickerModule().then(({ Picker }) => {
      if (cancelled || !containerRef.current) return

      const picker = new Picker({
        dataSource: EMOJI_PICKER_DATA_SOURCE,
        customEmoji: customEmojis
      }) as HTMLElement & { customEmoji: unknown[] }
      pickerRef.current = picker

      if (themeSetting === 'dark') {
        picker.className = 'dark'
      } else if (themeSetting === 'light') {
        picker.className = 'light'
      }

      picker.style.width = '100%'
      picker.style.minWidth = '280px'
      picker.style.maxWidth = '350px'
      if (inDrawer) {
        picker.style.height = '100%'
        picker.style.minHeight = '0'
      } else {
        picker.style.height = 'min(350px, 50dvh)'
        picker.style.minHeight = '280px'
      }
      picker.style.setProperty('--num-columns', '8')

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
        onEmojiClick(result, e)
      }

      picker.addEventListener('emoji-click', handleClick)
      containerRef.current.appendChild(picker)
      if (!cancelled) setPickerReady(true)
    })

    return () => {
      cancelled = true
      setPickerReady(false)
      if (pickerRef.current) {
        pickerRef.current.remove()
        pickerRef.current = null
      }
    }
  }, [mode, inDrawer])

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

  if (mode === 'reactions') {
    return (
      <div className="flex w-full min-w-0 flex-col">
        {ownEmojisRow}
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
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col',
        inDrawer && 'min-h-0 flex-1'
      )}
    >
      {ownEmojisRow}
      <div
        ref={containerRef}
        className={cn(
          'relative w-full min-w-[280px] max-w-[350px]',
          inDrawer ? 'min-h-0 flex-1' : 'h-[min(320px,45dvh)] min-h-[240px] shrink-0'
        )}
      >
        {!pickerReady ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            …
          </div>
        ) : null}
      </div>
    </div>
  )
}
