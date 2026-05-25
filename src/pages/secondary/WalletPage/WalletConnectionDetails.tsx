import { Button } from '@/components/ui/button'
import { getBitcoinConnectWalletDetails } from '@/lib/wallet-connection-details'
import { useZap } from '@/providers/ZapProvider'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function WalletConnectionDetails() {
  const { t } = useTranslation()
  const { isWalletConnected, walletLightningAddress } = useZap()
  if (!isWalletConnected) return null

  const details = getBitcoinConnectWalletDetails()

  if (!details) return null

  const connectedWalletAddress =
    walletLightningAddress ?? details.nwcLud16FromUrl ?? null

  const copyRelay = () => {
    if (!details.nwcRelayUrl) return
    navigator.clipboard.writeText(details.nwcRelayUrl)
    toast.success(t('Copied to clipboard'))
  }

  const copyAddress = () => {
    if (!connectedWalletAddress) return
    navigator.clipboard.writeText(connectedWalletAddress)
    toast.success(t('Copied to clipboard'))
  }

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-border/80 bg-muted/25 px-3 py-2.5 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('Wallet connector')}
        </p>
        <p className="mt-0.5 leading-snug">
          {details.connectorName}
          <span className="text-muted-foreground"> ({details.connectorType})</span>
        </p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('Connected wallet address')}
        </p>
        {connectedWalletAddress ? (
          <div className="mt-1 flex min-w-0 items-start gap-2">
            <p className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-foreground/90">
              {connectedWalletAddress}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={copyAddress}
              aria-label={t('Copy to clipboard')}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="mt-0.5 text-muted-foreground">
            {t('This wallet did not report a Lightning address.')}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('NWC relay')}
        </p>
        {details.nwcRelayUrl ? (
          <div className="mt-1 flex min-w-0 items-start gap-2">
            <p className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-foreground/90">
              {details.nwcRelayUrl}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={copyRelay}
              aria-label={t('Copy to clipboard')}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        ) : (
          <p className="mt-0.5 text-muted-foreground">{t('Not an NWC connection (no relay URL in config).')}</p>
        )}
      </div>
    </div>
  )
}
