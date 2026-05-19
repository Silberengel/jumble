import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function Nip07ExtensionKeyMismatchToast({
  toastId,
  onReload,
  onUseExtensionIdentity
}: {
  toastId: string | number
  onReload: () => void
  onUseExtensionIdentity: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="relative w-[min(22rem,calc(100vw-2rem))] max-w-[420px] rounded-lg border border-destructive/50 bg-background p-4 pr-10 text-foreground shadow-lg"
    >
      <button
        type="button"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t('Close')}
        onClick={() => toast.dismiss(toastId)}
      >
        <X className="size-4" aria-hidden />
      </button>
      <p className="text-sm font-semibold text-destructive">
        {t('nip07.extensionKeyMismatchTitle', {
          defaultValue: 'Extension key mismatch'
        })}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t('nip07.extensionKeyMismatchBody', {
          defaultValue:
            'Your browser extension is using a different key than this tab. Switch keys in the extension, reload the page, or sign in with the extension’s current key.'
        })}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <Button type="button" size="sm" variant="secondary" className="w-full justify-center" onClick={onReload}>
          {t('nip07.reloadPage')}
        </Button>
        <Button type="button" size="sm" className="w-full justify-center" onClick={onUseExtensionIdentity}>
          {t('nip07.useExtensionIdentity')}
        </Button>
      </div>
    </div>
  )
}
