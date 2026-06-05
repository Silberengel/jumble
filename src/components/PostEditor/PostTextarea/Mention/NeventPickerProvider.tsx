import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { PickerSearchMode } from '@/services/mention-event-search.service'
import NeventNaddrPickerDialog from './NeventNaddrPickerDialog'
import { NeventPickerContext } from './nevent-picker-context'
import { OPEN_NEVENT_PICKER_EVENT, extendMentionRangeToEndOfWord } from './suggestion'

export function NeventPickerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [onSelectedRef, setOnSelectedRef] = useState<((link: string) => void) | null>(null)
  const [initialMode, setInitialMode] = useState<PickerSearchMode>('nevent')

  useEffect(() => {
    const handler = (e: Event) => {
      const { editor, range, initialMode: detailMode } = (
        e as CustomEvent<{
          editor: Editor
          range: { from: number; to: number }
          initialMode?: PickerSearchMode
        }>
      ).detail
      const to = extendMentionRangeToEndOfWord(editor, range)
      setOnSelectedRef(() => (link: string) => {
        editor.chain().focus().insertContentAt({ from: range.from, to }, link + ' ').run()
      })
      setInitialMode(detailMode ?? 'nevent')
      setOpen(true)
    }
    window.addEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
    return () => window.removeEventListener(OPEN_NEVENT_PICKER_EVENT, handler)
  }, [])

  const openNeventPicker = useCallback((onSelected: (nostrLink: string) => void, mode?: PickerSearchMode) => {
    setOnSelectedRef(() => onSelected)
    setInitialMode(mode ?? 'nevent')
    setOpen(true)
  }, [])

  const handleSelect = useCallback(
    (link: string) => {
      onSelectedRef?.(link)
      setOnSelectedRef(null)
    },
    [onSelectedRef]
  )

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      setOnSelectedRef(null)
      setInitialMode('nevent')
    }
    setOpen(next)
  }, [])

  const value = useMemo(() => ({ openNeventPicker }), [openNeventPicker])

  return (
    <NeventPickerContext.Provider value={value}>
      {children}
      <NeventNaddrPickerDialog
        open={open}
        onOpenChange={handleOpenChange}
        onSelect={handleSelect}
        initialMode={initialMode}
      />
    </NeventPickerContext.Provider>
  )
}
