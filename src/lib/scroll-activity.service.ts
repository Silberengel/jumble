/** How long after the last scroll event we treat the user as still scrolling. */
const SCROLL_ACTIVITY_MS = 450

let scrollingUntil = 0

export const scrollActivity = {
  markScrolling() {
    scrollingUntil = Date.now() + SCROLL_ACTIVITY_MS
  },
  get isActive() {
    return Date.now() < scrollingUntil
  }
}
