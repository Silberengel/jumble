import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { lazy, Suspense, type ComponentProps } from 'react'

const PostEditorImpl = lazy(() => import('./index'))

function PostEditorLoadingShell({ open }: { open: boolean }) {
  const { isSmallScreen } = useScreenSize()
  if (!open || !isSmallScreen) return null
  return (
    <Sheet open>
      <SheetContent
        side="bottom"
        hideClose
        className="z-[51] flex w-full max-w-full flex-col border-none bg-background p-0"
        style={{ height: 'var(--vh, 100dvh)', maxHeight: 'var(--vh, 100dvh)' }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Post Editor</SheetTitle>
          <SheetDescription>Loading composer</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Loading…
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default function LazyPostEditor(props: ComponentProps<typeof PostEditorImpl>) {
  return (
    <Suspense fallback={<PostEditorLoadingShell open={props.open} />}>
      <PostEditorImpl {...props} />
    </Suspense>
  )
}
