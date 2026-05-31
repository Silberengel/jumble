import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  dismissNewUserBackupBanner,
  isNewUserBackupBannerVisible
} from '@/lib/post-signup-backup-prompt'
import { requestNewUserTemplateBroadcast } from '@/lib/new-user-template-broadcast'
import NcryptsecPasswordPrompt from '@/components/NcryptsecPasswordPrompt'
import { pubkeyToNpub } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import storage from '@/services/local-storage.service'
import { Check, Copy, Eye, EyeOff, KeyRound, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { toast } from 'sonner'

export default function PrivateKeyRecoverySetting() {
  const { t } = useTranslation()
  const { pubkey, account, nsec, ncryptsec, discardLocalPrivateKey } = useNostr()
  const [showKey, setShowKey] = useState(false)
  const [revealedNsec, setRevealedNsec] = useState<string | null>(null)
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false)
  const [copiedNpub, setCopiedNpub] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showBackupBanner, setShowBackupBanner] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)

  useEffect(() => {
    setShowBackupBanner(isNewUserBackupBannerVisible())
  }, [])

  const npub = useMemo(() => (pubkey ? pubkeyToNpub(pubkey) : null), [pubkey])

  const storedNsec = pubkey ? storage.getAccountNsec(pubkey) : undefined
  const storedNcryptsec = pubkey ? storage.getAccountNcryptsec(pubkey) : undefined
  const plainNsec = nsec ?? storedNsec
  const encryptedBlob = ncryptsec ?? storedNcryptsec
  const usesEncryption = !!encryptedBlob && !plainNsec
  const recoverableKey = plainNsec ?? encryptedBlob
  const displayedKey = revealedNsec ?? (showKey && !usesEncryption ? recoverableKey : null)
  const copyKeyValue = revealedNsec ?? recoverableKey
  const keyLabel = revealedNsec || plainNsec ? 'nsec' : 'ncryptsec'
  const hasLocalKey =
    account?.signerType === 'nsec' ||
    account?.signerType === 'ncryptsec' ||
    !!storedNsec ||
    !!storedNcryptsec

  if (!pubkey || !hasLocalKey || !recoverableKey) {
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

  const dismissBanner = () => {
    dismissNewUserBackupBanner()
    setShowBackupBanner(false)
    requestNewUserTemplateBroadcast(pubkey)
  }

  const handleToggleShowKey = () => {
    if (showKey) {
      setShowKey(false)
      setRevealedNsec(null)
      return
    }
    if (usesEncryption) {
      setPasswordPromptOpen(true)
      return
    }
    setShowKey(true)
  }

  const handleDecryptPassword = (password: string | null) => {
    setPasswordPromptOpen(false)
    if (!password || !encryptedBlob) return
    try {
      const privkey = nip49.decrypt(encryptedBlob, password)
      setRevealedNsec(nip19.nsecEncode(privkey))
      setShowKey(true)
    } catch {
      toast.error(t('Could not decrypt — check your password and try again.'))
    }
  }

  const handleRemoveLocalKey = () => {
    try {
      discardLocalPrivateKey()
      dismissBanner()
      setRemoveConfirmOpen(false)
      toast.success(
        t(
          'Local private key removed. This account is read-only here until you log in with an extension, bunker, or private key again.'
        )
      )
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  return (
    <section className="space-y-4">
      {showBackupBanner && (
        <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-orange-600 dark:text-orange-400">
              {t('Back up your private key now')}
            </p>
            <Button type="button" variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={dismissBanner}>
              <X className="size-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t(
              'Your account was just created. Copy your nsec (or ncryptsec) below and store it somewhere safe — password manager, encrypted file, or paper offline. Anyone with this key controls your account.'
            )}
          </p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('Private key recovery')}</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'Your private key is stored in this browser. Clearing cache does not remove your account, but losing this browser profile does. Back up your key somewhere safe.'
        )}
      </p>
      {usesEncryption && (
        <p className="text-sm text-muted-foreground">
          {t(
            'This account uses an encrypted key (ncryptsec). Use Show key and your encryption password to reveal the original nsec for backup.'
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
        <Label>
          {t('Copy private key')} ({keyLabel})
        </Label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => copyKeyValue && copyToClipboard(copyKeyValue, 'key')}>
            {copiedKey ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
            {t('Copy private key')}
          </Button>
          <Button type="button" variant="outline" onClick={handleToggleShowKey}>
            {showKey ? <EyeOff className="mr-2 size-4" /> : <Eye className="mr-2 size-4" />}
            {showKey ? t('Hide key') : t('Show key')}
          </Button>
        </div>
        {showKey && displayedKey && (
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="text-xs text-orange-500 mb-2">
              {t('Do not share this with anyone. Anyone with this key can control your account.')}
            </p>
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{displayedKey}</pre>
          </div>
        )}
      </div>
      <NcryptsecPasswordPrompt open={passwordPromptOpen} onResult={handleDecryptPassword} />
      <div className="pt-2 border-t space-y-2">
        <p className="text-sm text-muted-foreground">
          {t(
            'After backing up, you can remove the key from this browser and sign in with a browser extension or bunker instead.'
          )}
        </p>
        <Button type="button" variant="destructive" onClick={() => setRemoveConfirmOpen(true)}>
          <Trash2 className="mr-2 size-4" />
          {t('Remove local private key')}
        </Button>
      </div>
      <AlertDialog open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remove local private key?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'The private key will be deleted from this browser only. Make sure you have copied it first. This account will become read-only here until you log in again with an extension, bunker, or private key.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveLocalKey}>{t('Remove local private key')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
