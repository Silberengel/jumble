import { EMOJI_PICKER_DATA_SOURCE } from '@/lib/emoji-picker-data-source'

let modulePromise: Promise<typeof import('emoji-picker-element')> | null = null
let dbReadyPromise: Promise<void> | null = null

/** Warm the emoji-picker-element chunk while the composer is open. */
export function preloadEmojiPickerModule() {
  if (!modulePromise) {
    modulePromise = import('emoji-picker-element')
  }
  return modulePromise
}

/** Prime IndexedDB so the emoji grid is ready on first open (fetch alone does not help). */
export function preloadEmojiPickerData() {
  if (!dbReadyPromise) {
    dbReadyPromise = import('emoji-picker-element/database').then(({ default: Database }) => {
      const db = new Database({ dataSource: EMOJI_PICKER_DATA_SOURCE })
      return db.ready()
    })
  }
  return dbReadyPromise
}

export function preloadEmojiPicker() {
  return Promise.all([preloadEmojiPickerModule(), preloadEmojiPickerData()])
}
