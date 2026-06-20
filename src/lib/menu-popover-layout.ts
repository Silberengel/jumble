/**
 * Shared Tailwind classes for menus, popovers, and selects.
 * Uses Radix Popper collision CSS variables so lists fit the viewport (mobile + large font).
 * @see @radix-ui/react-popper — sets `--radix-popper-available-height` on floating content (px).
 */

/** Popper-aware vertical bound for any Radix floating surface */
export const radixPopperMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-popper-available-height,100dvh))]'

/** Dropdown / menu list vertical bound */
export const dropdownMenuMaxHeightClass = radixPopperMaxHeightClass

/** Popover panel vertical bound */
export const popoverMaxHeightClass = radixPopperMaxHeightClass

/** Select viewport vertical bound */
export const selectViewportMaxHeightClass =
  'max-h-[min(85dvh,var(--radix-popper-available-height,80dvh))]'

/** Hover card vertical bound */
export const hoverCardMaxHeightClass = radixPopperMaxHeightClass

/** Keep panels inside the screen horizontally */
export const floatingPanelMaxWidthClass = 'max-w-[min(calc(100vw-1.5rem),28rem)]'

export const floatingPanelScrollClass =
  'popover-scroll-y min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain'

/** Menu rows: wrap when root font-size is large */
export const menuItemLargeTextClass = 'min-w-0 whitespace-normal'
