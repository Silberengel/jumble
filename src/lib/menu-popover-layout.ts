/**
 * Shared Tailwind classes for menus, popovers, and selects.
 * Uses Radix collision CSS variables so lists fit the viewport (mobile + large font).
 */

/** Dropdown / menu list vertical bound */
export const dropdownMenuMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-dropdown-menu-content-available-height,100dvh))]'

/** Popover panel vertical bound */
export const popoverMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-popover-content-available-height,100dvh))]'

/** Select viewport vertical bound */
export const selectViewportMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-select-content-available-height,80dvh))]'

/** Hover card vertical bound */
export const hoverCardMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-hover-card-content-available-height,100dvh))]'

/** Keep panels inside the screen horizontally */
export const floatingPanelMaxWidthClass = 'max-w-[min(calc(100vw-1.5rem),28rem)]'

export const floatingPanelScrollClass =
  'popover-scroll-y min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain'

/** Menu rows: wrap when root font-size is large */
export const menuItemLargeTextClass = 'min-w-0 whitespace-normal'
