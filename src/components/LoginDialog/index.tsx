import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Dispatch, useCallback } from 'react'
import AccountManager from '../AccountManager'

export default function LoginDialog({
  open,
  setOpen,
  blockClose = false
}: {
  open: boolean
  setOpen: Dispatch<boolean>
  /** Keep open while a NIP-07 extension authorize dialog is in progress. */
  blockClose?: boolean
}) {
  const { isSmallScreen } = useScreenSize()

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && blockClose) return
      setOpen(next)
    },
    [blockClose, setOpen]
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Account Manager</DrawerTitle>
            <DrawerDescription>Manage your Nostr account and settings</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col p-4 gap-4 overflow-auto">
            <AccountManager close={() => setOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[520px] max-h-[90vh] py-8 overflow-auto">
        <DialogHeader className="sr-only">
          <DialogTitle>Account Manager</DialogTitle>
          <DialogDescription>Manage your Nostr account and settings</DialogDescription>
        </DialogHeader>
        <AccountManager close={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}
