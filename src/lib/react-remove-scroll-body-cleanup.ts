/**
 * Radix `Dialog` wraps the overlay in `react-remove-scroll`, which adds `block-interactivity-*` on
 * `document.body` so only dialog “shard” nodes receive pointer events. Programmatic overlays that
 * mount on `document.body` (e.g. Bitcoin Connect `bc-modal`) are not shards; if they appear while
 * that class is still present, the UI can paint on top but ignore all clicks (notably after closing
 * our Zap dialog from a secondary pane / sheet).
 */
function stripReactRemoveScrollBodyLocks(): void {
  if (typeof document === 'undefined') return
  const body = document.body
  const toRemove: string[] = []
  body.classList.forEach((c) => {
    if (c.startsWith('block-interactivity-')) toRemove.push(c)
  })
  for (const c of toRemove) {
    body.classList.remove(c)
  }
}

/** Slightly longer than Radix dialog exit animation (`duration-200` in our `DialogContent`). */
const MS_AFTER_RADIX_DIALOG_FOR_EXTERNAL_MODAL = 280

/**
 * Call `closeOuterModel` (e.g. close Zap `Dialog`), wait for scroll-lock cleanup when applicable,
 * strip any stuck `block-interactivity-*` on `body`, then run `fn` (typically `launchPaymentModal`).
 */
export function runAfterReleasingRadixScrollLock(
  closeOuterModel: (() => void) | undefined,
  fn: () => void
): void {
  closeOuterModel?.()
  const ms = closeOuterModel != null ? MS_AFTER_RADIX_DIALOG_FOR_EXTERNAL_MODAL : 0
  window.setTimeout(() => {
    stripReactRemoveScrollBodyLocks()
    fn()
  }, ms)
}
