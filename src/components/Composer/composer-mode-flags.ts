export type ComposerMode = 'full' | 'reply' | 'note' | 'discussion' | 'article'

export type ComposerModeFlags = {
  isPageLayout: boolean
  isReplyFastPath: boolean
  showKindDropdown: boolean
  showInlineAdvancedPanel: boolean
  showDialogFooter: boolean
}

/** UI visibility flags per composer mode (mobile page vs desktop dialog). */
export function getComposerModeFlags(props: {
  layoutMode: 'dialog' | 'page'
  composerMode: ComposerMode
  hasParentEvent: boolean
}): ComposerModeFlags {
  const isPageLayout = props.layoutMode === 'page'
  const isReplyFastPath =
    props.composerMode === 'reply' ||
    (isPageLayout && props.hasParentEvent && props.composerMode !== 'full')

  return {
    isPageLayout,
    isReplyFastPath,
    showKindDropdown: !isReplyFastPath && props.composerMode !== 'reply',
    showInlineAdvancedPanel: !isPageLayout,
    showDialogFooter: !isPageLayout
  }
}
