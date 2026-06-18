import type { PostEditorAdvancedPanelProps } from '@/components/PostEditor/PostEditorAdvancedPanel'
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from 'react'

type ComposerSessionContextValue = {
  /** Latest advanced panel props — updated via ref to avoid re-rendering the page on every keystroke. */
  advancedPanelPropsRef: MutableRefObject<PostEditorAdvancedPanelProps | null>
  /** True while options sub-view is open inside ComposerPage. */
  optionsOpen: boolean
  setOptionsOpen: (open: boolean) => void
}

const ComposerSessionContext = createContext<ComposerSessionContextValue | null>(null)

export function ComposerSessionProvider({ children }: { children: ReactNode }) {
  const advancedPanelPropsRef = useRef<PostEditorAdvancedPanelProps | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)

  const value = useMemo(
    () => ({
      advancedPanelPropsRef,
      optionsOpen,
      setOptionsOpen
    }),
    [optionsOpen]
  )

  return <ComposerSessionContext.Provider value={value}>{children}</ComposerSessionContext.Provider>
}

export function useComposerSession(): ComposerSessionContextValue | null {
  return useContext(ComposerSessionContext)
}

export function useComposerSessionRequired(): ComposerSessionContextValue {
  const ctx = useContext(ComposerSessionContext)
  if (!ctx) throw new Error('useComposerSessionRequired must be used within ComposerSessionProvider')
  return ctx
}

/** Sync advanced panel props from PostContent into session (mobile options sub-page). */
export function useRegisterComposerAdvancedPanel(props: PostEditorAdvancedPanelProps | null) {
  const session = useComposerSession()
  if (session) {
    session.advancedPanelPropsRef.current = props
  }
}
