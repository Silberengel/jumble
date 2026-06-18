import PostEditor from '@/components/PostEditor/LazyPostEditor'
import { navigateToComposer } from '@/lib/open-composer'
import { useSecondaryPage } from '@/PageManager'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useNostr } from '@/providers/NostrProvider'
import postEditorService from '@/services/post-editor.service'
import { PencilLine } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import SidebarItem from './SidebarItem'

export default function PostButton() {
  const { checkLogin, canSignEvents } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const { push } = useSecondaryPage()
  const [open, setOpen] = useState(false)

  const openComposer = useCallback(() => {
    checkLogin(() => {
      if (!navigateToComposer(push, isSmallScreen)) {
        setOpen(true)
      }
    })
  }, [checkLogin, isSmallScreen, push])

  useEffect(() => {
    const onRequest = () => openComposer()
    postEditorService.addEventListener('requestOpenNewPost', onRequest)
    return () => postEditorService.removeEventListener('requestOpenNewPost', onRequest)
  }, [openComposer])

  return (
    <>
      {canSignEvents ? (
        <div className="pt-4">
          <SidebarItem
            title="New post"
            description="Post"
            onClick={(e) => {
              e.stopPropagation()
              openComposer()
            }}
            variant="default"
            className="bg-primary-active hover:bg-primary-hover active:bg-primary-active xl:justify-center gap-2"
          >
            <PencilLine strokeWidth={3} />
          </SidebarItem>
        </div>
      ) : null}
      {!isSmallScreen ? <PostEditor open={open} setOpen={setOpen} /> : null}
    </>
  )
}
