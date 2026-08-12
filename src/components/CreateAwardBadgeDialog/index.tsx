import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import {
  createBadgeAwardDraftEvent,
  createBadgeDefinitionDraftEvent
} from '@/lib/draft-event'
import {
  badgeDefinitionCoordinate,
  buildBadgeDefinitionTags,
  normalizeBadgeDTag,
  parseBadgeRecipientPubkeys
} from '@/lib/nip58-badge-issue'
import { showPublishingError } from '@/lib/publishing-feedback'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useNostr } from '@/providers/NostrProvider'
import indexedDb from '@/services/indexed-db.service'
import { Award } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type CreateAwardBadgeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CreateAwardBadgeDialog({ open, onOpenChange }: CreateAwardBadgeDialogProps) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()

  const [dTag, setDTag] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [recipientsRaw, setRecipientsRaw] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [resultA, setResultA] = useState<string | null>(null)
  const [resultE, setResultE] = useState<string | null>(null)

  const resetForm = useCallback(() => {
    setDTag('')
    setName('')
    setDescription('')
    setImageUrl('')
    setRecipientsRaw('')
    setResultA(null)
    setResultE(null)
    setPublishing(false)
  }, [])

  useEffect(() => {
    if (!open) resetForm()
  }, [open, resetForm])

  const handleNameBlur = () => {
    if (dTag.trim()) return
    const fromName = normalizeBadgeDTag(name)
    if (fromName) setDTag(fromName)
  }

  const handlePublish = () => {
    checkLogin(async () => {
      if (!pubkey) return

      const d = normalizeBadgeDTag(dTag || name)
      if (!d) {
        toast.error(t('Badge id (d tag) is required'))
        return
      }

      const { pubkeys, invalidTokens } = parseBadgeRecipientPubkeys(recipientsRaw)
      if (invalidTokens.length > 0) {
        toast.error(t('Invalid recipient npub', { token: invalidTokens[0] }))
        return
      }
      if (pubkeys.length === 0) {
        toast.error(t('Enter at least one recipient npub'))
        return
      }

      let tags: string[][]
      try {
        tags = buildBadgeDefinitionTags({
          d,
          name: name || d,
          description,
          imageUrl
        })
      } catch (err) {
        toast.error((err as Error).message)
        return
      }

      setPublishing(true)
      setResultA(null)
      setResultE(null)
      try {
        const relays = await buildAccountListRelayUrlsForMerge({
          accountPubkey: pubkey,
          favoriteRelays: favoriteRelays ?? [],
          blockedRelays
        })
        const publishOpts = relays.length ? { specifiedRelayUrls: relays } : undefined

        const defDraft = createBadgeDefinitionDraftEvent(tags)
        const defEvent = await publish(defDraft, publishOpts)
        try {
          await indexedDb.putReplaceableEvent(defEvent)
        } catch {
          /* ignore */
        }

        const coordinate = badgeDefinitionCoordinate(pubkey, d)
        const awardDraft = createBadgeAwardDraftEvent(coordinate, pubkeys)
        const awardEvent = await publish(awardDraft, publishOpts)

        setResultA(coordinate)
        setResultE(awardEvent.id)
        toast.success(
          t('Badge created and awarded', {
            count: pubkeys.length
          })
        )
      } catch (e) {
        showPublishingError(e instanceof Error ? e : new Error(String(e)))
      } finally {
        setPublishing(false)
      }
    })
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t('Copied to clipboard'))
    } catch {
      toast.error(t('Copy failed'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="size-5 shrink-0" aria-hidden />
            {t('Create and award badge')}
          </DialogTitle>
          <DialogDescription>{t('Create and award badge intro')}</DialogDescription>
        </DialogHeader>

        {resultA && resultE ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{t('Badge award published hint')}</p>
            <div className="space-y-1">
              <Label>{t('Badge definition (a tag), e.g. 30009:pubkey:bravery')}</Label>
              <div className="flex gap-2">
                <Input value={resultA} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={() => void copyText(resultA)}>
                  {t('Copy to clipboard')}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>{t('Badge award event id (e tag)')}</Label>
              <div className="flex gap-2">
                <Input value={resultE} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="sm" onClick={() => void copyText(resultE)}>
                  {t('Copy to clipboard')}
                </Button>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => resetForm()}>
                {t('Create another')}
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {t('Done')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="badge-name">{t('Badge name')}</Label>
                <Input
                  id="badge-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={handleNameBlur}
                  placeholder={t('Badge name placeholder')}
                  disabled={publishing}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="badge-d">{t('Badge id (d tag)')}</Label>
                <Input
                  id="badge-d"
                  value={dTag}
                  onChange={(e) => setDTag(e.target.value)}
                  placeholder={t('Badge id placeholder')}
                  className="font-mono text-sm"
                  disabled={publishing}
                />
                <p className="text-xs text-muted-foreground">{t('Badge id hint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="badge-desc">{t('Description')}</Label>
                <Textarea
                  id="badge-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('Badge description placeholder')}
                  rows={2}
                  disabled={publishing}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="badge-image">{t('Image URL')}</Label>
                <Input
                  id="badge-image"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://…"
                  className="font-mono text-sm"
                  disabled={publishing}
                />
                <p className="text-xs text-muted-foreground">{t('Badge image hint')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="badge-recipients">{t('Award to (npubs)')}</Label>
                <Textarea
                  id="badge-recipients"
                  value={recipientsRaw}
                  onChange={(e) => setRecipientsRaw(e.target.value)}
                  placeholder={t('Award recipients placeholder')}
                  rows={4}
                  className="font-mono text-sm"
                  disabled={publishing}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" disabled={publishing} onClick={() => onOpenChange(false)}>
                {t('Cancel')}
              </Button>
              <Button type="button" disabled={publishing} onClick={handlePublish}>
                {publishing ? t('Publishing...') : t('Publish definition and award')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
