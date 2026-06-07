import { EMOJI_PICKER_DATA_SOURCE } from '@/lib/emoji-picker-data-source'

let modulePromise: Promise<typeof import('emoji-picker-element')> | null = null
let dataPromise: Promise<unknown> | null = null

/** Warm the emoji-picker-element chunk while the composer is open. */
export function preloadEmojiPickerModule() {
  if (!modulePromise) {
    modulePromise = import('emoji-picker-element')
  }
  return modulePromise
}

/** Prime the bundled emoji database so the web component's fetch hits cache. */
export function preloadEmojiPickerData() {
  if (!dataPromise) {
    dataPromise = fetch(EMOJI_PICKER_DATA_SOURCE).then((r) => r.json())
  }
  return dataPromise
}

export function preloadEmojiPicker() {
  return Promise.all([preloadEmojiPickerModule(), preloadEmojiPickerData()])
}
