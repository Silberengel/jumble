import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useNip07ExtensionAvailable } from '@/hooks/useNip07ExtensionAvailable'
import { useNostr } from '@/providers/NostrProvider'
import { generateSecretKey } from 'nostr-tools'
import { nsecEncode } from 'nostr-tools/nip19'
import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import AccountList from '../AccountList'
import NostrConnectLogin from './NostrConnectionLogin'
import NpubLogin from './NpubLogin'
import PrivateKeyLogin from './PrivateKeyLogin'

type TAccountManagerPage = 'nsec' | 'bunker' | 'npub' | null

export default function AccountManager({ close }: { close?: () => void }) {
  const [page, setPage] = useState<TAccountManagerPage>(null)

  return (
    <>
      {page === 'nsec' ? (
        <PrivateKeyLogin back={() => setPage(null)} onLoginSuccess={() => close?.()} />
      ) : page === 'bunker' ? (
        <NostrConnectLogin back={() => setPage(null)} onLoginSuccess={() => close?.()} />
      ) : page === 'npub' ? (
        <NpubLogin back={() => setPage(null)} onLoginSuccess={() => close?.()} />
      ) : (
        <AccountManagerNav setPage={setPage} close={close} />
      )}
    </>
  )
}

function AccountManagerNav({
  setPage,
  close
}: {
  setPage: (page: TAccountManagerPage) => void
  close?: () => void
}) {
  const { t } = useTranslation()
  const { nip07Login, nsecLogin, accounts, isNip07LoginInFlight, requestAccountNetworkHydrate } =
    useNostr()
  const nip07ExtensionAvailable = useNip07ExtensionAvailable()
  const [password, setPassword] = useState('')
  const [signingUp, setSigningUp] = useState(false)
  const [extensionLoginPending, setExtensionLoginPending] = useState(false)

  const handleExtensionLogin = useCallback(async () => {
    setExtensionLoginPending(true)
    try {
      const pubkey = await nip07Login()
      if (pubkey) {
        await requestAccountNetworkHydrate()
        close?.()
      }
    } catch {
      // nip07Login toasts and rethrows
    } finally {
      setExtensionLoginPending(false)
    }
  }, [nip07Login, close])

  const handleSignUp = async () => {
    setSigningUp(true)
    try {
      const nsec = nsecEncode(generateSecretKey())
      await nsecLogin(nsec, password.trim() || undefined, true)
      setPassword('')
      close?.()
    } catch (error) {
      toast.error(t('Login failed') + ': ' + ((error as Error).message ?? String(error)))
    } finally {
      setSigningUp(false)
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-8">
      <div>
        <div className="text-center text-muted-foreground text-sm font-semibold">
          {t('Add an Account')}
        </div>
        <div className="space-y-2 mt-4">
          {nip07ExtensionAvailable && (
            <Button
              onClick={() => void handleExtensionLogin()}
              disabled={extensionLoginPending || isNip07LoginInFlight}
              className="w-full"
            >
              {extensionLoginPending || isNip07LoginInFlight ? (
                <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              ) : null}
              {t('Login with Browser Extension')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setPage('bunker')} className="w-full">
            {t('Login with Bunker')}
          </Button>
          <Button variant="secondary" onClick={() => setPage('nsec')} className="w-full">
            {t('Login with Private Key')}
          </Button>
          <Button variant="secondary" onClick={() => setPage('npub')} className="w-full">
            {t('Login with npub (read-only)')}
          </Button>
        </div>
      </div>
      <Separator />
      <div>
        <div className="text-center text-muted-foreground text-sm font-semibold">
          {t("Don't have an account yet?")}
        </div>
        <p className="text-center text-muted-foreground text-xs mt-2 px-2">
          {t(
            'Sign up creates a private key stored in this browser. Back it up anytime under Settings → Cache & offline storage.'
          )}
        </p>
        <div className="grid gap-2 mt-3">
          <Label htmlFor="signup-password-input">{t('password')}</Label>
          <Input
            id="signup-password-input"
            type="password"
            placeholder={t('optional: encrypt nsec')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={signingUp}
          />
        </div>
        <Button onClick={handleSignUp} disabled={signingUp} className="w-full mt-4">
          {signingUp ? t('Signing up…') : t('Sign up')}
        </Button>
      </div>
      {accounts.length > 0 && (
        <>
          <Separator />
          <div>
            <div className="text-center text-muted-foreground text-sm font-semibold">
              {t('Logged in Accounts')}
            </div>
            <AccountList className="mt-4" afterSwitch={() => close?.()} closeDialog={() => close?.()} />
          </div>
        </>
      )}
    </div>
  )
}
