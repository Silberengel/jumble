import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
import {
  AdvancedLabCitationPickerDialog,
  type LabCitationDisplayType
} from '@/components/AdvancedEventLab/AdvancedLabCitationPickerDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { EditorView } from '@codemirror/view'
import {
  Anchor,
  BookMarked,
  Braces,
  ChevronDown,
  Code2,
  Film,
  Heading,
  Hash,
  Image as ImageIcon,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Sigma,
  Table2,
  Type,
  ListTodo,
  Volume2
} from 'lucide-react'
import type { MutableRefObject } from 'react'
import { Fragment, useCallback, useRef, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  labInsertRaw,
  labInsertRawWithOptionalBlockLeadNl,
  labInsertSnippet,
  labRestoreSelection,
  labWithInsertAnchor,
  labWrapOrSnippet,
  type LabInsertAnchor
} from './markup-insert'
import CitationCreateDialog from '@/components/PostEditor/CitationCreateDialog'

/** Languages for fenced / source blocks (labels are English; widely recognized by highlighters). */
const CODE_LANGUAGES = [
  'text',
  'markdown',
  'asciidoc',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'json',
  'yaml',
  'toml',
  'html',
  'xml',
  'css',
  'scss',
  'sass',
  'sql',
  'python',
  'rust',
  'go',
  'c',
  'cpp',
  'csharp',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'bash',
  'shell',
  'powershell',
  'dockerfile',
  'graphql',
  'http',
  'diff',
  'ini',
  'makefile',
  'lua',
  'r',
  'matlab',
  'latex',
  'haskell',
  'elixir',
  'scala',
  'zig',
  'nim',
  'wasm',
  'protobuf'
] as const

const LAB_CITATION_MENU_ITEMS: { type: LabCitationDisplayType; labelKey: string }[] = [
  { type: 'inline', labelKey: 'Advanced lab citation type inline' },
  { type: 'quote', labelKey: 'Advanced lab citation type quote' },
  { type: 'end', labelKey: 'Advanced lab citation type end' },
  { type: 'foot', labelKey: 'Advanced lab citation type foot' },
  { type: 'foot-end', labelKey: 'Advanced lab citation type footEnd' },
  { type: 'prompt-inline', labelKey: 'Advanced lab citation type promptInline' },
  { type: 'prompt-end', labelKey: 'Advanced lab citation type promptEnd' }
]

export type AdvancedEventLabMarkupToolbarProps = {
  markupMode: 'markdown' | 'asciidoc'
  viewRef: MutableRefObject<EditorView | null>
  sliceRef: MutableRefObject<AdvancedEventLabSlice | null>
  /** Portal markup dropdowns into the lab shell (avoids dialog outside-dismiss blocking taps). */
  menuPortalContainer?: HTMLElement | null
  /** Horizontal bar (default) or vertical sidebar beside the editor. */
  orientation?: 'horizontal' | 'vertical'
}

export function AdvancedEventLabMarkupToolbar({
  markupMode,
  viewRef,
  sliceRef,
  menuPortalContainer = null,
  orientation = 'horizontal'
}: AdvancedEventLabMarkupToolbarProps) {
  const { t } = useTranslation()
  const [codeFilter, setCodeFilter] = useState('')
  const [langFilter, setLangFilter] = useState('')
  /** Code-fence / source-block picker uses plain Buttons; close explicitly after insert (Radix). */
  const [codeLangMenuOpen, setCodeLangMenuOpen] = useState(false)
  const [citationPickerOpen, setCitationPickerOpen] = useState(false)
  const [citationCreateOpen, setCitationCreateOpen] = useState(false)
  const [citationDisplayType, setCitationDisplayType] = useState<LabCitationDisplayType>('inline')
  const savedSelectionRef = useRef<LabInsertAnchor | null>(null)

  const captureSelection = useCallback(() => {
    const v = viewRef.current
    if (!v) return
    const sel = v.state.selection.main
    savedSelectionRef.current = { from: sel.from, to: sel.to }
  }, [viewRef])

  const openCitationPicker = (displayType: LabCitationDisplayType) => {
    setCitationDisplayType(displayType)
    setCitationPickerOpen(true)
  }

  const filteredLangs = useMemo(() => {
    const q = codeFilter.trim().toLowerCase()
    if (!q) return [...CODE_LANGUAGES]
    return CODE_LANGUAGES.filter((id) => id.toLowerCase().includes(q))
  }, [codeFilter])

  const run = (fn: (v: EditorView) => void) => {
    const v = viewRef.current
    if (!v) return
    const anchor =
      savedSelectionRef.current ??
      ({
        from: v.state.selection.main.from,
        to: v.state.selection.main.to
      } satisfies LabInsertAnchor)
    savedSelectionRef.current = null
    labRestoreSelection(v, anchor)
    labWithInsertAnchor(anchor, () => fn(v))
  }

  const menuPortalProps = menuPortalContainer ? { portalContainer: menuPortalContainer } : {}

  const barPointerHandlers = {
    onPointerDownCapture: captureSelection
  }

  const citationPicker = (
    <>
      <AdvancedLabCitationPickerDialog
        open={citationPickerOpen}
        onOpenChange={setCitationPickerOpen}
        displayType={citationDisplayType}
        onInsertMacro={(macro) =>
          run((v) => labInsertRawWithOptionalBlockLeadNl(v, sliceRef, `${macro}\n`))
        }
      />
      <CitationCreateDialog
        open={citationCreateOpen}
        onOpenChange={setCitationCreateOpen}
        onInsert={(link) =>
          run((v) => labInsertRawWithOptionalBlockLeadNl(v, sliceRef, `${link}\n`))
        }
      />
    </>
  )

  const outlineTbClass = cn(
    'h-8 shrink-0 gap-1 text-xs max-md:w-9 max-md:min-w-9 max-md:justify-center max-md:gap-0 max-md:px-0',
    orientation === 'vertical' && 'w-full justify-start px-2 max-md:w-full max-md:min-w-0'
  )

  const barShellClass = cn(
    orientation === 'vertical'
      ? 'flex flex-col items-stretch gap-1 min-w-0 overflow-y-auto overflow-x-hidden border-r bg-muted/30 px-2 py-2'
      : 'flex max-md:sticky max-md:top-0 max-md:z-[25] max-md:bg-muted/95 max-md:backdrop-blur-sm flex-wrap items-center gap-1.5 min-w-0 overflow-x-auto border-b bg-muted/30 px-2 py-2'
  )

  const citationDropdown = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(outlineTbClass)}
          aria-label={t('Advanced lab tb citations')}
          title={t('Advanced lab tb citations')}
        >
          <BookMarked className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden md:inline">{t('Advanced lab tb citations')}</span>
          <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(20rem,92vw)] max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto">
        <DropdownMenuLabel>{t('Advanced lab tb citationsHint')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setCitationCreateOpen(true)}>
          {t('Create and insert citation')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {LAB_CITATION_MENU_ITEMS.map(({ type, labelKey }) => (
          <DropdownMenuItem key={type} onSelect={() => openCitationPicker(type)}>
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  /** Contiguous document header per https://docs.asciidoctor.org/asciidoc/latest/document/header/ (no blank lines until after the last header line). */
  const adocInsertFullHeader = (titleLine: string) => {
    run((v) =>
      labInsertRawWithOptionalBlockLeadNl(
        v,
        sliceRef,
        `${titleLine}\n${t('Advanced lab tb adocHeaderAuthorLine')}\n${t('Advanced lab tb adocHeaderRevisionLine')}\n${t('Advanced lab tb adocHeaderAttrsBlock')}\n\n== ${t('Advanced lab tb sectionTitle')}\n`
      )
    )
  }

  const mdFence = (lang: string) => {
    run((v) =>
      labInsertSnippet(v, sliceRef, `\`\`\`${lang}\n`, 'your code here', `\n\`\`\`\n`)
    )
  }

  const adocSource = (lang: string) => {
    run((v) =>
      labInsertSnippet(
        v,
        sliceRef,
        `[source,${lang}]\n----\n`,
        'your code here',
        `\n----\n`
      )
    )
  }

  if (markupMode === 'markdown') {
    return (
      <Fragment>
      <div className={barShellClass} {...barPointerHandlers}>
        <span className="mr-1 hidden shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
          {t('Advanced lab tb markup tools')}
        </span>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb headings')}
              title={t('Advanced lab tb headings')}
            >
              <Heading className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb headings')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto w-56">
            <DropdownMenuLabel>{t('Advanced lab tb headings hint')}</DropdownMenuLabel>
            {(
              [
                'Advanced lab tb h1',
                'Advanced lab tb h2',
                'Advanced lab tb h3',
                'Advanced lab tb h4',
                'Advanced lab tb h5',
                'Advanced lab tb h6'
              ] as const
            ).map((labelKey, i) => {
              const n = i + 1
              return (
                <DropdownMenuItem
                  key={labelKey}
                  onSelect={() =>
                    run((v) =>
                      labInsertRaw(
                        v,
                        sliceRef,
                        `${n === 1 ? '' : '\n'}${'#'.repeat(n)} ${t('Advanced lab tb heading placeholder')}\n`
                      )
                    )
                  }
                >
                  {t(labelKey)}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    `\n${t('Advanced lab tb heading placeholder')}\n===\n`
                  )
                )
              }
            >
              {t('Advanced lab tb setextH1')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    `\n${t('Advanced lab tb heading placeholder')}\n---\n`
                  )
                )
              }
            >
              {t('Advanced lab tb setextH2')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb inline')}
              title={t('Advanced lab tb inline')}
            >
              <Type className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb inline')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-56">
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '**', 'bold'))}>
              {t('Advanced lab tb bold')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '*', 'italic'))}>
              {t('Advanced lab tb italic')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '__', 'bold'))}>
              {t('Advanced lab tb boldUnderscore')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '_', 'italic'))}>
              {t('Advanced lab tb italicUnderscore')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '~~', 'strikethrough'))}>
              {t('Advanced lab tb strike')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '`', 'code'))}>
              {t('Advanced lab tb inlineCode')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertSnippet(v, sliceRef, '[', 'link text', '](https://example.com)')
                )
              }
            >
              <Link2 className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb link')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertSnippet(v, sliceRef, '![', 'alt text', '](https://example.com/image.png)')
                )
              }
            >
              <ImageIcon className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb image')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertSnippet(
                    v,
                    sliceRef,
                    '[',
                    'link text',
                    '](https://example.com "Link title")'
                  )
                )
              }
            >
              <Link2 className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb linkTitled')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertSnippet(
                    v,
                    sliceRef,
                    '![',
                    'alt text',
                    '](https://example.com/image.png "Image title")'
                  )
                )
              }
            >
              <ImageIcon className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb imageTitled')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '  \n'))}>
              <Pilcrow className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb hardBreak')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {citationDropdown}

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb lists')}
              title={t('Advanced lab tb lists')}
            >
              <List className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb lists')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-56">
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n- item one\n- item two\n'))}>
              <List className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb bulletList')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n* item one\n* item two\n'))}>
              <List className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb bulletListStar')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n1. first\n2. second\n'))}>
              <ListOrdered className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb orderedList')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    '\n4. item starting at four\n5. next item\n'
                  )
                )
              }
            >
              <ListOrdered className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb orderedListStart')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    '\n- [x] Checked box\n- [ ] Unchecked box\n'
                  )
                )
              }
            >
              <ListTodo className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb taskItem')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb blocks')}
              title={t('Advanced lab tb blocks')}
            >
              <Quote className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb blocks')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-64">
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n> quoted line\n'))}>
              <Quote className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb blockquote')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    '\n| Col A | Col B |\n| --- | --- |\n| cell | cell |\n'
                  )
                )
              }
            >
              <Table2 className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb pipeTable')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n[^1]\n'))}>
              {t('Advanced lab tb footnoteRef')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(v, sliceRef, '\n[^1]: Footnote text goes here.\n')
                )
              }
            >
              {t('Advanced lab tb footnoteDef')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}
          open={codeLangMenuOpen}
          onOpenChange={(o) => {
            setCodeLangMenuOpen(o)
            if (!o) setCodeFilter('')
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb codeBlock')}
              title={t('Advanced lab tb codeBlock')}
            >
              <Code2 className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb codeBlock')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(22rem,92vw)] p-2">
            <p className="text-xs text-muted-foreground mb-2 px-1">{t('Advanced lab tb codeBlockHint')}</p>
            <Input
              value={codeFilter}
              onChange={(e) => setCodeFilter(e.target.value)}
              placeholder={t('Advanced lab tb filterLanguages')}
              className="h-8 text-xs mb-2"
            />
            <ScrollArea className="h-[min(50vh,18rem)] pr-2">
              <div className="flex flex-col gap-0.5">
                {filteredLangs.map((lang) => (
                  <Button
                    key={lang}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 justify-start font-mono text-xs"
                    onClick={() => {
                      mdFence(lang)
                      setCodeFilter('')
                      setCodeLangMenuOpen(false)
                    }}
                  >
                    {lang}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(outlineTbClass)}
              aria-label={t('Advanced lab tb math')}
              title={t('Advanced lab tb math')}
            >
              <Sigma className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden md:inline">{t('Advanced lab tb math')}</span>
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(24rem,92vw)] max-h-[min(28rem,70dvh,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto">
            <DropdownMenuLabel>{t('Advanced lab tb mathIntro')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() =>
                  run((v) =>
                    labInsertSnippet(v, sliceRef, '$', 'x^2 + y^2 = r^2', '$')
                  )
                }
              >
                {t('Advanced lab tb mathInline')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run((v) =>
                    labInsertSnippet(v, sliceRef, '\n$$\n', 'E = mc^2', '\n$$\n')
                  )
                }
              >
                {t('Advanced lab tb mathDisplay')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Advanced lab tb mathCommon')}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\frac{numerator}{denominator}$'))}
            >
              {t('Advanced lab tb katexFrac')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\sqrt{x}$'))}>
              {t('Advanced lab tb katexSqrt')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\sum_{i=1}^{n} i$'))}
            >
              {t('Advanced lab tb katexSum')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\int_{a}^{b} f(x)\\,dx$'))}
            >
              {t('Advanced lab tb katexInt')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$'
                  )
                )
              }
            >
              {t('Advanced lab tb katexMatrix')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                run((v) =>
                  labInsertRaw(
                    v,
                    sliceRef,
                    '$$\\begin{cases} x & x > 0 \\\\ -x & x \\le 0 \\end{cases}$$'
                  )
                )
              }
            >
              {t('Advanced lab tb katexCases')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t('Advanced lab tb mathGreek')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\alpha$'))}>
              <code className="text-xs mr-2">{'\\alpha'}</code> {t('Advanced lab tb greekAlpha')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\beta$'))}>
              <code className="text-xs mr-2">{'\\beta'}</code> {t('Advanced lab tb greekBeta')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\gamma$'))}>
              <code className="text-xs mr-2">{'\\gamma'}</code> {t('Advanced lab tb greekGamma')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\delta$'))}>
              <code className="text-xs mr-2">{'\\delta'}</code> {t('Advanced lab tb greekDelta')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\pi$'))}>
              <code className="text-xs mr-2">{'\\pi'}</code> {t('Advanced lab tb greekPi')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\theta$'))}>
              <code className="text-xs mr-2">{'\\theta'}</code> {t('Advanced lab tb greekTheta')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\lambda$'))}>
              <code className="text-xs mr-2">{'\\lambda'}</code> {t('Advanced lab tb greekLambda')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\sigma$'))}>
              <code className="text-xs mr-2">{'\\sigma'}</code> {t('Advanced lab tb greekSigma')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\omega$'))}>
              <code className="text-xs mr-2">{'\\omega'}</code> {t('Advanced lab tb greekOmega')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '$\\infty$'))}>
              <code className="text-xs mr-2">{'\\infty'}</code> {t('Advanced lab tb greekInfty')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 max-md:w-9 max-md:min-w-9 max-md:justify-center max-md:px-0 gap-1 text-xs shrink-0"
              aria-label={t('Advanced lab tb horizontalRules')}
              title={t('Advanced lab tb horizontalRules')}
            >
              <Minus className="h-3.5 w-3.5 shrink-0" />
              <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-48">
            <DropdownMenuLabel>{t('Advanced lab tb horizontalRules')}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n---\n'))}>
              {t('Advanced lab tb hrDashes')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n***\n'))}>
              {t('Advanced lab tb hrAsterisks')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n___\n'))}>
              {t('Advanced lab tb hrUnderscores')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {citationPicker}
      </Fragment>
    )
  }

  /* AsciiDoc */
  return (
    <Fragment>
    <div className={barShellClass} {...barPointerHandlers}>
      <span className="mr-1 hidden shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
        {t('Advanced lab tb markup tools')}
      </span>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb adocTitles')}
            title={t('Advanced lab tb adocTitles')}
          >
            <Heading className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb adocTitles')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(22rem,92vw)] max-h-[min(32rem,80dvh,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto">
          <DropdownMenuLabel>{t('Advanced lab tb adocTitlesHint')}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRawWithOptionalBlockLeadNl(v, sliceRef, `= ${t('Advanced lab tb documentTitle')}\n`)
              )
            }
          >
            {t('Advanced lab tb adocLevel0')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => adocInsertFullHeader(`= ${t('Advanced lab tb documentTitle')}`)}>
            {t('Advanced lab tb adocLevel0WithHeader')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(
            [
              'Advanced lab tb adocSection1',
              'Advanced lab tb adocSection2',
              'Advanced lab tb adocSection3',
              'Advanced lab tb adocSection4',
              'Advanced lab tb adocSection5'
            ] as const
          ).map((labelKey, i) => {
            const n = i + 1
            return (
              <DropdownMenuItem
                key={labelKey}
                onSelect={() =>
                  run((v) =>
                    labInsertRaw(
                      v,
                      sliceRef,
                      `\n${'='.repeat(n + 1)} ${t('Advanced lab tb sectionTitle')}\n`
                    )
                  )
                }
              >
                {t(labelKey)}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb inline')}
            title={t('Advanced lab tb inline')}
          >
            <Type className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb inline')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-56">
          <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '*', 'bold'))}>
            {t('Advanced lab tb adocBold')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '_', 'italic'))}>
            {t('Advanced lab tb adocItalic')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '`', 'mono'))}>
            {t('Advanced lab tb adocMono')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, 'link:https://example.com[', 'link text', ']')
              )
            }
          >
            <Link2 className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocLink')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(
                  v,
                  sliceRef,
                  '\nimage::https://example.com/image.png[Alt text, width=640]\n'
                )
              )
            }
          >
            <ImageIcon className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocImage')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, ' +\n'))}>
            {t('Advanced lab tb adocLineBreak')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '^', 'sup'))}>
            {t('Advanced lab tb adocSuperscript')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labWrapOrSnippet(v, sliceRef, '~', 'sub'))}>
            {t('Advanced lab tb adocSubscript')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, '+++', 'raw or HTML', '+++'))}
          >
            {t('Advanced lab tb adocPassthrough')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'footnote:[Footnote text]'))}>
            {t('Advanced lab tb adocFootnote')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {citationDropdown}

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb lists')}
            title={t('Advanced lab tb lists')}
          >
            <List className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb lists')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-56">
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n* item one\n* item two\n'))}>
            {t('Advanced lab tb adocUnordered')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n. first step\n. second step\n'))}>
            {t('Advanced lab tb adocOrdered')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\nterm:: definition line\n'))}>
            {t('Advanced lab tb adocLabeled')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(
                  v,
                  sliceRef,
                  '\n[start=4]\n. fourth item\n. fifth item\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocOrderedStart')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb adocBlocks')}
            title={t('Advanced lab tb adocBlocks')}
          >
            <Pilcrow className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb adocBlocks')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-64">
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n____\n', 'Quoted paragraph', '\n____\n')
              )
            }
          >
            {t('Advanced lab tb adocQuote')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n....\n', 'Literal monospace block', '\n....\n')
              )
            }
          >
            {t('Advanced lab tb adocLiteral')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[NOTE]\n====\n',
                  'Note body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocNote')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[TIP]\n====\n',
                  'Tip body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocTip')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[WARNING]\n====\n',
                  'Warning body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocWarning')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[IMPORTANT]\n====\n',
                  'Important body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocImportant')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[CAUTION]\n====\n',
                  'Caution body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocCaution')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[example]\n====\n',
                  'Example body',
                  '\n====\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocExampleBlock')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n****\n', 'Sidebar body', '\n****\n')
              )
            }
          >
            {t('Advanced lab tb adocSidebar')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(
                  v,
                  sliceRef,
                  '\n[listing]\n----\n',
                  'Listing body (often line-oriented text)',
                  '\n----\n'
                )
              )
            }
          >
            {t('Advanced lab tb adocListing')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n--\n', 'Open block body', '\n--\n')
              )
            }
          >
            {t('Advanced lab tb adocOpenBlock')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb adocStructure')}
            title={t('Advanced lab tb adocStructure')}
          >
            <Anchor className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb adocStructure')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(22rem,92vw)] max-h-[min(28rem,70dvh,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto">
          <DropdownMenuLabel>{t('Advanced lab tb adocStructureHint')}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(
                  v,
                  sliceRef,
                  '\n|===\n|Column 1 |Column 2\n\n|Cell A |Cell B\n|===\n'
                )
              )
            }
          >
            <Table2 className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocTable')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) => labInsertRawWithOptionalBlockLeadNl(v, sliceRef, '[#section-anchor]\n'))
            }
          >
            <Hash className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocAnchor')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '<<section-anchor,', 'link label', '>>')
              )
            }
          >
            <Link2 className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocXref')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(v, sliceRef, '\nvideo::https://example.com/video.mp4[width=640]\n')
              )
            }
          >
            <Film className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocVideo')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(v, sliceRef, '\naudio::https://example.com/audio.mp3[]\n')
              )
            }
          >
            <Volume2 className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocAudio')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, '\n// Comment line\n'))}>
            {t('Advanced lab tb adocComment')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'kbd:[Ctrl+T]'))}>
            {t('Advanced lab tb adockbd')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'menu:View[Zoom > In]'))}
          >
            {t('Advanced lab tb adocMenu')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'btn:[OK]'))}>
            {t('Advanced lab tb adocBtn')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}
        open={codeLangMenuOpen}
        onOpenChange={(o) => {
          setCodeLangMenuOpen(o)
          if (!o) setLangFilter('')
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb adocSource')}
            title={t('Advanced lab tb adocSource')}
          >
            <Braces className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb adocSource')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(22rem,92vw)] p-2">
          <p className="text-xs text-muted-foreground mb-2 px-1">{t('Advanced lab tb adocSourceHint')}</p>
          <Input
            value={langFilter}
            onChange={(e) => setLangFilter(e.target.value)}
            placeholder={t('Advanced lab tb filterLanguages')}
            className="h-8 text-xs mb-2"
          />
          <ScrollArea className="h-[min(50vh,18rem)] pr-2">
            <div className="flex flex-col gap-0.5">
              {CODE_LANGUAGES.filter((id) =>
                langFilter.trim() ? id.toLowerCase().includes(langFilter.trim().toLowerCase()) : true
              ).map((lang) => (
                <Button
                  key={lang}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 justify-start font-mono text-xs"
                  onClick={() => {
                    adocSource(lang)
                    setLangFilter('')
                    setCodeLangMenuOpen(false)
                  }}
                >
                  {lang}
                </Button>
              ))}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(outlineTbClass)}
            aria-label={t('Advanced lab tb adocStem')}
            title={t('Advanced lab tb adocStem')}
          >
            <Sigma className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden md:inline">{t('Advanced lab tb adocStem')}</span>
            <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-60 md:inline-block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent {...menuPortalProps} align="start" className="z-[280] w-[min(24rem,92vw)] max-h-[min(28rem,70dvh,var(--radix-dropdown-menu-content-available-height,100dvh))] overflow-y-auto">
          <DropdownMenuLabel>{t('Advanced lab tb adocStemHint')}</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', 'x^2 + y^2', ']'))}
          >
            {t('Advanced lab tb adocStemInline')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'latexmath:[', 'x^2 + y^2', ']'))}
          >
            {t('Advanced lab tb adocLatexmathInline')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n[stem]\n++++\n', 'E = mc^2', '\n++++\n')
              )
            }
          >
            {t('Advanced lab tb adocStemBlock')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\frac{a}{b}', ']'))}
          >
            {t('Advanced lab tb katexFrac')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\sqrt{x}', ']'))}>
            {t('Advanced lab tb katexSqrt')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\sum_{i=1}^{n} i', ']'))}
          >
            {t('Advanced lab tb katexSum')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\int_{a}^{b} f(x)\\,dx', ']'))}
          >
            {t('Advanced lab tb katexInt')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(
                  v,
                  sliceRef,
                  '\n[stem]\n++++\n\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}\n++++\n'
                )
              )
            }
          >
            {t('Advanced lab tb katexMatrix')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              run((v) =>
                labInsertRaw(
                  v,
                  sliceRef,
                  '\n[stem]\n++++\n\\begin{cases} x & x > 0 \\\\ -x & x \\le 0 \\end{cases}\n++++\n'
                )
              )
            }
          >
            {t('Advanced lab tb katexCases')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t('Advanced lab tb mathGreek')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'stem:[\\alpha]'))}>
            <code className="text-xs mr-2">{'\\alpha'}</code> {t('Advanced lab tb greekAlpha')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'stem:[\\beta]'))}>
            <code className="text-xs mr-2">{'\\beta'}</code> {t('Advanced lab tb greekBeta')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'stem:[\\pi]'))}>
            <code className="text-xs mr-2">{'\\pi'}</code> {t('Advanced lab tb greekPi')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run((v) => labInsertRaw(v, sliceRef, 'stem:[\\infty]'))}>
            <code className="text-xs mr-2">{'\\infty'}</code> {t('Advanced lab tb greekInfty')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 max-md:w-9 max-md:min-w-9 max-md:justify-center max-md:px-0 text-xs shrink-0"
        aria-label={t('Advanced lab tb adocHrTitle')}
        title={t('Advanced lab tb adocHrTitle')}
        onClick={() => run((v) => labInsertRaw(v, sliceRef, "\n'''\n"))}
      >
        <Minus className="h-3.5 w-3.5 shrink-0" />
      </Button>
    </div>
    {citationPicker}
    </Fragment>
  )
}
