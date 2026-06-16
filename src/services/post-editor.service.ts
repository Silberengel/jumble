import type { Event } from 'nostr-tools'

class PostEditorService extends EventTarget {
  static instance: PostEditorService

  isSuggestionPopupOpen = false
  /** In-dialog portal for @-mention / :emoji tippy popups (avoids Radix modal `inert` on `document.body`). */
  suggestionPopupPortal: HTMLElement | null = null
  /** Ref-count of open PostEditor / Sheet shells (reply, new post, etc.). */
  private composerShellOpenCount = 0

  get isComposerShellOpen(): boolean {
    return this.composerShellOpenCount > 0
  }

  setComposerShellOpen(open: boolean) {
    if (open) {
      this.composerShellOpenCount += 1
    } else {
      this.composerShellOpenCount = Math.max(0, this.composerShellOpenCount - 1)
    }
  }

  constructor() {
    super()
    if (!PostEditorService.instance) {
      PostEditorService.instance = this
    }
    return PostEditorService.instance
  }

  closeSuggestionPopup() {
    this.isSuggestionPopupOpen = false
    this.dispatchEvent(new CustomEvent('closeSuggestionPopup'))
  }

  /** Opens the main “new note” composer (same as sidebar / write button). Listeners run login check. */
  requestOpenNewPost() {
    this.dispatchEvent(new CustomEvent('requestOpenNewPost'))
  }

  /** Parent note when replying — used by @-mention search to surface thread participants. */
  replyParentEvent?: Event

  setReplyParentEvent(event?: Event) {
    this.replyParentEvent = event
  }

  setSuggestionPopupPortal(container: HTMLElement | null) {
    this.suggestionPopupPortal = container
  }

  getSuggestionPopupAppendTo(): HTMLElement {
    return this.suggestionPopupPortal ?? document.body
  }
}

const instance = new PostEditorService()
export default instance
