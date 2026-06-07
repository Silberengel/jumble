import { Button } from '@/components/ui/button'
import { getLibraryIndexCacheFootprint, getLibraryIndexCacheBudget } from '@/lib/library-index-idb-cache'
import { clearAllLibraryIndexCaches } from '@/lib/library-publication-index'
import { isImwaldElectron, isMobileBrowserProfile } from '@/lib/client-platform'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

function platformLabel(): string {
  if (isImwaldElectron()) return 'desktop-app'
  if (isMobileBrowserProfile()) return 'mobile-web'
  return 'desktop-web'
}

export default function LibraryIndexCacheSettings() {
  const { t } = useTranslation()
  const [footprint, setFootprint] = useState<{ count: number; bytes: number } | null>(null)
  const [clearing, setClearing] = useState(false)

  const budget = useMemo(() => getLibraryIndexCacheBudget(), [])

  const refreshFootprint = useCallback(async () => {
    try {
      setFootprint(await getLibraryIndexCacheFootprint())
    } catch {
      setFootprint({ count: 0, bytes: 0 })
    }
  }, [])

  useEffect(() => {
    void refreshFootprint()
  }, [refreshFootprint])

  const handleClear = async () => {
    if (!confirm(t('libraryIndexCache.clearConfirm'))) return
    setClearing(true)
    try {
      await clearAllLibraryIndexCaches()
      await refreshFootprint()
      toast.success(t('libraryIndexCache.clearedToast'))
    } catch {
      toast.error(t('libraryIndexCache.clearFailed'))
    } finally {
      setClearing(false)
    }
  }

  const defaultsHint = useMemo(() => {
    const p = platformLabel()
    if (p === 'mobile-web') {
      return t('libraryIndexCache.defaultsMobile', {
        entries: budget.maxEntries,
        mb: Math.round(budget.maxBytes / (1024 * 1024))
      })
    }
    if (p === 'desktop-app') {
      return t('libraryIndexCache.defaultsElectron', {
        entries: budget.maxEntries,
        mb: Math.round(budget.maxBytes / (1024 * 1024))
      })
    }
    return t('libraryIndexCache.defaultsDesktopWeb', {
      entries: budget.maxEntries,
      mb: Math.round(budget.maxBytes / (1024 * 1024))
    })
  }, [budget.maxBytes, budget.maxEntries, t])

  return (
    <div className="mt-8 space-y-4 border-t border-border pt-6">
      <h3 className="text-base font-medium">{t('libraryIndexCache.sectionTitle')}</h3>
      <p className="text-muted-foreground text-sm">{t('libraryIndexCache.sectionBlurb')}</p>
      <p className="text-muted-foreground text-xs">{defaultsHint}</p>

      <p className="text-muted-foreground text-xs">
        {t('libraryIndexCache.footprintSummary', {
          count: footprint?.count ?? 0,
          mb: formatMb(footprint?.bytes ?? 0),
          maxEntries: budget.maxEntries,
          maxMb: Math.round(budget.maxBytes / (1024 * 1024))
        })}
      </p>

      <Button type="button" variant="secondary" disabled={clearing} onClick={() => void handleClear()}>
        {clearing ? t('libraryIndexCache.clearing') : t('libraryIndexCache.clear')}
      </Button>
    </div>
  )
}
