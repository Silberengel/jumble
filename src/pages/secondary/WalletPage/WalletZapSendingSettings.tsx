import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useZap } from '@/providers/ZapProvider'
import { disconnect, launchModal } from '@getalby/bitcoin-connect-react'
import { useTranslation } from 'react-i18next'
import DefaultZapAmountInput from './DefaultZapAmountInput'
import WalletConnectionDetails from './WalletConnectionDetails'

export default function WalletZapSendingSettings() {
  const { t } = useTranslation()
  const { isWalletConnected, walletInfo } = useZap()

  if (isWalletConnected) {
    return (
      <>
        <div>
          {walletInfo?.node.alias && (
            <div className="mb-2">
              {t('Connected to')} <strong>{walletInfo.node.alias}</strong>
            </div>
          )}
          <WalletConnectionDetails />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">{t('Disconnect Wallet')}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('Are you absolutely sure?')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('You will not be able to send zaps to others.')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => disconnect()}>
                  {t('Disconnect')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <DefaultZapAmountInput />
      </>
    )
  }

  return (
    <div>
      <Button
        className="bg-foreground text-background hover:bg-foreground/90 hover:text-background"
        onClick={() => {
          launchModal()
        }}
      >
        {t('Connect Wallet')}
      </Button>
    </div>
  )
}
