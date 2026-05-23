import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import {
  composerTagRowFromNostrTag,
  newComposerTagRow,
  normalizeComposerExtraTags,
  type ComposerExtraTagRow
} from '@/lib/composer-extra-tags'
import { cn } from '@/lib/utils'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function labTagsToEditableRows(tags: string[][]): ComposerExtraTagRow[] {
  const normalized = tags.filter((t) => Array.isArray(t) && String(t[0] ?? '').trim())
  if (!normalized.length) return [newComposerTagRow()]
  return normalized.map((tag) => composerTagRowFromNostrTag([...tag]))
}

export function editableRowsToLabTags(rows: ComposerExtraTagRow[]): string[][] {
  return normalizeComposerExtraTags(rows)
}

export default function AdvancedEventLabTagsEditor({
  rows,
  onChange,
  className
}: {
  rows: ComposerExtraTagRow[]
  onChange: (rows: ComposerExtraTagRow[]) => void
  className?: string
}) {
  const { t } = useTranslation()
  const filledCount = rows.filter((r) => r.name.trim()).length
  const [open, setOpen] = useState(filledCount > 0)

  useEffect(() => {
    if (filledCount > 0) setOpen(true)
  }, [filledCount])

  const updateRow = (id: string, patch: Partial<Pick<ComposerExtraTagRow, 'name' | 'valuesRaw'>>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  const removeRow = (id: string) => {
    const next = rows.filter((row) => row.id !== id)
    onChange(next.length > 0 ? next : [newComposerTagRow()])
  }

  const addRow = () => {
    onChange([...rows, newComposerTagRow()])
    setOpen(true)
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('rounded-lg border bg-muted/30', className)}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 rounded-lg">
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform [[data-state=open]_&]:rotate-180" />
        <span className="flex-1">{t('advancedLabTagsTitle', { defaultValue: 'Event tags' })}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {t('advancedLabTagsCount', {
            defaultValue: '{{count}} tags',
            count: filledCount
          })}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3 pt-0 space-y-3">
        <p className="text-xs text-muted-foreground leading-snug">
          {t('advancedLabTagsHint', {
            defaultValue:
              'All tags except the client tag. One value per line for multi-value tags. Changes are saved automatically.'
          })}
        </p>
        <div className="space-y-2 max-h-[min(40vh,20rem)] overflow-y-auto pr-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap gap-2 items-start min-w-0 rounded-md border border-border/60 bg-background/50 p-2"
            >
              <div className="w-full min-w-[5rem] sm:w-28 shrink-0">
                <Label className="sr-only">{t('Tag name')}</Label>
                <Input
                  value={row.name}
                  placeholder={t('Tag name')}
                  className="font-mono text-xs h-8"
                  onChange={(e) => updateRow(row.id, { name: e.target.value })}
                />
              </div>
              <div className="flex-1 min-w-[8rem]">
                <Label className="sr-only">{t('Values')}</Label>
                <Textarea
                  value={row.valuesRaw}
                  placeholder={t('advancedLabTagValuesPlaceholder', {
                    defaultValue: 'One value per line'
                  })}
                  className="font-mono text-xs min-h-[2.25rem] resize-y"
                  rows={2}
                  onChange={(e) => updateRow(row.id, { valuesRaw: e.target.value })}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive mt-0.5"
                disabled={rows.length <= 1}
                onClick={() => removeRow(row.id)}
                aria-label={t('Remove')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addRow}>
          <Plus className="h-3.5 w-3.5" />
          {t('advancedLabTagsAdd', { defaultValue: 'Add tag' })}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}
