import { useTranslation } from 'react-i18next'
import WellKnownNip05UrlLink from './WellKnownNip05UrlLink'

export default function Nip05DomainEmptyState({ domain }: { domain: string }) {
  const { t } = useTranslation()
  return (
    <div className="w-full px-4 py-10 text-center">
      <p className="text-muted-foreground">{t('No pubkeys found on NIP-05 domain')}</p>
      <p className="mt-2">
        <WellKnownNip05UrlLink domain={domain} />
      </p>
    </div>
  )
}
