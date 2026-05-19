import { Nip07ExtensionKeyMismatchToast } from '@/components/Nip07ExtensionKeyMismatchToast'
import { toast } from 'sonner'

/** Stacked layout with dismiss — avoids Sonner squeezing long text beside action buttons. */
export function showNip07ExtensionKeyMismatchToast(opts: {
  onReload: () => void
  onUseExtensionIdentity: () => void
}): void {
  toast.custom(
    (id) => (
      <Nip07ExtensionKeyMismatchToast
        toastId={id}
        onReload={() => {
          toast.dismiss(id)
          opts.onReload()
        }}
        onUseExtensionIdentity={() => {
          toast.dismiss(id)
          void opts.onUseExtensionIdentity()
        }}
      />
    ),
    {
      duration: 35_000,
      unstyled: true
    }
  )
}
