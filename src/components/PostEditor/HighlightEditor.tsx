import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ComposerKindField, ComposerKindFieldsShell } from '@/components/Composer'
import { cleanUrl } from '@/lib/url'
import { X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { nip19 } from 'nostr-tools'

export interface HighlightData {
  sourceType: 'nostr' | 'url'
  sourceValue: string // nevent/naddr/note/hex for nostr, https:// URL for url
  sourceHexId?: string // converted hex ID for nostr sources
  context?: string // the full text/quote that the highlight is from
}

interface HighlightEditorProps {
  highlightData: HighlightData
  setHighlightData: (data: HighlightData) => void
  setIsHighlight: (value: boolean) => void
}

export default function HighlightEditor({
  highlightData,
  setHighlightData,
  setIsHighlight
}: HighlightEditorProps) {
  const { t } = useTranslation()
  const [sourceInput, setSourceInput] = useState(highlightData.sourceValue)
  const [context, setContext] = useState(highlightData.context || '')
  const [error, setError] = useState<string>('')

  // Validate and parse the source input
  useEffect(() => {
    if (!sourceInput.trim()) {
      setError('')
      return
    }

    // Check if it's a URL
    if (sourceInput.startsWith('https://') || sourceInput.startsWith('http://')) {
      // Clean tracking parameters from the URL before publishing
      const cleanedUrl = cleanUrl(sourceInput)
      setError('')
      setHighlightData({
        sourceType: 'url',
        sourceValue: cleanedUrl,
        context
      })
      return
    }

    // Try to parse as nostr identifier
    try {
      let hexId: string | undefined

      // Check if it's already a hex ID (64 char hex string)
      if (/^[a-f0-9]{64}$/i.test(sourceInput)) {
        hexId = sourceInput.toLowerCase()
        setError('')
        setHighlightData({
          sourceType: 'nostr',
          sourceValue: sourceInput,
          sourceHexId: hexId,
          context
        })
        return
      }

      // Try to decode as nip19 identifier
      const decoded = nip19.decode(sourceInput)
      
      if (decoded.type === 'note') {
        hexId = decoded.data
        setError('')
        setHighlightData({
          sourceType: 'nostr',
          sourceValue: sourceInput, // Keep original for reference
          sourceHexId: hexId, // Store the hex ID
          context
        })
      } else if (decoded.type === 'nevent') {
        hexId = decoded.data.id
        setError('')
        setHighlightData({
          sourceType: 'nostr',
          sourceValue: sourceInput, // Keep the nevent for relay info
          sourceHexId: hexId, // Store the hex ID
          context
        })
      } else if (decoded.type === 'naddr') {
        // For naddr, we need to keep the full naddr string to extract kind:pubkey:identifier
        setError('')
        setHighlightData({
          sourceType: 'nostr',
          sourceValue: sourceInput, // Keep the naddr for a-tag building
          sourceHexId: undefined, // No hex ID for addressable events
          context
        })
      } else {
        setError(t('Invalid source. Please enter a note ID, nevent, naddr, hex ID, or URL.'))
        return
      }
    } catch {
      setError(t('Invalid source. Please enter a note ID, nevent, naddr, hex ID, or URL.'))
    }
  }, [sourceInput, context, setHighlightData, t])

  return (
    <ComposerKindFieldsShell
      title={t('Highlight Settings')}
      titleAction={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title={t('Close highlight editor')}
          className="h-6 w-6 shrink-0"
          onClick={() => setIsHighlight(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      }
    >
      <ComposerKindField
        label={
          <Label htmlFor="highlight-source">
            {t('Source')} <span className="text-destructive">*</span>
          </Label>
        }
        hint={t('Enter a Nostr event identifier (nevent, naddr, note, or hex ID) OR a web URL (https://). Not both.')}
      >
        <Input
          id="highlight-source"
          value={sourceInput}
          onChange={(e) => setSourceInput(e.target.value)}
          placeholder={t('nevent1..., naddr1..., note1..., hex ID, or https://...')}
          className={error ? 'border-destructive' : ''}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </ComposerKindField>

      <ComposerKindField
        label={
          <Label htmlFor="highlight-context">
            {t('Full Quote/Context')}{' '}
            <span className="text-muted-foreground text-xs">({t('optional')})</span>
          </Label>
        }
        hint={t('The main editor above should contain only the text you want to highlight. This field should contain the full quote or paragraph for context.')}
      >
        <Textarea
          id="highlight-context"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder={t('Paste the entire original passage that contains your highlight')}
          rows={4}
          className="min-h-[5.5rem] max-h-48 resize-y"
        />
      </ComposerKindField>

      <details className="text-xs text-muted-foreground rounded border border-border/60 bg-background/50 px-3 py-2">
        <summary className="cursor-pointer font-medium text-foreground/90 select-none">
          {t('How to Create a Highlight (NIP-84)')}
        </summary>
        <ol className="mt-2 list-decimal list-inside space-y-1 pl-0.5">
          <li>{t('Enter the specific text you want to highlight in the main content area above')}</li>
          <li>{t('Add the source (where this text is from)')}</li>
          <li>{t('Optionally, add the full quote/context to show your highlight within it')}</li>
        </ol>
      </details>
    </ComposerKindFieldsShell>
  )
}
