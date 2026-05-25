import type { TPrimaryPageName } from '@/PageManager'

/** Persist primary feed window scroll across mobile secondary unmount (PageManager hides the feed while a panel is open). */
const scrollByPage = new Map<TPrimaryPageName, number>()

export function saveMobilePrimaryFeedScroll(page: TPrimaryPageName, top: number): void {
  if (!Number.isFinite(top) || top < 0) return
  scrollByPage.set(page, top)
}

export function peekMobilePrimaryFeedScroll(page: TPrimaryPageName): number {
  return scrollByPage.get(page) ?? 0
}

export function captureMobilePrimaryFeedScrollFromWindow(page: TPrimaryPageName): void {
  saveMobilePrimaryFeedScroll(page, window.scrollY)
}
