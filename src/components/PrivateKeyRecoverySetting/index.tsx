import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { pubkeyToNpub } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import { Check, Copy, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PrivateKeyRecoverySetting() {
  const { t } = useTranslation()
  const { pubkey, nsec, ncryptsec } = useNostr()
  const [showKey, setShowKey] = useState(false)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)

  const npub = useMemo(() => (pubkey ? pubkeyToNpub(pubkey) : null), [pubkey])
  const recoverableKey = nsec ?? ncryptsec
  const keyLabel = nsec ? 'nsec' : 'ncryptsec'

  if (!pubkey || !recoverableKey) {
    return null
  }

  const copyToClipboard = async (text: string, which: 'npub' | 'key') => {
    await navigator.clipboard.writeText(text)
    if (which === 'npub') {
      setCopiedNpub(true)
      setTimeout(() => setCopiedNpub(false), 2000)
    } else {
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('Private key recovery')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'Your private key is stored in this browser. Clearing cache does not remove your account, but losing this browser profile does. Back up your key somewhere safe.'
        )}
      </p>
      {ncryptsec && !nsec && (
        <p className="text-sm text-muted-foreground">
          {t(
            'This account uses an encrypted key (ncryptsec). You need your encryption password to sign in; the blob below is for backup only.'
          )}
        </p>
      )}
      <div className="grid gap-2">
        <Label>{t('npub')}</Label>
        <div className="flex gap-2">
          <Input readOnly value={npub ?? ''} className="font-mono text-xs" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t('Copy npub')}
            onClick={() => npub && copyToClipboard(npub, 'npub')}
          >
            {copiedNpub ? <Check /> : <Copy />}
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        <Label>{t('Copy private key')} ({keyLabel})</Label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => copyToClipboard(recoverableKey, 'key')}>
            {copiedKey ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
            {t('Copy private key')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowKey((v) => !v)}>
            {showKey ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
            {showKey ? t('Hide key') : t('Show key')}
          </Button>
        </div>
        {showKey && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-orange-500 mb-2">
              {t('Do not share this with anyone. Anyone with this key can control your account.')}
            </p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{recoverableKey}</pre>
          </div>
        )}
      </div>
    </section>
  )
}
