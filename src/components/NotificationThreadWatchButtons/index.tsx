import { cn } from '@/lib/utils'
import { useNotificationThreadWatchOptional } from '@/providers/NotificationThreadWatchProvider'
import { Bell, BellOff } from 'lucide-react'
import type { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useNostr } from '@/providers/NostrProvider'

export default function NotificationThreadWatchButtons({ event }: { event: Event }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const watch = useNotificationThreadWatchOptional()
  const [busy, setBusy] = useState<'follow' | 'mute' | null>(null)

  // Show for your own notes too (e.g. notifications feed): you may still want follow/mute on that anchor.
  if (!watch || !pubkey) return null

  const followed = watch.isFollowedForNotifications(event)
  const muted = watch.isMutedForNotifications(event)

  const onFollow = (e: React.MouseEvent) => {
    e.stopPropagation()
    void checkLogin(async () => {
      setBusy('follow')
      try {
        if (followed) {
          const ok = await watch.unfollowThreadForNotifications(event)
          if (ok) {
            toast.success(t('Unfollowed thread notifications'))
          } else {
            toast.error(t('Thread notification list update failed'))
          }
        } else {
          await watch.followThreadForNotifications(event)
          toast.success(t('Following thread for notifications'))
        }
      } catch (err) {
        toast.error(t('Thread notification list update failed') + ': ' + (err as Error).message)
      } finally {
        setBusy(null)
      }
    })
  }

  const onMute = (e: React.MouseEvent) => {
    e.stopPropagation()
    void checkLogin(async () => {
      setBusy('mute')
      try {
        if (muted) {
          const ok = await watch.unmuteThreadForNotifications(event)
          if (ok) {
            toast.success(t('Unmuted thread notifications'))
          } else {
            toast.error(t('Thread notification list update failed'))
          }
        } else {
          await watch.muteThreadForNotifications(event)
          toast.success(t('Muted thread for notifications'))
        }
      } catch (err) {
        toast.error(t('Thread notification list update failed') + ': ' + (err as Error).message)
      } finally {
        setBusy(null)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        className={cn(
          'rounded p-1 transition-colors enabled:hover:bg-muted',
          followed
            ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/35'
            : 'text-muted-foreground'
        )}
        disabled={busy !== null}
        aria-pressed={followed}
        title={followed ? t('Unfollow thread notifications') : t('Follow this')}
        aria-label={followed ? t('Unfollow thread notifications') : t('Follow this')}
        onClick={onFollow}
      >
        <Bell className={cn('size-4', followed && 'fill-current')} />
      </button>
      <button
        type="button"
        className={cn(
          'rounded p-1 transition-colors enabled:hover:bg-muted',
          muted
            ? 'bg-destructive/15 text-destructive ring-1 ring-inset ring-destructive/30'
            : 'text-muted-foreground'
        )}
        disabled={busy !== null}
        aria-pressed={muted}
        title={muted ? t('Unmute thread notifications') : t('Mute this')}
        aria-label={muted ? t('Unmute thread notifications') : t('Mute this')}
        onClick={onMute}
      >
        <BellOff className={cn('size-4', muted && 'fill-current')} />
      </button>
    </>
  )
}
