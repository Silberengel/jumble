import { Skeleton } from '@/components/ui/skeleton'
import { useNoteStatsById } from '@/hooks/useNoteStatsById'
import { getLightningAddressFromProfile } from '@/lib/lightning'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useZap } from '@/providers/ZapProvider'
import { replaceableEventService } from '@/services/client.service'
import { getProfileFromEvent } from '@/lib/event-metadata'
import { kinds } from 'nostr-tools'
import lightning from '@/services/lightning.service'
import noteStatsService from '@/services/note-stats.service'
import type { TNoteStats } from '@/services/note-stats.service'
import { Zap } from 'lucide-react'
import { Event } from 'nostr-tools'
import { MouseEvent, TouchEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import ZapDialog from '../ZapDialog'

type ZapButtonProps = {
  event: Event
  hideCount?: boolean
  noteStats?: Partial<TNoteStats>
}

export function ZapButtonWithStats({ event, hideCount = false, noteStats }: ZapButtonProps) {
  const { t } = useTranslation()
  const { checkLogin, pubkey } = useNostr()
  const { defaultZapSats, defaultZapComment, quickZap } = useZap()
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null)
  const [openZapDialog, setOpenZapDialog] = useState(false)
  const [zapping, setZapping] = useState(false)
  const statsLoaded = noteStats?.updatedAt != null
  const { zapAmount, hasZapped } = useMemo(() => {
    return {
      zapAmount: noteStats?.zaps?.reduce((acc, zap) => acc + zap.amount, 0),
      hasZapped: pubkey ? noteStats?.zaps?.some((zap) => zap.pubkey === pubkey) : false
    }
  }, [noteStats, pubkey])
  const showZapAmount = !hideCount && (statsLoaded || (zapAmount ?? 0) > 0)
  const [disable, setDisable] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLongPressRef = useRef(false)

  useEffect(() => {
    setDisable(true)
    let cancelled = false
    replaceableEventService.fetchReplaceableEvent(event.pubkey, kinds.Metadata).then((profileEvent) => {
      if (cancelled) return
      const profile = profileEvent ? getProfileFromEvent(profileEvent) : undefined
      if (!profile) return
      if (pubkey === profile.pubkey) return
      const lightningAddress = getLightningAddressFromProfile(profile)
      if (lightningAddress) setDisable(false)
    })
    return () => {
      cancelled = true
    }
  }, [event.pubkey, pubkey])

  const handleZap = async () => {
    try {
      if (!pubkey) {
        throw new Error('You need to be logged in to zap')
      }
      if (zapping) return

      setZapping(true)
      const zapResult = await lightning.zap(pubkey, event, defaultZapSats, defaultZapComment)
      // user canceled
      if (!zapResult) {
        return
      }
      noteStatsService.addZap(
        pubkey,
        event.id,
        zapResult.invoice,
        defaultZapSats,
        defaultZapComment
      )
    } catch (error) {
      toast.error(`${t('Zap failed')}: ${(error as Error).message}`)
    } finally {
      setZapping(false)
    }
  }

  const handleClickStart = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (disable) return

    isLongPressRef.current = false

    if ('touches' in e) {
      const touch = e.touches[0]
      setTouchStart({ x: touch.clientX, y: touch.clientY })
    }

    if (quickZap) {
      timerRef.current = setTimeout(() => {
        isLongPressRef.current = true
        checkLogin(() => {
          setOpenZapDialog(true)
          setZapping(true)
        })
      }, 500)
    }
  }

  const handleClickEnd = (e: MouseEvent | TouchEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    if (disable) return

    if ('touches' in e) {
      setTouchStart(null)
      if (!touchStart) return
      const touch = e.changedTouches[0]
      const diffX = Math.abs(touch.clientX - touchStart.x)
      const diffY = Math.abs(touch.clientY - touchStart.y)
      if (diffX > 10 || diffY > 10) return
    }

    if (!quickZap) {
      checkLogin(() => {
        setOpenZapDialog(true)
        setZapping(true)
      })
    } else if (!isLongPressRef.current) {
      checkLogin(() => handleZap())
    }
    isLongPressRef.current = false
  }

  const handleMouseLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
  }

  return (
    <>
      <button
        className={cn(
          'group flex items-center gap-1 select-none px-3 h-full',
          disable ? 'cursor-not-allowed' : 'cursor-pointer'
        )}
        title={t('Zap')}
        disabled={disable || zapping}
        onMouseDown={handleClickStart}
        onMouseUp={handleClickEnd}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleClickStart}
        onTouchEnd={handleClickEnd}
      >
        {zapping ? (
          <Skeleton className="size-4 shrink-0 rounded-full" aria-hidden />
        ) : (
          <Zap
            className={cn(
              hasZapped && 'fill-yellow-400',
              disable
                ? 'text-muted-foreground/40'
                : cn(
                    'text-muted-foreground group-hover:text-yellow-400',
                    hasZapped && 'text-yellow-400'
                  )
            )}
          />
        )}
        {showZapAmount && (
          <div
            className={cn(
              'text-sm tabular-nums',
              hasZapped ? 'text-yellow-400' : 'text-muted-foreground'
            )}
          >
            {formatAmount(zapAmount ?? 0)}
          </div>
        )}
      </button>
      <ZapDialog
        open={openZapDialog}
        setOpen={(open) => {
          setOpenZapDialog(open)
          setZapping(open)
        }}
        pubkey={event.pubkey}
        event={event}
      />
    </>
  )
}

export default function ZapButton({ event, hideCount = false }: ZapButtonProps) {
  const noteStats = useNoteStatsById(event.id)
  return <ZapButtonWithStats event={event} hideCount={hideCount} noteStats={noteStats} />
}

function formatAmount(amount: number) {
  if (amount < 1000) return amount
  if (amount < 1000000) return `${Math.round(amount / 100) / 10}k`
  return `${Math.round(amount / 100000) / 10}M`
}
