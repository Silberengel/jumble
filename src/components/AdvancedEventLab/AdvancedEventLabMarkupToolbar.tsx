import type { AdvancedEventLabSlice } from '@/lib/advanced-event-lab-slice'
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
  Braces,
  ChevronDown,
  Code2,
  Heading,
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
  ListTodo
} from 'lucide-react'
import type { MutableRefObject } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { labInsertRaw, labInsertSnippet, labWrapOrSnippet } from './markup-insert'

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

export type AdvancedEventLabMarkupToolbarProps = {
  markupMode: 'markdown' | 'asciidoc'
  viewRef: MutableRefObject<EditorView | null>
  sliceRef: MutableRefObject<AdvancedEventLabSlice | null>
}

export function AdvancedEventLabMarkupToolbar({
  markupMode,
  viewRef,
  sliceRef
}: AdvancedEventLabMarkupToolbarProps) {
  const { t } = useTranslation()
  const [codeFilter, setCodeFilter] = useState('')
  const [langFilter, setLangFilter] = useState('')

  const filteredLangs = useMemo(() => {
    const q = codeFilter.trim().toLowerCase()
    if (!q) return [...CODE_LANGUAGES]
    return CODE_LANGUAGES.filter((id) => id.toLowerCase().includes(q))
  }, [codeFilter])

  const run = (fn: (v: EditorView) => void) => {
    const v = viewRef.current
    if (!v) return
    fn(v)
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
      <div className="flex flex-wrap items-center gap-1.5 min-w-0 overflow-x-auto border-b bg-muted/30 px-2 py-2">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0 mr-1">
          {t('Advanced lab tb markup tools')}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <Heading className="h-3.5 w-3.5" />
              {t('Advanced lab tb headings')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] max-h-80 overflow-y-auto w-56">
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
                  onClick={() =>
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
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n---\n'))}>
              {t('Advanced lab tb horizontalRule')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <Type className="h-3.5 w-3.5" />
              {t('Advanced lab tb inline')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] w-56">
            <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '**', 'bold'))}>
              {t('Advanced lab tb bold')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '*', 'italic'))}>
              {t('Advanced lab tb italic')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '~~', 'strikethrough'))}>
              {t('Advanced lab tb strike')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '`', 'code'))}>
              {t('Advanced lab tb inlineCode')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                run((v) =>
                  labInsertSnippet(v, sliceRef, '[', 'link text', '](https://example.com)')
                )
              }
            >
              <Link2 className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb link')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                run((v) =>
                  labInsertSnippet(v, sliceRef, '![', 'alt text', '](https://example.com/image.png)')
                )
              }
            >
              <ImageIcon className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb image')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <List className="h-3.5 w-3.5" />
              {t('Advanced lab tb lists')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] w-56">
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n- item one\n- item two\n'))}>
              <List className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb bulletList')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n1. first\n2. second\n'))}>
              <ListOrdered className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb orderedList')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <Quote className="h-3.5 w-3.5" />
              {t('Advanced lab tb blocks')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] w-64">
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n> quoted line\n'))}>
              <Quote className="h-3.5 w-3.5 mr-2 inline" />
              {t('Advanced lab tb blockquote')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
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
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n[^1]\n'))}>
              {t('Advanced lab tb footnoteRef')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                run((v) =>
                  labInsertRaw(v, sliceRef, '\n[^1]: Footnote text goes here.\n')
                )
              }
            >
              {t('Advanced lab tb footnoteDef')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu onOpenChange={(o) => !o && setCodeFilter('')}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <Code2 className="h-3.5 w-3.5" />
              {t('Advanced lab tb codeBlock')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] w-[min(22rem,92vw)] p-2">
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
                    }}
                  >
                    {lang}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
              <Sigma className="h-3.5 w-3.5" />
              {t('Advanced lab tb math')}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="z-[280] w-[min(24rem,92vw)] max-h-[min(70vh,28rem)] overflow-y-auto">
            <DropdownMenuLabel>{t('Advanced lab tb mathIntro')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() =>
                  run((v) =>
                    labInsertSnippet(v, sliceRef, '$', 'x^2 + y^2 = r^2', '$')
                  )
                }
              >
                {t('Advanced lab tb mathInline')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
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
              onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\frac{numerator}{denominator}$'))}
            >
              {t('Advanced lab tb katexFrac')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\sqrt{x}$'))}>
              {t('Advanced lab tb katexSqrt')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\sum_{i=1}^{n} i$'))}
            >
              {t('Advanced lab tb katexSum')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\int_{a}^{b} f(x)\\,dx$'))}
            >
              {t('Advanced lab tb katexInt')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
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
              onClick={() =>
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
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\alpha$'))}>
              <code className="text-xs mr-2">{'\\alpha'}</code> {t('Advanced lab tb greekAlpha')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\beta$'))}>
              <code className="text-xs mr-2">{'\\beta'}</code> {t('Advanced lab tb greekBeta')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\gamma$'))}>
              <code className="text-xs mr-2">{'\\gamma'}</code> {t('Advanced lab tb greekGamma')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\delta$'))}>
              <code className="text-xs mr-2">{'\\delta'}</code> {t('Advanced lab tb greekDelta')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\pi$'))}>
              <code className="text-xs mr-2">{'\\pi'}</code> {t('Advanced lab tb greekPi')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\theta$'))}>
              <code className="text-xs mr-2">{'\\theta'}</code> {t('Advanced lab tb greekTheta')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\lambda$'))}>
              <code className="text-xs mr-2">{'\\lambda'}</code> {t('Advanced lab tb greekLambda')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\sigma$'))}>
              <code className="text-xs mr-2">{'\\sigma'}</code> {t('Advanced lab tb greekSigma')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\omega$'))}>
              <code className="text-xs mr-2">{'\\omega'}</code> {t('Advanced lab tb greekOmega')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '$\\infty$'))}>
              <code className="text-xs mr-2">{'\\infty'}</code> {t('Advanced lab tb greekInfty')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs shrink-0"
          title={t('Advanced lab tb hrTitle')}
          onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n---\n'))}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
      </div>
    )
  }

  /* AsciiDoc */
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0 overflow-x-auto border-b bg-muted/30 px-2 py-2">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide shrink-0 mr-1">
        {t('Advanced lab tb markup tools')}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <Heading className="h-3.5 w-3.5" />
            {t('Advanced lab tb adocTitles')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-60">
          <DropdownMenuLabel>{t('Advanced lab tb adocTitlesHint')}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, `\n= ${t('Advanced lab tb documentTitle')}\n`))}>
            {t('Advanced lab tb adocLevel0')}
          </DropdownMenuItem>
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
                onClick={() =>
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <Type className="h-3.5 w-3.5" />
            {t('Advanced lab tb inline')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-56">
          <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '*', 'bold'))}>
            {t('Advanced lab tb adocBold')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '_', 'italic'))}>
            {t('Advanced lab tb adocItalic')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run((v) => labWrapOrSnippet(v, sliceRef, '`', 'mono'))}>
            {t('Advanced lab tb adocMono')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, 'link:https://example.com[', 'link text', ']')
              )
            }
          >
            <Link2 className="h-3.5 w-3.5 mr-2 inline" />
            {t('Advanced lab tb adocLink')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
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
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <List className="h-3.5 w-3.5" />
            {t('Advanced lab tb lists')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-56">
          <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n* item one\n* item two\n'))}>
            {t('Advanced lab tb adocUnordered')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\n. first step\n. second step\n'))}>
            {t('Advanced lab tb adocOrdered')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run((v) => labInsertRaw(v, sliceRef, '\nterm:: definition line\n'))}>
            {t('Advanced lab tb adocLabeled')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <Pilcrow className="h-3.5 w-3.5" />
            {t('Advanced lab tb adocBlocks')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-64">
          <DropdownMenuItem
            onClick={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n____\n', 'Quoted paragraph', '\n____\n')
              )
            }
          >
            {t('Advanced lab tb adocQuote')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run((v) =>
                labInsertSnippet(v, sliceRef, '\n....\n', 'Literal monospace block', '\n....\n')
              )
            }
          >
            {t('Advanced lab tb adocLiteral')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
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
            onClick={() =>
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
            onClick={() =>
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
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu onOpenChange={(o) => !o && setLangFilter('')}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <Braces className="h-3.5 w-3.5" />
            {t('Advanced lab tb adocSource')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-[min(22rem,92vw)] p-2">
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
                  }}
                >
                  {lang}
                </Button>
              ))}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs shrink-0">
            <Sigma className="h-3.5 w-3.5" />
            {t('Advanced lab tb adocStem')}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="z-[280] w-[min(24rem,92vw)] max-h-[min(70vh,28rem)] overflow-y-auto">
          <DropdownMenuLabel>{t('Advanced lab tb adocStemHint')}</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', 'x^2 + y^2', ']'))}
          >
            {t('Advanced lab tb adocStemInline')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\frac{a}{b}', ']'))}
          >
            {t('Advanced lab tb katexFrac')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\sqrt{x}', ']'))}>
            {t('Advanced lab tb katexSqrt')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\sum_{i=1}^{n} i', ']'))}
          >
            {t('Advanced lab tb katexSum')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => run((v) => labInsertSnippet(v, sliceRef, 'stem:[', '\\int_{a}^{b} f(x)\\,dx', ']'))}
          >
            {t('Advanced lab tb katexInt')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-xs shrink-0"
        title={t('Advanced lab tb adocHrTitle')}
        onClick={() => run((v) => labInsertRaw(v, sliceRef, "\n'''\n"))}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
