import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { MenuAction, SubMenuAction } from './useMenuActions'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface DesktopMenuProps {
  menuActions: MenuAction[]
  trigger: React.ReactNode
}

function filterSubMenuRows(
  items: SubMenuAction[],
  searchable: boolean | undefined,
  query: string
): SubMenuAction[] {
  const q = query.trim().toLowerCase()
  if (!searchable || !q) return items
  return items.filter((s) => !s.filterHaystack || s.filterHaystack.includes(q))
}

const SubMenuPanel = memo(
  ({
    action,
    subMenuFilter,
    setSubMenuFilter
  }: {
    action: MenuAction
    subMenuFilter: string
    setSubMenuFilter: (s: string) => void
  }) => {
    const { t } = useTranslation()
    const Icon = action.icon
    const sub = action.subMenu ?? []
    const filtered = useMemo(
      () => filterSubMenuRows(sub, action.subMenuSearchable, subMenuFilter),
      [sub, action.subMenuSearchable, subMenuFilter]
    )

    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={action.className}>
          <Icon />
          {action.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-[min(28rem,calc(100vw-2rem))] max-w-[28rem] min-w-[18rem] p-0">
          {action.subMenuSearchable ? (
            <div
              className="border-b border-border bg-popover p-2"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Input
                type="search"
                value={subMenuFilter}
                onChange={(e) => setSubMenuFilter(e.target.value)}
                placeholder={t('Language list filter placeholder')}
                className="h-8"
                aria-label={t('Language list filter placeholder')}
              />
            </div>
          ) : null}
          <div className="max-h-[min(50vh,22rem)] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t('Language list filter empty')}
              </div>
            ) : (
              filtered.map((subAction, subIndex) => (
                <div key={subIndex}>
                  {subAction.separator && subIndex > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={subAction.onClick}
                    className={cn(
                      'min-w-0 max-w-none whitespace-normal',
                      subAction.className
                    )}
                  >
                    {subAction.label}
                  </DropdownMenuItem>
                </div>
              ))
            )}
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  }
)
SubMenuPanel.displayName = 'SubMenuPanel'

const MenuContent = memo(
  ({
    menuActions,
    subMenuFilter,
    setSubMenuFilter
  }: {
    menuActions: MenuAction[]
    subMenuFilter: string
    setSubMenuFilter: (s: string) => void
  }) => {
    return (
      <>
        {menuActions.map((action, index) => {
          const Icon = action.icon
          return (
            <div key={index}>
              {action.separator && index > 0 && <DropdownMenuSeparator />}
              {action.subMenu ? (
                <SubMenuPanel
                  action={action}
                  subMenuFilter={subMenuFilter}
                  setSubMenuFilter={setSubMenuFilter}
                />
              ) : (
                <DropdownMenuItem onClick={action.onClick} className={action.className}>
                  <Icon />
                  {action.label}
                </DropdownMenuItem>
              )}
            </div>
          )
        })}
      </>
    )
  }
)
MenuContent.displayName = 'MenuContent'

export function DesktopMenu({ menuActions, trigger }: DesktopMenuProps) {
  const [subMenuFilter, setSubMenuFilter] = useState('')
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSubMenuFilter('')}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[50vh] overflow-y-auto">
        <MenuContent
          menuActions={menuActions}
          subMenuFilter={subMenuFilter}
          setSubMenuFilter={setSubMenuFilter}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
