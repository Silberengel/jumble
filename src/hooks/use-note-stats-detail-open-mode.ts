import { useScreenSizeOptional } from '@/providers/ScreenSizeProvider'
import { useEffect, useState } from 'react'

/** Desktop: hover card. Touch / narrow: long-press popover. */
export type NoteStatsDetailOpenMode = 'hover' | 'longPress'

export function useNoteStatsDetailOpenMode(): NoteStatsDetailOpenMode {
  const isSmallScreen = useScreenSizeOptional()?.isSmallScreen ?? false
  const [touchPrimary, setTouchPrimary] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const update = () => setTouchPrimary(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return isSmallScreen || touchPrimary ? 'longPress' : 'hover'
}
