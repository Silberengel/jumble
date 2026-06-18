import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { Ellipsis } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePaymentAttestationStatus } from '@/hooks/usePaymentAttestationStatus'
import { hexPubkeysEqual } from '@/lib/pubkey'
import { isAttestableSuperchatPayment } from '@/lib/superchat'
import { useNostr } from '@/providers/NostrProvider'
import { DesktopMenu } from './DesktopMenu'
import EditOrCloneEventDialog, { type TEditOrCloneMode } from './EditOrCloneEventDialog'
import { MobileMenu } from './MobileMenu'
import NoteOptionsMetaHeader from './NoteOptionsMetaHeader'
import RawEventDialog from './RawEventDialog'
import ReportDialog from './ReportDialog'
import { SubMenuAction, useMenuActions, type ShowSubMenuOptions } from './useMenuActions'
export default function NoteOptions({
  event,
  className,
  onOpenPublicMessage,
  onOpenCallInvite,
  pinned = false,
  seenOnAllowlist
}: {
  event: Event
  className?: string
  /** Note is shown in a pinned section (profile pins, etc.). */
  pinned?: boolean
  /** When set (home favorites feed), relay list in the menu matches the feed allowlist. */
  seenOnAllowlist?: readonly string[]
  /** Opens the post editor in public message mode with the given pubkey in the mention list. */
  onOpenPublicMessage?: (pubkey: string) => void
  /** Opens the post editor with the given content (e.g. call invite URL). */
  onOpenCallInvite?: (url: string) => void
}) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const [isRawEventDialogOpen, setIsRawEventDialogOpen] = useState(false)
  const [isAttestationDialogOpen, setIsAttestationDialogOpen] = useState(false)
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  const [editCloneOpen, setEditCloneOpen] = useState(false)
  const [editCloneMode, setEditCloneMode] = useState<TEditOrCloneMode>('clone')
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [showSubMenu, setShowSubMenu] = useState(false)
  const [activeSubMenu, setActiveSubMenu] = useState<SubMenuAction[]>([])
  const [subMenuTitle, setSubMenuTitle] = useState('')
  const [subMenuSearchable, setSubMenuSearchable] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const closeDrawer = () => {
    setIsDrawerOpen(false)
    setMenuOpen(false)
    setShowSubMenu(false)
    setSubMenuSearchable(false)
  }

  const closeDesktopMenu = () => {
    setMenuOpen(false)
    setShowSubMenu(false)
    setSubMenuSearchable(false)
  }

  const goBackToMainMenu = () => {
    setShowSubMenu(false)
    setSubMenuSearchable(false)
  }

  const showSubMenuActions = (
    subMenu: SubMenuAction[],
    title: string,
    options?: ShowSubMenuOptions
  ) => {
    setActiveSubMenu(subMenu)
    setSubMenuTitle(title)
    setSubMenuSearchable(Boolean(options?.subMenuSearchable))
    setShowSubMenu(true)
  }

  const attestableEvent = isAttestableSuperchatPayment(event) ? event : undefined
  const { attested, attestationEvent, recipientPubkey } = usePaymentAttestationStatus(attestableEvent)
  const canViewAttestation =
    attested &&
    attestationEvent != null &&
    pubkey != null &&
    recipientPubkey != null &&
    hexPubkeysEqual(pubkey, recipientPubkey)

  const menuActions = useMenuActions({
    event,
    closeDrawer,
    showSubMenuActions,
    setIsRawEventDialogOpen,
    setIsReportDialogOpen,
    isSmallScreen,
    onOpenPublicMessage,
    onOpenCallInvite,
    onOpenEditOrClone: (mode) => {
      setEditCloneMode(mode)
      setEditCloneOpen(true)
    },
    pinned,
    onViewAttestation: canViewAttestation
      ? () => {
          queueMicrotask(() => setIsAttestationDialogOpen(true))
        }
      : undefined
  })

  const trigger = useMemo(
    () => (
      <button
        className="flex items-center text-muted-foreground hover:text-foreground pl-2 h-full"
        onClick={() => setIsDrawerOpen(true)}
      >
        <Ellipsis />
      </button>
    ),
    []
  )

  const menuHeader =
    isDrawerOpen || menuOpen ? (
      <NoteOptionsMetaHeader
        event={event}
        allowedRelays={seenOnAllowlist}
        onNavigate={isSmallScreen ? closeDrawer : closeDesktopMenu}
        inDropdown={!isSmallScreen}
      />
    ) : null

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      {isSmallScreen ? (
        <MobileMenu
          menuActions={menuActions}
          trigger={trigger}
          header={menuHeader}
          isDrawerOpen={isDrawerOpen}
          setIsDrawerOpen={setIsDrawerOpen}
          showSubMenu={showSubMenu}
          activeSubMenu={activeSubMenu}
          subMenuTitle={subMenuTitle}
          subMenuSearchable={subMenuSearchable}
          closeDrawer={closeDrawer}
          goBackToMainMenu={goBackToMainMenu}
          showSubMenuActions={showSubMenuActions}
        />
      ) : (
        <DesktopMenu
          menuActions={menuActions}
          trigger={trigger}
          header={menuHeader}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      )}

      <RawEventDialog
        event={event}
        isOpen={isRawEventDialogOpen}
        onClose={() => setIsRawEventDialogOpen(false)}
      />
      {attestationEvent ? (
        <RawEventDialog
          event={attestationEvent}
          isOpen={isAttestationDialogOpen}
          onClose={() => setIsAttestationDialogOpen(false)}
          title={t('Payment attestation')}
        />
      ) : null}
      <ReportDialog
        event={event}
        isOpen={isReportDialogOpen}
        closeDialog={() => setIsReportDialogOpen(false)}
      />
      <EditOrCloneEventDialog
        open={editCloneOpen}
        onOpenChange={setEditCloneOpen}
        sourceEvent={event}
        mode={editCloneMode}
      />
    </div>
  )
}
