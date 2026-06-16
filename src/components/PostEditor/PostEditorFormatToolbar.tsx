import EmojiPickerDialog from '@/components/EmojiPickerDialog'
import GifPicker from '@/components/GifPicker'
import MemePicker from '@/components/MemePicker'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
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
  /** When set (reply/post dialog), pickers portal here so Radix does not mark them inert. */
  pickerPortalContainer?: HTMLElement | null
  /** When false, hide the settings (advanced options) toggle. */
  showAdvancedSettings?: boolean
  /** Stack icons in a column (advanced lab sidebar). */
  orientation?: 'horizontal' | 'vertical'
}

/**
 * Icon row under the composer: media upload, emoji/GIF/meme, npub + nevent/naddr, more options.
 * Citations are available from {@link AdvancedEventLabMarkupToolbar} in the Advanced event lab only.
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
  onToggleMoreOptions,
  pickerPortalContainer,
  showAdvancedSettings = true,
  orientation = 'horizontal'
}: PostEditorFormatToolbarProps) {
  const { t } = useTranslation()

  const vertical = orientation === 'vertical'
  const iconBtnClass = cn('h-8 w-8 shrink-0 p-0', vertical && 'w-full')

  return (
    <div
      className={cn(
        vertical
          ? 'flex flex-col items-stretch gap-0.5'
          : 'flex min-w-0 flex-nowrap items-center gap-0.5'
      )}
    >
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
            className={cn(iconBtnClass, audioButtonHighlighted && 'bg-accent')}
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
        <Button type="button" variant="ghost" size="icon" className={iconBtnClass} title={t('Upload Image')}>
          <ImageUp />
        </Button>
      </Uploader>
      <Separator
        orientation={vertical ? 'horizontal' : 'vertical'}
        className={cn(vertical ? 'my-0.5 w-full shrink-0' : 'mx-0.5 h-5 shrink-0 max-sm:hidden')}
      />
      <EmojiPickerDialog
        portalContainer={pickerPortalContainer}
        onEmojiClick={(emoji) => {
          if (emoji == null) return
          insertEmoji(emoji)
        }}
      >
        <Button type="button" variant="ghost" size="icon" className={iconBtnClass} title={t('Insert emoji')}>
          <Smile />
        </Button>
      </EmojiPickerDialog>
      <GifPicker portalContainer={pickerPortalContainer} onSelect={(gifUrl) => insertText(gifUrl)}>
        <Button type="button" variant="ghost" size="icon" className={iconBtnClass} title={t('Insert GIF')}>
          <Film className="h-4 w-4" />
        </Button>
      </GifPicker>
      <MemePicker portalContainer={pickerPortalContainer} onSelect={(memeUrl) => insertText(memeUrl)}>
        <Button type="button" variant="ghost" size="icon" className={iconBtnClass} title={t('Insert meme')}>
          <Laugh className="h-4 w-4" />
        </Button>
      </MemePicker>
      <Separator
        orientation={vertical ? 'horizontal' : 'vertical'}
        className={cn(vertical ? 'my-0.5 w-full shrink-0' : 'mx-0.5 h-5 shrink-0 max-sm:hidden')}
      />
      <MentionAndEventToolbarButtons
        insertAtCursor={insertText}
        variant="ghost"
        buttonClassName={iconBtnClass}
      />
      {showAdvancedSettings ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('Advanced')}
          className={cn(iconBtnClass, showMoreOptions && 'bg-accent')}
          onClick={onToggleMoreOptions}
        >
          <Settings />
        </Button>
      ) : null}
    </div>
  )
}
