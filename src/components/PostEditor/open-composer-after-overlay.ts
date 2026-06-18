import { preloadPostEditorChunk } from './preload-post-editor-chunk'

/** Open the composer after a dropdown/drawer finishes dismissing (avoids instant outside-dismiss). */
export function openComposerAfterOverlay(setOpen: (open: boolean) => void): void {
  void preloadPostEditorChunk().then(() => {
    // Nested Radix submenus need a beat to unmount before the non-modal composer opens.
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        setOpen(true)
      })
    }, 100)
  })
}
