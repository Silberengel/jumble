import { formatNpub } from '@/lib/pubkey'
import TTMention from '@tiptap/extension-mention'
import { ReactNodeViewRenderer } from '@tiptap/react'
import MentionNode from './MentionNode'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mention: {
      createMention: (id: string) => ReturnType
    }
  }
}

const Mention = TTMention.extend({
  selectable: true,

  addNodeView() {
    return ReactNodeViewRenderer(MentionNode)
  },

  addCommands() {
    return {
      ...this.parent?.(),

      createMention:
        (npub: string) =>
        ({ chain }) => {
          chain()
            .focus()
            .insertContent([
              {
                type: 'mention',
                attrs: {
                  id: npub,
                  label: formatNpub(npub)
                }
              },
              {
                type: 'text',
                text: ' '
              }
            ])
            .run()

          return true
        }
    }
  }
})
export default Mention
