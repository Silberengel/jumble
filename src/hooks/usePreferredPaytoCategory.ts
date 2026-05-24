import { useCallback, useEffect, useState } from 'react'

import type { PaytoCategory } from '@/lib/payto-registry'
import storage from '@/services/local-storage.service'

export const PREFERRED_PAYTO_CATEGORY_CHANGED_EVENT = 'preferredPaytoCategoryChanged'

export function usePreferredPaytoCategory() {
  const [preferredPaytoCategory, setPreferredPaytoCategoryState] = useState<PaytoCategory | null>(
    () => storage.getPreferredPaytoCategory()
  )

  useEffect(() => {
    const sync = () => setPreferredPaytoCategoryState(storage.getPreferredPaytoCategory())
    window.addEventListener(PREFERRED_PAYTO_CATEGORY_CHANGED_EVENT, sync)
    return () => window.removeEventListener(PREFERRED_PAYTO_CATEGORY_CHANGED_EVENT, sync)
  }, [])

  const setPreferredPaytoCategory = useCallback((category: PaytoCategory | null) => {
    storage.setPreferredPaytoCategory(category)
    setPreferredPaytoCategoryState(category)
    window.dispatchEvent(new Event(PREFERRED_PAYTO_CATEGORY_CHANGED_EVENT))
  }, [])

  return { preferredPaytoCategory, setPreferredPaytoCategory }
}
