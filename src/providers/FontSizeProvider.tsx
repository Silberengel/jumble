import { createContext, useContext, useEffect, useState } from 'react'
import { syncViewportHeightCssVar } from '@/lib/viewport-height'
import storage from '@/services/local-storage.service'
import { TFontSize } from '@/types'

type FontSizeContextType = {
  fontSize: TFontSize
  setFontSize: (fontSize: TFontSize) => void
}

const FontSizeContext = createContext<FontSizeContextType | undefined>(undefined)

export const useFontSize = () => {
  const context = useContext(FontSizeContext)
  if (!context) {
    throw new Error('useFontSize must be used within a FontSizeProvider')
  }
  return context
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSizeState] = useState<TFontSize>(storage.getFontSize())

  useEffect(() => {
    // Apply font size to CSS root
    const root = document.documentElement
    
    // Remove old font size classes
    root.classList.remove('font-size-small', 'font-size-medium', 'font-size-large')
    
    // Add new font size class
    root.classList.add(`font-size-${fontSize}`)
    
    // Also set CSS variable for content font size
    const sizes = {
      small: '0.875rem',
      medium: '1rem',
      large: '1.125rem'
    }
    
    root.style.setProperty('--content-font-size', sizes[fontSize])
    requestAnimationFrame(() => syncViewportHeightCssVar())
  }, [fontSize])

  const setFontSize = (newFontSize: TFontSize) => {
    storage.setFontSize(newFontSize)
    setFontSizeState(newFontSize)
  }

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  )
}

