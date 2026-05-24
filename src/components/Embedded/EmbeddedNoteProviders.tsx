import { DeletedEventProvider } from '@/providers/DeletedEventProvider'
import { ReplyProvider } from '@/providers/ReplyProvider'

/** Minimal providers for {@link EmbeddedNote} in isolated `createRoot` trees (e.g. Asciidoc). */
export default function EmbeddedNoteProviders({ children }: { children: React.ReactNode }) {
  return (
    <DeletedEventProvider>
      <ReplyProvider>{children}</ReplyProvider>
    </DeletedEventProvider>
  )
}
