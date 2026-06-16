import UserAvatar from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { toSearch } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { Search } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function MissingThreadReply({
  id,
  pubkey,
  createdAt
}: {
  id: string
  pubkey: string
  createdAt: number
}) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()
  const [copied, setCopied] = useState(false)

  const nevent = useMemo(() => nip19.neventEncode({ id, author: pubkey }), [id, pubkey])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(nevent)
      setCopied(true)
      toast.success(t('Copied!'))
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('Copy failed', { defaultValue: 'Copy failed' }))
    }
  }

  const onSearch = () => {
    push(toSearch({ type: 'note', search: nevent, input: nevent }))
  }

  return (
    <div className="border-b border-dashed border-border/70 pb-3">
      <div className="flex gap-2 sm:gap-3 px-2 sm:px-4 md:px-6 pt-2">
        <UserAvatar userId={pubkey} size="small" className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">
            {t('Thread reply not loaded locally', {
              defaultValue: 'This reply is counted in stats but could not be loaded from cache or relays.'
            })}
          </p>
          <div className="rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <code className="block break-all text-xs text-foreground/90">{nevent}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCopy}>
              {copied ? t('Copied!') : t('Copy nevent', { defaultValue: 'Copy nevent' })}
            </Button>
            <Button type="button" variant="default" size="sm" onClick={onSearch}>
              <Search className="mr-1.5 size-3.5" aria-hidden />
              {t('Search for this note', { defaultValue: 'Search for this note' })}
            </Button>
          </div>
          {createdAt > 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('Stats timestamp', { defaultValue: 'Counted at' })}{' '}
              {new Date(createdAt * 1000).toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
