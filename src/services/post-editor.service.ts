class PostEditorService extends EventTarget {
  static instance: PostEditorService

  isSuggestionPopupOpen = false
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
    if (this.isSuggestionPopupOpen) {
      this.isSuggestionPopupOpen = false
      this.dispatchEvent(new CustomEvent('closeSuggestionPopup'))
    }
  }

  /** Opens the main “new note” composer (same as sidebar / write button). Listeners run login check. */
  requestOpenNewPost() {
    this.dispatchEvent(new CustomEvent('requestOpenNewPost'))
  }
}

const instance = new PostEditorService()
export default instance
