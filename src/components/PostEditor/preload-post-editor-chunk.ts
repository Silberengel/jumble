/** Warm the composer chunk (note reply / sidebar post). */
export function preloadPostEditorChunk(): void {
  void import('./index')
}
