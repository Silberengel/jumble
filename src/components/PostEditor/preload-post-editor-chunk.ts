/** Warm the composer chunk (note reply / sidebar post). */
export function preloadPostEditorChunk(): Promise<unknown> {
  return import('./index')
}
