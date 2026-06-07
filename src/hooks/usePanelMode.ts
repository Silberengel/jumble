import storage from '@/services/local-storage.service'
import { useEffect, useState } from 'react'

export function usePanelMode(): 'single' | 'double' {
  const [panelMode, setPanelMode] = useState<'single' | 'double'>(() => storage.getPanelMode())

  useEffect(() => {
    const onPanelMode = (ev: Event) => {
      const mode = (ev as CustomEvent<{ mode: 'single' | 'double' }>).detail?.mode
      if (mode === 'single' || mode === 'double') setPanelMode(mode)
    }
    window.addEventListener('panelModeChanged', onPanelMode)
    return () => window.removeEventListener('panelModeChanged', onPanelMode)
  }, [])

  return panelMode
}

export function libraryPublicationGridColumnClass(
  isSmallScreen: boolean,
  panelMode: 'single' | 'double'
): string {
  if (isSmallScreen) return 'grid-cols-1'
  if (panelMode === 'double') return 'grid-cols-2'
  return 'grid-cols-3'
}
