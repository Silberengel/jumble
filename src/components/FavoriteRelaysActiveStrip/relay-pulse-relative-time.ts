import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'

export function relativePastPhrase(timestampMs: number, t: TFunction): string {
  const sec = Math.floor((Date.now() - timestampMs) / 1000)
  if (sec < 45) return t('just now')
  const min = Math.floor(sec / 60)
  if (min < 60) return t('n minutes ago', { n: min })
  const h = Math.floor(min / 60)
  if (h < 48) return t('n hours ago', { n: h })
  const d = Math.floor(h / 24)
  return t('n days ago', { n: d })
}

export function useRelativePastPhrase(timestampMs: number | null, t: TFunction): string {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (timestampMs == null) return
    const id = window.setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(id)
  }, [timestampMs])
  return useMemo(() => {
    if (timestampMs == null) return ''
    return relativePastPhrase(timestampMs, t)
  }, [timestampMs, t, tick])
}
