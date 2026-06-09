import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { createUserStatusDraftEvent } from '@/lib/draft-event'
import {
  buildUserStatusTags,
  NIP38_USER_STATUS_TYPES,
  type Nip38UserStatusType
} from '@/lib/nip38-user-status'
import client from '@/services/client.service'
import dayjs from 'dayjs'
import type { Event } from 'nostr-tools'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type StatusFormRow = {
  content: string
  linkUrl: string
  /** Minutes until expiration; empty = no expiration tag. */
  expiresInMinutes: string
}

const EMPTY_ROW: StatusFormRow = { content: '', linkUrl: '', expiresInMinutes: '' }

function rowFromEvent(ev: Event | null | undefined): StatusFormRow {
  if (!ev) return { ...EMPTY_ROW }
  const link = ev.tags.find((t) => t[0] === 'r' && t[1])?.[1] ?? ''
  const expRaw = ev.tags.find((t) => t[0] === 'expiration' && t[1])?.[1]
  let expiresInMinutes = ''
  if (expRaw) {
    const exp = parseInt(expRaw, 10)
    if (!Number.isNaN(exp)) {
      const mins = Math.round((exp - dayjs().unix()) / 60)
      if (mins > 0) expiresInMinutes = String(mins)
    }
  }
  return {
    content: ev.content ?? '',
    linkUrl: link,
    expiresInMinutes
  }
}

export default function UserStatusEditor({
  open,
  onOpenChange,
  pubkey,
  publish
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pubkey: string
  publish: (draft: ReturnType<typeof createUserStatusDraftEvent>) => Promise<Event>
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [general, setGeneral] = useState<StatusFormRow>(EMPTY_ROW)
  const [music, setMusic] = useState<StatusFormRow>(EMPTY_ROW)

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const [generalEv, musicEv] = await Promise.all([
        client.fetchUserStatusEvent(pubkey, 'general'),
        client.fetchUserStatusEvent(pubkey, 'music')
      ])
      setGeneral(rowFromEvent(generalEv))
      setMusic(rowFromEvent(musicEv))
    } finally {
      setLoading(false)
    }
  }, [pubkey])

  useEffect(() => {
    if (open) void loadEvents()
  }, [open, loadEvents])

  const publishStatus = async (type: Nip38UserStatusType, row: StatusFormRow) => {
    const content = row.content.trim()
    const mins = parseInt(row.expiresInMinutes.trim(), 10)
    const tags = buildUserStatusTags({
      type,
      content,
      linkUrl: row.linkUrl.trim() || undefined,
      expiration:
        content && row.expiresInMinutes.trim() && !Number.isNaN(mins) && mins > 0
          ? dayjs().unix() + mins * 60
          : undefined
    }).filter((t) => t[0] !== 'd')
    const draft = createUserStatusDraftEvent(type, content, tags)
    const published = await publish(draft)
    await client.updateUserStatusCache(published)
  }

  const save = async () => {
    setSaving(true)
    try {
      await publishStatus('general', general)
      await publishStatus('music', music)
      toast.success(t('User status updated'))
      onOpenChange(false)
    } catch {
      toast.error(t('Failed to publish user status'))
    } finally {
      setSaving(false)
    }
  }

  const renderRow = (
    type: Nip38UserStatusType,
    row: StatusFormRow,
    setRow: (next: StatusFormRow) => void
  ) => (
    <div key={type} className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">
        {type === 'general' ? t('General status') : t('Music status')}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`status-${type}-content`}>{t('Status text')}</Label>
        <Textarea
          id={`status-${type}-content`}
          value={row.content}
          onChange={(e) => setRow({ ...row, content: e.target.value })}
          placeholder={
            type === 'general'
              ? t('userStatusGeneralPlaceholder', { defaultValue: 'Working, hiking, out of office…' })
              : t('userStatusMusicPlaceholder', { defaultValue: 'Artist — Track' })
          }
          className="min-h-[4rem] resize-y text-sm"
        />
        <p className="text-xs text-muted-foreground">
          {t('userStatusClearHint', { defaultValue: 'Leave empty and save to clear this status.' })}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`status-${type}-link`}>{t('Link (optional)')}</Label>
        <Input
          id={`status-${type}-link`}
          value={row.linkUrl}
          onChange={(e) => setRow({ ...row, linkUrl: e.target.value })}
          placeholder="https://…"
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`status-${type}-exp`}>{t('Expires in (minutes, optional)')}</Label>
        <Input
          id={`status-${type}-exp`}
          type="number"
          min={1}
          value={row.expiresInMinutes}
          onChange={(e) => setRow({ ...row, expiresInMinutes: e.target.value })}
          placeholder={type === 'music' ? '45' : ''}
          className="text-sm"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => setRow({ ...EMPTY_ROW })}
      >
        {t('Clear')}
      </Button>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Edit user status')}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-3 py-4" aria-hidden>
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('userStatusNip38Hint', {
                defaultValue: 'NIP-38 live statuses (kind 30315). Shown next to your name on posts and your profile.'
              })}
            </p>
            {NIP38_USER_STATUS_TYPES.map((type) =>
              type === 'general'
                ? renderRow('general', general, setGeneral)
                : renderRow('music', music, setMusic)
            )}
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Skeleton className="mx-auto h-4 w-14 rounded-md" aria-hidden /> : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
