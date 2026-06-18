import { navigateToComposer } from '@/lib/open-composer'
import { preloadComposerPageChunk } from '@/pages/secondary/ComposerPage/ComposerPageRoute'
import { useSecondaryPage } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import postEditorService from '@/services/post-editor.service'
import { PencilLine } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function WriteButton() {
  const { checkLogin } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()

  const openComposer = useCallback(() => {
    checkLogin(() => {
      if (isSmallScreen) {
        void preloadComposerPageChunk()
        navigateToComposer(push, true)
      } else {
        postEditorService.requestOpenNewPost()
      }
    })
  }, [checkLogin, isSmallScreen, push])

  useEffect(() => {
    const onRequest = () => openComposer()
    postEditorService.addEventListener('requestOpenNewPost', onRequest)
    return () => postEditorService.removeEventListener('requestOpenNewPost', onRequest)
  }, [openComposer])

  return (
    <BottomNavigationBarItem
      onClick={(e) => {
        e.stopPropagation()
        openComposer()
      }}
      onPointerEnter={() => {
        if (isSmallScreen) void preloadComposerPageChunk()
      }}
    >
      <PencilLine />
    </BottomNavigationBarItem>
  )
}
