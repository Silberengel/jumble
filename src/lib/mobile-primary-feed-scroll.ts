import type { TPrimaryPageName } from '@/PageManager'

/** Persist primary feed scroll across mobile secondary navigation. */
const scrollByPage = new Map<TPrimaryPageName, number>()

/** Primary feed scroll container when using inner scroll (not window). */
let registeredScrollElement: HTMLElement | null = null

export function registerMobilePrimaryFeedScrollElement(el: HTMLElement | null): void {
  registeredScrollElement = el
}

/** Primary feed scrollport when registered (mobile + desktop {@link PrimaryPageLayout}). */
export function getRegisteredPrimaryFeedScrollElement(): HTMLElement | null {
  return registeredScrollElement
}

export function saveMobilePrimaryFeedScroll(page: TPrimaryPageName, top: number): void {
  if (!Number.isFinite(top) || top < 0) return
  scrollByPage.set(page, top)
}

export function peekMobilePrimaryFeedScroll(page: TPrimaryPageName): number {
  return scrollByPage.get(page) ?? 0
}

export function captureMobilePrimaryFeedScroll(page: TPrimaryPageName): void {
  const top = registeredScrollElement?.scrollTop ?? window.scrollY
  saveMobilePrimaryFeedScroll(page, top)
}

/** @deprecated Use captureMobilePrimaryFeedScroll */
export function captureMobilePrimaryFeedScrollFromWindow(page: TPrimaryPageName): void {
  captureMobilePrimaryFeedScroll(page)
}
