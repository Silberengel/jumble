import { LIGHTNING_WALLET_PAY_ENABLED } from '@/constants'
import { prepareConnectedWebLNProvider } from '@/lib/webln-payment'
import lightningService from '@/services/lightning.service'
import storage from '@/services/local-storage.service'
import { disconnect, onConnected, onDisconnected } from '@getalby/bitcoin-connect-react'
import { GetInfoResponse, WebLNProvider } from '@webbtc/webln-types'
import { createContext, useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type TZapContext = {
  isWalletConnected: boolean
  provider: WebLNProvider | null
  walletInfo: GetInfoResponse | null
  defaultZapSats: number
  updateDefaultSats: (sats: number) => void
  defaultZapComment: string
  updateDefaultComment: (comment: string) => void
  quickZap: boolean
  updateQuickZap: (quickZap: boolean) => void
  includePublicZapReceipt: boolean
  updateIncludePublicZapReceipt: (include: boolean) => void
}

const ZapContext = createContext<TZapContext | undefined>(undefined)

export const useZap = () => {
  const context = useContext(ZapContext)
  if (!context) {
    throw new Error('useZap must be used within a ZapProvider')
  }
  return context
}

export function ZapProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const [defaultZapSats, setDefaultZapSats] = useState<number>(storage.getDefaultZapSats())
  const [defaultZapComment, setDefaultZapComment] = useState<string>(storage.getDefaultZapComment())
  const [quickZap, setQuickZap] = useState<boolean>(storage.getQuickZap())
  const [includePublicZapReceipt, setIncludePublicZapReceipt] = useState<boolean>(
    storage.getIncludePublicZapReceipt()
  )
  const [isWalletConnected, setIsWalletConnected] = useState(false)
  const [provider, setProvider] = useState<WebLNProvider | null>(null)
  const [walletInfo, setWalletInfo] = useState<GetInfoResponse | null>(null)

  useEffect(() => {
    if (!LIGHTNING_WALLET_PAY_ENABLED) return

    const unSubOnConnected = onConnected((provider) => {
      setIsWalletConnected(false)
      setWalletInfo(null)
      void prepareConnectedWebLNProvider(provider)
        .then((info) => {
          setProvider(provider)
          lightningService.provider = provider
          setWalletInfo(info)
          setIsWalletConnected(true)
        })
        .catch((error) => {
          setProvider(null)
          lightningService.provider = null
          setIsWalletConnected(false)
          disconnect()
          toast.error(`${t('Lightning payment failed')}: ${(error as Error).message}`)
        })
    })
    const unSubOnDisconnected = onDisconnected(() => {
      setIsWalletConnected(false)
      setProvider(null)
      lightningService.provider = null
    })

    return () => {
      unSubOnConnected()
      unSubOnDisconnected()
    }
  }, [])

  const updateDefaultSats = (sats: number) => {
    storage.setDefaultZapSats(sats)
    setDefaultZapSats(sats)
  }

  const updateDefaultComment = (comment: string) => {
    storage.setDefaultZapComment(comment)
    setDefaultZapComment(comment)
  }

  const updateQuickZap = (quickZap: boolean) => {
    storage.setQuickZap(quickZap)
    setQuickZap(quickZap)
  }

  const updateIncludePublicZapReceipt = (include: boolean) => {
    setIncludePublicZapReceipt(include)
    void storage.setIncludePublicZapReceiptAsync(include)
  }

  return (
    <ZapContext.Provider
      value={{
        isWalletConnected,
        provider,
        walletInfo,
        defaultZapSats,
        updateDefaultSats,
        defaultZapComment,
        updateDefaultComment,
        quickZap,
        updateQuickZap,
        includePublicZapReceipt,
        updateIncludePublicZapReceipt
      }}
    >
      {children}
    </ZapContext.Provider>
  )
}
