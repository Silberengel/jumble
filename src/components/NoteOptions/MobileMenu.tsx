import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerOverlay } from '@/components/ui/drawer'
import { ArrowLeft } from 'lucide-react'
import { MenuAction, SubMenuAction } from './useMenuActions'
import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface MobileMenuProps {
  menuActions: MenuAction[]
  trigger: React.ReactNode
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

export function MobileMenu({
  menuActions,
  trigger,
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
        <DrawerContent hideOverlay className="max-h-[80vh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Options</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto overscroll-contain py-2" style={{ touchAction: 'pan-y' }}>
            {!showSubMenu ? (
              menuActions.map((action, index) => {
                const Icon = action.icon
                return (
                  <Button
                    key={index}
                    onClick={action.onClick}
                    className={`w-full p-6 justify-start text-lg gap-4 [&_svg]:size-5 ${action.className || ''}`}
                    variant="ghost"
                  >
                    <Icon />
                    {action.label}
                  </Button>
                )
              })
            ) : (
              <>
                <Button
                  onClick={goBackToMainMenu}
                  className="w-full p-6 justify-start text-lg gap-4 [&_svg]:size-5 mb-2"
                  variant="ghost"
                >
                  <ArrowLeft />
                  {subMenuTitle}
                </Button>
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
                      className={cn(
                        'w-full justify-start gap-2 px-4 py-3 h-auto min-h-0 text-left whitespace-normal',
                        subAction.className
                      )}
                      variant="ghost"
                    >
                      {subAction.label}
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
