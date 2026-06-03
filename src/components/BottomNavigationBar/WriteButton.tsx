import PostEditor from '@/components/PostEditor'
import { useNostr } from '@/providers/NostrProvider'
import postEditorService from '@/services/post-editor.service'
import { PencilLine } from 'lucide-react'
import { useEffect, useState } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function WriteButton() {
  const { checkLogin, canSignEvents } = useNostr()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!canSignEvents) return
    const onRequest = () => {
      checkLogin(() => setOpen(true))
    }
    postEditorService.addEventListener('requestOpenNewPost', onRequest)
    return () => postEditorService.removeEventListener('requestOpenNewPost', onRequest)
  }, [canSignEvents, checkLogin])

  return (
    <>
      {canSignEvents ? (
        <BottomNavigationBarItem
          onClick={(e) => {
            e.stopPropagation()
            checkLogin(() => {
              setOpen(true)
            })
          }}
        >
          <PencilLine />
        </BottomNavigationBarItem>
      ) : null}
      <PostEditor open={open} setOpen={setOpen} />
    </>
  )
}
