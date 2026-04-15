import EmojiPickerDialog from '@/components/EmojiPickerDialog'
import GifPicker from '@/components/GifPicker'
import MemePicker from '@/components/MemePicker'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { isTouchDevice } from '@/lib/utils'
import type { TEmoji } from '@/types'
import { Film, ImageUp, Laugh, Mic, Settings, Smile } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Uploader from './Uploader'
import { MentionAndEventToolbarButtons } from './PostTextarea/Mention/MentionAndEventToolbarButtons'

export type PostEditorFormatToolbarUploadHandlers = {
  onUploadSuccess: (result: { url: string; tags: string[][]; file?: File }) => void
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onProgress?: (file: File, progress: number) => void
  onUploadCompressPhase?: (file: File, phase: 'compressing' | 'uploading') => void
  onUploadCompressProgress?: (file: File, percent: number) => void
}

export type PostEditorFormatToolbarProps = {
  insertText: (text: string) => void
  insertEmoji: (emoji: string | TEmoji) => void
  upload: PostEditorFormatToolbarUploadHandlers
  showAudioUpload: boolean
  audioUploadTitle: string
  audioButtonHighlighted: boolean
  showMoreOptions: boolean
  onToggleMoreOptions: () => void
}

/**
 * Icon row under the composer: media upload, emoji/GIF/meme, npub + nevent/naddr, more options.
 * Must render inside {@link NeventPickerProvider} when using mention/event buttons.
 */
export function PostEditorFormatToolbar({
  insertText,
  insertEmoji,
  upload,
  showAudioUpload,
  audioUploadTitle,
  audioButtonHighlighted,
  showMoreOptions,
  onToggleMoreOptions
}: PostEditorFormatToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0 shrink-0">
      {showAudioUpload && (
        <Uploader
          onUploadSuccess={upload.onUploadSuccess}
          onUploadStart={upload.onUploadStart}
          onUploadEnd={upload.onUploadEnd}
          onProgress={upload.onProgress}
          onUploadCompressPhase={upload.onUploadCompressPhase}
          onUploadCompressProgress={upload.onUploadCompressProgress}
          accept="audio/*,.mka,audio/x-matroska"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={audioUploadTitle}
            className={audioButtonHighlighted ? 'bg-accent' : ''}
          >
            <Mic className="h-4 w-4" />
          </Button>
        </Uploader>
      )}
      <Uploader
        onUploadSuccess={upload.onUploadSuccess}
        onUploadStart={upload.onUploadStart}
        onUploadEnd={upload.onUploadEnd}
        onProgress={upload.onProgress}
        onUploadCompressPhase={upload.onUploadCompressPhase}
        onUploadCompressProgress={upload.onUploadCompressProgress}
        accept="image/*"
      >
        <Button type="button" variant="ghost" size="icon" title={t('Upload Image')}>
          <ImageUp />
        </Button>
      </Uploader>
      <Separator orientation="vertical" className="h-6 shrink-0" />
      {!isTouchDevice() && (
        <EmojiPickerDialog
          onEmojiClick={(emoji) => {
            if (emoji == null) return
            insertEmoji(emoji)
          }}
        >
          <Button type="button" variant="ghost" size="icon" title={t('Insert emoji')}>
            <Smile />
          </Button>
        </EmojiPickerDialog>
      )}
      <GifPicker onSelect={(gifUrl) => insertText(gifUrl)}>
        <Button type="button" variant="ghost" size="icon" title={t('Insert GIF')}>
          <Film className="h-4 w-4" />
        </Button>
      </GifPicker>
      <MemePicker onSelect={(memeUrl) => insertText(memeUrl)}>
        <Button type="button" variant="ghost" size="icon" title={t('Insert meme')}>
          <Laugh className="h-4 w-4" />
        </Button>
      </MemePicker>
      <Separator orientation="vertical" className="h-6 shrink-0" />
      <MentionAndEventToolbarButtons insertAtCursor={insertText} variant="ghost" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title={t('More options')}
        className={showMoreOptions ? 'bg-accent' : ''}
        onClick={onToggleMoreOptions}
      >
        <Settings />
      </Button>
    </div>
  )
}
