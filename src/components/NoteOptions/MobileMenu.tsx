import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  drawerMenuButtonClassName,
  drawerMenuContentClassName,
  drawerMenuScrollClassName
} from '@/components/DrawerMenuItem'
import { cn } from '@/lib/utils'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import { ArrowLeft } from 'lucide-react'
import { MenuAction, SubMenuAction } from './useMenuActions'
import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface MobileMenuProps {
  menuActions: MenuAction[]
  trigger: React.ReactNode
  header?: React.ReactNode
  isDrawerOpen: boolean
  setIsDrawerOpen: (open: boolean) => void
  showSubMenu: boolean
  activeSubMenu: SubMenuAction[]
  subMenuTitle: string
  subMenuSearchable: boolean
  closeDrawer: () => void
  goBackToMainMenu: () => void
}

function filterSubMenuRows(
  items: SubMenuAction[],
  searchable: boolean,
  query: string
): SubMenuAction[] {
  const q = query.trim().toLowerCase()
  if (!searchable || !q) return items
  return items.filter((s) => !s.filterHaystack || s.filterHaystack.includes(q))
}

function MobileMenuActionButton({
  icon: Icon,
  label,
  className,
  onClick
}: {
  icon: MenuAction['icon']
  label: React.ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <Button
      onClick={() => onClick?.()}
      className={cn(drawerMenuButtonClassName, className)}
      variant="ghost"
    >
      <Icon />
      <span className="min-w-0 flex-1 text-left">{label}</span>
    </Button>
  )
}

export function MobileMenu({
  menuActions,
  trigger,
  header,
  isDrawerOpen,
  setIsDrawerOpen,
  showSubMenu,
  activeSubMenu,
  subMenuTitle,
  subMenuSearchable,
  closeDrawer,
  goBackToMainMenu
}: MobileMenuProps) {
  const { t } = useTranslation()
  const [subMenuFilter, setSubMenuFilter] = useState('')
  useEffect(() => {
    if (!showSubMenu) setSubMenuFilter('')
  }, [showSubMenu, activeSubMenu])
  const filteredSubMenu = useMemo(
    () => filterSubMenuRows(activeSubMenu, subMenuSearchable, subMenuFilter),
    [activeSubMenu, subMenuSearchable, subMenuFilter]
  )

  return (
    <>
      {trigger}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerOverlay onClick={closeDrawer} />
        <DrawerContent hideOverlay className={drawerMenuContentClassName}>
          <DrawerHeader className="sr-only">
            <DrawerTitle>Options</DrawerTitle>
          </DrawerHeader>
          <div
            className={drawerMenuScrollClassName}
            style={{ touchAction: 'pan-y' }}
          >
            {!showSubMenu ? (
              <>
                {header}
                {menuActions.map((action, index) => {
                  const Icon = action.icon
                  return (
                    <MobileMenuActionButton
                      key={index}
                      icon={Icon}
                      label={action.label}
                      className={action.className}
                      onClick={action.onClick}
                    />
                  )
                })}
              </>
            ) : (
              <>
                <MobileMenuActionButton
                  icon={ArrowLeft}
                  label={subMenuTitle}
                  className="mb-2"
                  onClick={goBackToMainMenu}
                />
                <div className="border-t border-border mb-2" />
                {subMenuSearchable ? (
                  <div className="px-3 pb-2">
                    <Input
                      type="search"
                      value={subMenuFilter}
                      onChange={(e) => setSubMenuFilter(e.target.value)}
                      placeholder={t('Language list filter placeholder')}
                      className="h-10"
                      aria-label={t('Language list filter placeholder')}
                    />
                  </div>
                ) : null}
                {filteredSubMenu.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('Language list filter empty')}
                  </p>
                ) : (
                  filteredSubMenu.map((subAction, index) => (
                    <Button
                      key={index}
                      onClick={subAction.onClick}
                      className={cn(drawerMenuButtonClassName, subAction.className)}
                      variant="ghost"
                    >
                      <span className="min-w-0 flex-1 text-left">{subAction.label}</span>
                    </Button>
                  ))
                )}
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
