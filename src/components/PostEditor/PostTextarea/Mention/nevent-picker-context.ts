import { createContext } from 'react'
import type { PickerSearchMode } from '@/services/mention-event-search.service'

export type NeventPickerContextValue = {
  openNeventPicker: (onSelected: (nostrLink: string) => void, initialMode?: PickerSearchMode) => void
}

export const NeventPickerContext = createContext<NeventPickerContextValue | null>(null)
