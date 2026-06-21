import { fileLooksLikeUploadableMedia } from '@/lib/compress-upload-media'
import { extractPastedMediaUrl } from '@/lib/composer-media-url-imeta'
import mediaUpload from '@/services/media-upload.service'
import { Extension } from '@tiptap/core'
import { EditorView } from '@tiptap/pm/view'
import { Plugin, TextSelection } from 'prosemirror-state'
import logger from '@/lib/logger'

const DRAGOVER_CLASS_LIST = [
  'outline-2',
  'outline-offset-4',
  'outline-dashed',
  'outline-border',
  'rounded-md'
]

export interface ClipboardAndDropHandlerOptions {
  onUploadStart?: (file: File, cancel: () => void) => void
  /** Same contract as `Uploader` — drop/paste uploads append URLs + imeta while staying on kind 1 unless the user picks a native media kind. */
  onUploadSuccess?: (result: {
    url: string
    tags: string[][]
    file: File
    /** True when the URL was already written into the ProseMirror doc (replace placeholder). */
    urlAlreadyInEditor?: boolean
  }) => void
  /** Pasted external media URL (no upload); parent should register imeta. */
  onMediaUrlPasted?: (url: string) => void
  onUploadEnd?: (file: File) => void
  onUploadProgress?: (file: File, progress: number) => void
  /** Same as `Uploader.onUploadCompressPhase` — keeps the post editor progress row in sync during local compression. */
  onUploadCompressPhase?: (file: File, phase: 'compressing' | 'uploading') => void
  onUploadCompressProgress?: (file: File, percent: number) => void
}

function insertTextAtSelection(view: EditorView, text: string) {
  const { schema } = view.state
  const parts = text.split('\n')
  const nodes = []
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) nodes.push(schema.nodes.hardBreak.create())
    if (parts[i]) nodes.push(schema.text(parts[i]))
  }
  if (nodes.length === 0) return
  let tr = view.state.tr.replaceSelectionWith(nodes[0])
  for (let i = 1; i < nodes.length; i++) {
    tr = tr.insert(tr.selection.from, nodes[i])
  }
  view.dispatch(tr)
}

export const ClipboardAndDropHandler = Extension.create<ClipboardAndDropHandlerOptions>({
  name: 'clipboardAndDropHandler',

  addOptions() {
    return {
      onUploadStart: undefined,
      onUploadSuccess: undefined,
      onUploadError: undefined,
      onUploadEnd: undefined,
      onUploadProgress: undefined,
      onMediaUrlPasted: undefined,
      onProvideCancel: undefined
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragenter(view, event) {
              event.preventDefault()
              view.dom.classList.add(...DRAGOVER_CLASS_LIST)
              return true
            },
            dragover(view, event) {
              event.preventDefault()
              view.dom.classList.add(...DRAGOVER_CLASS_LIST)
              return true
            },
            dragleave(view) {
              view.dom.classList.remove(...DRAGOVER_CLASS_LIST)
              return true
            }
          },
          handleDrop(view: EditorView, event: DragEvent) {
            event.preventDefault()
            event.stopPropagation()
            view.dom.classList.remove(...DRAGOVER_CLASS_LIST)

            const items = Array.from(event.dataTransfer?.files ?? [])
            const mediaFiles = items.filter((item) => fileLooksLikeUploadableMedia(item))
            if (!mediaFiles.length) return false

            uploadFiles(view, mediaFiles, options)
            return true
          },
          handlePaste(view, event) {
            const clipboard = event.clipboardData
            if (!clipboard) return false

            const fileList = Array.from(clipboard.files ?? [])
            const mediaFromFiles = fileList.filter((f) => fileLooksLikeUploadableMedia(f))
            if (mediaFromFiles.length > 0) {
              event.preventDefault()
              uploadFiles(view, mediaFromFiles, options)
              return true
            }

            for (const item of Array.from(clipboard.items)) {
              if (item.kind !== 'file') continue
              const file = item.getAsFile()
              if (file && fileLooksLikeUploadableMedia(file)) {
                event.preventDefault()
                uploadFiles(view, [file], options)
                return true
              }
            }

            const plain = clipboard.getData('text/plain')
            if (plain) {
              const mediaUrl = extractPastedMediaUrl(plain)
              if (mediaUrl) {
                event.preventDefault()
                insertTextAtSelection(view, mediaUrl)
                options.onMediaUrlPasted?.(mediaUrl)
                return true
              }
            }

            return false
          }
        }
      })
    ]
  }
})

async function uploadFiles(
  view: EditorView,
  files: File[],
  options: ClipboardAndDropHandlerOptions
) {
  const abortControllers = new Map<File, AbortController>()
  files.forEach((file) => {
    const abortController = new AbortController()
    abortControllers.set(file, abortController)
    options.onUploadStart?.(file, () => abortController.abort())
  })

  for (const file of files) {
    const name = file.name || file.type || 'clipboard'

    const placeholder = `[Uploading "${name}"...]`
    const uploadingNode = view.state.schema.text(placeholder)
    const hardBreakNode = view.state.schema.nodes.hardBreak.create()
    let tr = view.state.tr.replaceSelectionWith(uploadingNode)
    tr = tr.insert(tr.selection.from, hardBreakNode)
    view.dispatch(tr)

    const abortController = abortControllers.get(file)

    mediaUpload
      .upload(file, {
        onProgress: (p) => options.onUploadProgress?.(file, p),
        signal: abortController?.signal,
        onCompressStart: () => options.onUploadCompressPhase?.(file, 'compressing'),
        onCompressEnd: () => options.onUploadCompressPhase?.(file, 'uploading'),
        onCompressProgress: (p) => options.onUploadCompressProgress?.(file, p)
      })
      .then((result) => {
        options.onUploadEnd?.(file)
        const urlNode = view.state.schema.text(result.url)

        const tr = view.state.tr
        let didReplace = false

        view.state.doc.descendants((node, pos) => {
          if (node.isText && node.text && node.text.includes(placeholder) && !didReplace) {
            const startPos = node.text.indexOf(placeholder)
            const from = pos + startPos
            const to = from + placeholder.length
            tr.replaceWith(from, to, urlNode)
            didReplace = true
            return false
          }
          return true
        })

        if (didReplace) {
          view.dispatch(tr)
        } else {
          const endPos = view.state.doc.content.size

          const paragraphNode = view.state.schema.nodes.paragraph.create(
            null,
            view.state.schema.text(result.url)
          )

          const insertTr = view.state.tr.insert(endPos, paragraphNode)
          const newPos = endPos + 1 + result.url.length
          insertTr.setSelection(TextSelection.near(insertTr.doc.resolve(newPos)))
          view.dispatch(insertTr)
        }

        options.onUploadSuccess?.({
          url: result.url,
          tags: result.tags,
          file,
          urlAlreadyInEditor: true
        })
      })
      .catch((error) => {
        logger.error('Clipboard/drop upload failed', { error, file: file.name })
        options.onUploadEnd?.(file)

        const tr = view.state.tr
        let didReplace = false

        view.state.doc.descendants((node, pos) => {
          if (node.isText && node.text && node.text.includes(placeholder) && !didReplace) {
            const startPos = node.text.indexOf(placeholder)
            const from = pos + startPos
            const to = from + placeholder.length
            const errorNode = view.state.schema.text(`[Error uploading "${name}"]`)
            tr.replaceWith(from, to, errorNode)
            didReplace = true
            return false
          }
          return true
        })

        if (didReplace) {
          view.dispatch(tr)
        }
        throw error
      })
  }
}
