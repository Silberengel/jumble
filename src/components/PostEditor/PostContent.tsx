import storage from '@/services/local-storage.service'
import StoredAccountSwitchSelect from '@/components/StoredAccountSwitchSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  createCommentDraftEvent,
  createPollDraftEvent,
  createPublicMessageDraftEvent,
  createPublicMessageReplyDraftEvent,
  createShortTextNoteDraftEvent,
  createHighlightDraftEvent,
  createWebBookmarkDraftEvent,
  deleteDraftEventCache,
  createVoiceDraftEvent,
  createVoiceCommentDraftEvent,
  createPictureDraftEvent,
  createVideoDraftEvent,
  createLongFormArticleDraftEvent,
  createWikiArticleDraftEvent,
  createNostrSpecificationDraftEvent,
  createPublicationContentDraftEvent,
  createCitationInternalDraftEvent,
  createCitationExternalDraftEvent,
  createCitationHardcopyDraftEvent,
  createCitationPromptDraftEvent,
  createMusicTrackDraftEvent,
  collectUploadImetaTagsForContentUrls,
  mergeUploadImetaTagsInto
} from '@/lib/draft-event'
import {
  contentWarningDraftOptions,
  normalizeContentWarningLabel
} from '@/lib/content-warning'
import {
  ExtendedKind,
  isNip71ShortVideoKind,
  isNip71StyleVideoKind,
} from '@/constants'
import { resolveReplyDraftKind } from '@/lib/reply-kind'
import { cn } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useReplyIngress } from '@/hooks/useReplyIngress'
import { getParentReplyBlurbDisplayText } from '@/lib/parent-reply-blurb'
import { relayHintsFromEventTags } from '@/lib/relay-list-builder'
import { canonicalizeRssArticleUrl, getArticleUrlFromCommentITags } from '@/lib/rss-article'
import { cleanUrl, isAudio, isImage, rewritePlainTextHttpUrls } from '@/lib/url'
import logger from '@/lib/logger'
import { startPublishTrace } from '@/lib/publish-trace'
import { LoginRequiredError } from '@/lib/nostr-errors'
import postEditorCache from '@/services/post-editor-cache.service'
import { TPollCreateData } from '@/types'
import {
  Book,
  Bookmark,
  Check,
  ChevronDown,
  ListTodo,
  Plus,
  Trash2,
  MessageCircle,
  MessagesSquare,
  X,
  Highlighter,
  FileText,
  HelpCircle,
  Quote,
  StickyNote,
  Upload,
  Music,
  Video
} from 'lucide-react'
import { fileLooksLikeUploadableMedia } from '@/lib/compress-upload-media'
import { nip94PairsToImetaTag } from '@/lib/upload-nip94-imeta'
import { getMediaKindFromFile } from '@/lib/media-kind-detection'
import { hasPrivateRelays, getPrivateRelayUrls } from '@/lib/private-relays'
import mediaUpload from '@/services/media-upload.service'
import type { TPrePublishRelayCapPreview } from '@/lib/pre-publish-relay-cap'
import { canPublishWithContent } from '@/lib/publish-content-required'
import { successfulPublishRelayUrls, type TRelayPublishStatus } from '@/lib/publish-relay-urls'
import client, { eventService } from '@/services/client.service'
import discussionFeedCache from '@/services/discussion-feed-cache.service'
import threadPanelCache from '@/features/thread-panel/thread-panel-cache'
import noteStatsService from '@/services/note-stats.service'
import shortNoteEditsService from '@/services/short-note-edits.service'
import {
  buildAllAvailableTopics,
  collectDiscussionThreadTags,
  discussionThreadDraftKindParams,
  displayTopicLabel,
  resolveTopicFromInput,
  THREAD_POST_EDITOR_PARENT,
  type TDiscussionDynamicTopics
} from '@/lib/discussion-thread-composer'
import { prefixNostrAddresses } from '@/lib/nostr-address'
import dayjs from 'dayjs'
import { TDraftEvent } from '@/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { DISCUSSION_TOPICS } from '@/pages/primary/DiscussionsPage/discussionTopics'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { showPublishingFeedback, showSimplePublishSuccess, showPublishingError } from '@/lib/publishing-feedback'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { extractMentions } from './Mentions'
import PollEditor from './PollEditor'
import PostEditorAdvancedPanel from './PostEditorAdvancedPanel'
import PostTextarea, { type ComposerEditorTab, TPostTextareaHandle } from './PostTextarea'
import {
  newNostrSpecAffectedKindRow,
  parseNostrSpecAffectedKinds,
  type NostrSpecAffectedKindRow
} from '@/lib/nostr-spec-affected-kinds'
import { NeventPickerProvider } from './PostTextarea/Mention/NeventPickerProvider'
import Uploader from './Uploader'
import HighlightEditor, { HighlightData } from './HighlightEditor'
import WebBookmarkEditor, { type WebBookmarkDraftData } from './WebBookmarkEditor'
import EditOrCloneEventDialog from '../NoteOptions/EditOrCloneEventDialog'
import type { PostEditorAdvancedLabHandle } from './PostEditorAdvancedLabHost'
import { usePlainComposerBody } from './usePlainComposerBody'

const PostEditorAdvancedLabHost = lazy(() => import('./PostEditorAdvancedLabHost'))
import {
  PostEditorFormatToolbar,
  type PostEditorFormatToolbarUploadHandlers
} from './PostEditorFormatToolbar'
import { isAsciidocMarkupKind } from '@/lib/advanced-event-lab-kinds'
import { imageUrlLooksLikeHttpImage } from '@/lib/composer-markup-insert'
import {
  buildImetaTagFromMediaUrl,
  enrichImetaTagFromMediaUrl,
  inferMediaKindFromUrl,
  mimeFromMediaUrl
} from '@/lib/composer-media-url-imeta'
import {
  COMPOSER_IMETA_CONTENT_SYNC_DEBOUNCE_MS,
  composerContentHasUploadPlaceholder,
  composerImetaTagsEqual,
  extractMediaUrlsFromComposerContent,
  imetaUrlFromTagRow,
  normalizeComposerMediaUrlKey,
  reconcileComposerImetaWithContent
} from '@/lib/composer-imeta-content-sync'
import { useComposerController } from '@/hooks/useComposerController'
import { useActivityTraceRender } from '@/hooks/useActivityTraceRender'
import { ComposerKindFieldsShell } from '@/components/Composer'
import { getComposerModeFlags } from '@/components/Composer/composer-mode-flags'
import { useRegisterComposerAdvancedPanel } from '@/contexts/composer-session-context'

/** Let the UI paint before heavy work. `requestAnimationFrame` alone can stall indefinitely in hidden or throttled documents. */
function yieldForPaintBeforeHeavyWork(): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 50))
  ])
}

/** Audio picked via the mic toolbar button (accept=audio/*), including mislabeled webm/mp4/m4a. */
function fileLooksLikeMicAudioUpload(file: File): boolean {
  const fileType = file.type
  const fileName = file.name.toLowerCase()
  const isAudioMime =
    fileType.startsWith('audio/') ||
    fileType === 'audio/mp4' ||
    fileType === 'audio/x-m4a' ||
    fileType === 'audio/m4a' ||
    fileType === 'audio/webm' ||
    fileType === 'audio/mpeg'
  const isAudioExt = /\.(mp3|m4a|mka|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
  const isM4aFile = /\.m4a$/i.test(fileName)
  const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
  const isWebmFile = /\.webm$/i.test(fileName)
  const isOggFile = /\.ogg$/i.test(fileName)
  const isMp3File = /\.mp3$/i.test(fileName)
  return (
    isAudioMime ||
    isAudioExt ||
    isM4aFile ||
    isMp4Audio ||
    isWebmFile ||
    isOggFile ||
    isMp3File
  )
}

/** Title + kind-specific metadata scroll in a capped header so the editor keeps remaining space. */
function ComposerHeaderScroll({
  enabled,
  size = 'default',
  children
}: {
  enabled: boolean
  /** Tall forms (music track, citations, articles) need a bit more header room on desktop. */
  size?: 'default' | 'tall'
  children: React.ReactNode
}) {
  if (!enabled) return <>{children}</>
  return (
    <div
      className={cn(
        'flex min-h-0 shrink-0 flex-col gap-2 overflow-y-auto overscroll-y-contain popover-scroll-y',
        size === 'tall' ? 'max-h-[min(42dvh,20rem)]' : 'max-h-[min(36dvh,16rem)]'
      )}
    >
      {children}
    </div>
  )
}

function hasExtendedComposerHeaderFields(flags: {
  isDiscussionThread: boolean
  parentEvent?: Event
  isMusicTrack: boolean
  isLongFormArticle: boolean
  isWikiArticle: boolean
  isNostrSpecification: boolean
  isPublicationContent: boolean
  isCitationInternal: boolean
  isCitationExternal: boolean
  isCitationHardcopy: boolean
  isCitationPrompt: boolean
  isHighlight: boolean
  isWebBookmark: boolean
  isPoll: boolean
  isPublicMessage: boolean
}): boolean {
  if (flags.isDiscussionThread && !flags.parentEvent) return true
  return (
    flags.isMusicTrack ||
    flags.isLongFormArticle ||
    flags.isWikiArticle ||
    flags.isNostrSpecification ||
    flags.isPublicationContent ||
    flags.isCitationInternal ||
    flags.isCitationExternal ||
    flags.isCitationHardcopy ||
    flags.isCitationPrompt ||
    flags.isHighlight ||
    flags.isWebBookmark ||
    flags.isPoll ||
    flags.isPublicMessage
  )
}

export default function PostContent({
  open,
  defaultContent = '',
  parentEvent,
  close,
  openFrom,
  initialHighlightData,
  initialPublicMessageTo,
  onPublishSuccess,
  discussionDynamicTopics,
  pickerPortalContainer,
  advancedLabPortalContainer,
  advancedLabPortalRef,
  onAdvancedLabOpenChange,
  /** Desktop main composer only; lazy-loads CodeMirror when opened. */
  enableAdvancedEditor = false,
  layoutMode = 'dialog',
  composerMode = 'full',
  onOpenOptions,
  onPublishRequestRef,
  onClearRequestRef,
  onComposerUiStateChange
}: {
  /** When false, the post shell is closed (e.g. dialog). Used to re-sync the TipTap body when reopened. */
  open: boolean
  defaultContent?: string
  parentEvent?: Event
  close: () => void
  openFrom?: string[]
  initialHighlightData?: HighlightData
  /** When set, opens in public message mode with this pubkey in the mention list. */
  initialPublicMessageTo?: string
  /** Called after a reply/post is successfully published, before closing. */
  onPublishSuccess?: () => void
  /** Optional hot/discussion topics (e.g. from Discussions spell) for the thread composer. */
  discussionDynamicTopics?: TDiscussionDynamicTopics | null
  /** Portal mount for emoji/GIF/meme pickers so they stay inside the modal (not inert). */
  pickerPortalContainer?: HTMLElement | null
  /** Full-viewport portal for the advanced lab (outside the composer dialog bounds). */
  advancedLabPortalContainer?: HTMLElement | null
  /** Sync ref to the lab portal shell (available before React state commits). */
  advancedLabPortalRef?: RefObject<HTMLElement | null>
  /** Notifies the composer shell when the full-screen advanced lab opens or closes. */
  onAdvancedLabOpenChange?: (open: boolean) => void
  /** Desktop new-post dialog only; never set on mobile or reply/other composer modes. */
  enableAdvancedEditor?: boolean
  /** Full-screen composer page (mobile) vs dialog shell. */
  layoutMode?: 'dialog' | 'page'
  /** Simplified UI for mobile page modes. */
  composerMode?: 'full' | 'reply' | 'note' | 'discussion' | 'article'
  onOpenOptions?: () => void
  /** Parent page wires titlebar Publish to this ref. */
  onPublishRequestRef?: RefObject<(() => void) | null>
  onClearRequestRef?: RefObject<(() => void) | null>
  onComposerUiStateChange?: (state: {
    publishDisabled: boolean
    posting: boolean
    blockMessage: string | null
    publishLabel?: string
    hasDraft?: boolean
    relaySelectedTotal?: number
  }) => void
}) {
  const { t, i18n } = useTranslation()
  const { pubkey, publish, checkLogin, canSignEvents } = useNostr()
  const { isSmallScreen } = useScreenSize()
  const { addReplies } = useReplyIngress()

  const mergePublishedReplyIntoThread = useCallback(
    (reply: Event, relayStatuses?: TRelayPublishStatus[]) => {
      if (!parentEvent) return
      const clean = { ...reply } as Event
      delete (clean as any).relayStatuses
      addReplies([clean])
      const isQuotePost = clean.tags.some((t) => t[0] === 'q' && t[1])
      noteStatsService.updateNoteStatsByEvents(
        [clean],
        undefined,
        isQuotePost ? undefined : { replyParentNoteId: parentEvent.id }
      )
      const rootInfo =
        parentEvent.kind === ExtendedKind.RSS_THREAD_ROOT
          ? (() => {
              const articleUrl = getArticleUrlFromCommentITags(parentEvent)
              if (articleUrl) {
                return {
                  type: 'I' as const,
                  id: canonicalizeRssArticleUrl(articleUrl)
                }
              }
              return { type: 'E' as const, id: parentEvent.id, pubkey: parentEvent.pubkey }
            })()
          : !isReplaceableEvent(parentEvent.kind)
            ? { type: 'E' as const, id: parentEvent.id, pubkey: parentEvent.pubkey }
            : {
                type: 'A' as const,
                id: getReplaceableCoordinateFromEvent(parentEvent),
                eventId: parentEvent.id,
                pubkey: parentEvent.pubkey,
                relay: client.getEventHint(parentEvent.id)
              }
      const cached = threadPanelCache.getCachedReplies(rootInfo) ?? []
      const next = cached.filter((r) => r.id !== clean.id).concat([clean])
      threadPanelCache.setCachedReplies(rootInfo, next)

      const urls = successfulPublishRelayUrls(relayStatuses)
      if (!clean.id || urls.length === 0) return

      const delayMs = 1600
      setTimeout(() => {
        void eventService.fetchEventWithExternalRelays(clean.id, urls).then((fresh) => {
          if (!fresh || fresh.id !== clean.id) return
          addReplies([fresh])
          const merged = (threadPanelCache.getCachedReplies(rootInfo) ?? []).filter((r) => r.id !== fresh.id)
          threadPanelCache.setCachedReplies(rootInfo, [...merged, fresh])
          client.addEventToCache(fresh)
        })
      }, delayMs)
    },
    [addReplies, parentEvent]
  )
  const [text, setText] = useState('')
  const [editorHasContent, setEditorHasContent] = useState(false)
  const handleEditorNonemptyChange = useCallback((nonempty: boolean) => {
    setEditorHasContent(nonempty)
  }, [])
  useActivityTraceRender('PostContent', { textLen: text.length, editorHasContent })
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const [composerEditorTab, setComposerEditorTab] = useState<ComposerEditorTab>('edit')
  const isComposerEditTab = composerEditorTab === 'edit'
  const mediaUploaderBtnRef = useRef<HTMLButtonElement>(null)
  const [posting, setPosting] = useState(false)
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void; phase: 'compressing' | 'uploading' }[]
  >([])
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [createCustomEventOpen, setCreateCustomEventOpen] = useState(false)
  const [addClientTag, setAddClientTag] = useState(() => storage.getAddClientTag())
  const [mentions, setMentions] = useState<string[]>([])
  const [isNsfw, setIsNsfw] = useState(false)
  const [contentWarningLabel, setContentWarningLabel] = useState('')
  const [isPoll, setIsPoll] = useState(false)
  const [isPublicMessage, setIsPublicMessage] = useState(!!initialPublicMessageTo)
  const [extractedMentions, setExtractedMentions] = useState<string[]>(
    initialPublicMessageTo ? [initialPublicMessageTo] : []
  )
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  /** When set, too many relays are checked vs the per-publish cap; publish stays disabled until unchecking. */
  const [relayCapBlockInfo, setRelayCapBlockInfo] = useState<{
    outboxSlotsInPublish: number
    selectedContacted: number
    selectedTotal: number
  } | null>(null)
  const [relayCapPreview, setRelayCapPreview] = useState<TPrePublishRelayCapPreview | null>(null)
  const [isHighlight, setIsHighlight] = useState(!!initialHighlightData)
  const [highlightData, setHighlightData] = useState<HighlightData>(
    initialHighlightData || {
      sourceType: 'nostr',
      sourceValue: ''
    }
  )
  const [isWebBookmark, setIsWebBookmark] = useState(false)
  const [webBookmarkData, setWebBookmarkData] = useState<WebBookmarkDraftData>({ url: '', title: '' })
  const [pollCreateData, setPollCreateData] = useState<TPollCreateData>({
    isMultipleChoice: false,
    options: ['', ''],
    endsAt: undefined,
    relays: []
  })
  const [minPow, setMinPow] = useState(0)
  const [isDiscussionThread, setIsDiscussionThread] = useState(false)
  const [threadTitle, setThreadTitle] = useState('')
  const [threadTopicInput, setThreadTopicInput] = useState(() => {
    const row = DISCUSSION_TOPICS.find((x) => x.id === 'general')
    return row?.label ?? 'general'
  })
  const [threadSelectedTopic, setThreadSelectedTopic] = useState('general')
  const [threadIsReadingGroup, setThreadIsReadingGroup] = useState(false)
  const [threadReadingAuthor, setThreadReadingAuthor] = useState('')
  const [threadReadingSubject, setThreadReadingSubject] = useState('')
  const [threadShowReadingsPanel, setThreadShowReadingsPanel] = useState(false)
  const [threadTopicPopoverOpen, setThreadTopicPopoverOpen] = useState(false)
  const [threadErrors, setThreadErrors] = useState<{
    title?: string
    content?: string
    topic?: string
    relay?: string
    author?: string
    subject?: string
  }>({})
  const [mediaNoteKind, setMediaNoteKind] = useState<number | null>(null)
  const [mediaImetaTags, setMediaImetaTags] = useState<string[][]>([])
  const [mediaUrl, setMediaUrl] = useState<string>('')
  const [isLongFormArticle, setIsLongFormArticle] = useState(false)
  const [isWikiArticle, setIsWikiArticle] = useState(false)
  const [isNostrSpecification, setIsNostrSpecification] = useState(false)
  const [isPublicationContent, setIsPublicationContent] = useState(false)
  const [isMusicTrack, setIsMusicTrack] = useState(false)
  const [musicTrackDTag, setMusicTrackDTag] = useState('')
  const [musicTrackTitle, setMusicTrackTitle] = useState('')
  const [musicTrackArtist, setMusicTrackArtist] = useState('')
  const [musicTrackAudioUrl, setMusicTrackAudioUrl] = useState('')
  const [musicTrackImageUrl, setMusicTrackImageUrl] = useState('')
  const [musicTrackAlbum, setMusicTrackAlbum] = useState('')
  const [musicTrackDuration, setMusicTrackDuration] = useState('')
  const [musicTrackFormat, setMusicTrackFormat] = useState('')
  const [musicTrackLanguage, setMusicTrackLanguage] = useState('')
  const [musicTrackGenres, setMusicTrackGenres] = useState('')
  const [nostrSpecAffectedKindRows, setNostrSpecAffectedKindRows] = useState<NostrSpecAffectedKindRow[]>(
    () => [newNostrSpecAffectedKindRow()]
  )
  const [articleTitle, setArticleTitle] = useState('')
  const [articleDTag, setArticleDTag] = useState('')
  const [articleImage, setArticleImage] = useState('')
  const [articleSubject, setArticleSubject] = useState('')
  const [articleSummary, setArticleSummary] = useState('')
  const [isCitationInternal, setIsCitationInternal] = useState(false)
  const [isCitationExternal, setIsCitationExternal] = useState(false)
  const [isCitationHardcopy, setIsCitationHardcopy] = useState(false)
  const [isCitationPrompt, setIsCitationPrompt] = useState(false)
  
  // Citation metadata fields
  // Internal Citation (30)
  const [citationInternalCTag, setCitationInternalCTag] = useState('')
  const [citationInternalRelayHint, setCitationInternalRelayHint] = useState('')
  // External Citation (31) 
  const [citationExternalUrl, setCitationExternalUrl] = useState('')
  const [citationExternalOpenTimestamp, setCitationExternalOpenTimestamp] = useState('')
  // Hardcopy Citation (32)
  const [citationHardcopyPageRange, setCitationHardcopyPageRange] = useState('')
  const [citationHardcopyChapterTitle, setCitationHardcopyChapterTitle] = useState('')
  const [citationHardcopyEditor, setCitationHardcopyEditor] = useState('')
  const [citationHardcopyPublishedIn, setCitationHardcopyPublishedIn] = useState('')
  const [citationHardcopyVolume, setCitationHardcopyVolume] = useState('')
  const [citationHardcopyDoi, setCitationHardcopyDoi] = useState('')
  // Prompt Citation (33)
  const [citationPromptLlm, setCitationPromptLlm] = useState('')
  // Shared citation fields
  const [citationTitle, setCitationTitle] = useState('')
  const [citationAuthor, setCitationAuthor] = useState('')
  const [citationPublishedOn, setCitationPublishedOn] = useState('')
  const [citationPublishedBy, setCitationPublishedBy] = useState('')
  const [citationAccessedOn, setCitationAccessedOn] = useState('')
  const [citationLocation, setCitationLocation] = useState('')
  const [citationGeohash, setCitationGeohash] = useState('')
  const [citationVersion, setCitationVersion] = useState('')
  const [citationSummary, setCitationSummary] = useState('')

  const [hasPrivateRelaysAvailable, setHasPrivateRelaysAvailable] = useState(false)
  const [showMediaKindDialog, setShowMediaKindDialog] = useState(false)
  const [pendingMediaUpload, setPendingMediaUpload] = useState<{
    url: string
    tags: string[][]
    file: File
    urlAlreadyInEditor?: boolean
  } | null>(null)
  const uploadedMediaFileMap = useRef<Map<string, File>>(new Map())
  /** Accumulates imeta tags across uploads (short note or multi-attachment) so files are not dropped. */
  const composerImetaTagsRef = useRef<string[][]>([])
  const mediaNoteKindRef = useRef<number | null>(null)
  /** True when the hidden uploader was opened from Note type → Media Note (not toolbar paste/drop). */
  const mediaNoteUploaderIntentRef = useRef(false)
  /** True when the mic toolbar button started an audio upload (root composer voice notes). */
  const micAudioUploadIntentRef = useRef(false)
  const [mediaNoteUploadPending, setMediaNoteUploadPending] = useState(false)
  /** Stable auto d-tag when the field is left empty; `{ slug, value }` resets when article subtype changes. */
  const articleDTagFallbackRef = useRef<{ slug: string; value: string } | null>(null)
  const musicTrackDTagFallbackRef = useRef<string | null>(null)

  useEffect(() => {
    if (articleDTag.trim()) {
      articleDTagFallbackRef.current = null
    }
  }, [articleDTag])

  useEffect(() => {
    const isArticle =
      isLongFormArticle || isWikiArticle || isNostrSpecification || isPublicationContent
    if (!isArticle) {
      articleDTagFallbackRef.current = null
    }
  }, [isLongFormArticle, isWikiArticle, isNostrSpecification, isPublicationContent])

  useEffect(() => {
    mediaNoteKindRef.current = mediaNoteKind
  }, [mediaNoteKind])

  const mediaUrlRef = useRef(mediaUrl)
  mediaUrlRef.current = mediaUrl
  const uploadProgressCountRef = useRef(0)
  uploadProgressCountRef.current = uploadProgresses.length

  const enrichAndPatchComposerImeta = useCallback((url: string) => {
    const key = normalizeComposerMediaUrlKey(cleanUrl(url) || url)
    void enrichImetaTagFromMediaUrl(key).then((enriched) => {
      const content = textareaRef.current?.getText() ?? ''
      if (composerContentHasUploadPlaceholder(content)) return
      const stillPresent = extractMediaUrlsFromComposerContent(content).some(
        (u) => normalizeComposerMediaUrlKey(u) === key
      )
      if (!stillPresent) return
      const prev = composerImetaTagsRef.current
      const existing = prev.find((t) => imetaUrlFromTagRow(t) === key)
      if (!existing || JSON.stringify(existing) === JSON.stringify(enriched)) return
      mediaUpload.registerImetaTag(key, enriched)
      const next = prev.map((t) => (imetaUrlFromTagRow(t) === key ? enriched : t))
      composerImetaTagsRef.current = next
      setMediaImetaTags(next)
    })
  }, [])

  const appendComposerImetaTag = useCallback((newTag: string[]) => {
    const urlItem = newTag.find((x) => typeof x === 'string' && x.startsWith('url '))
    const rawUrl = urlItem?.slice(4)?.trim()
    const normalized = rawUrl ? cleanUrl(rawUrl) || rawUrl : ''
    const exists =
      normalized &&
      composerImetaTagsRef.current.some((tag) => {
        const u = tag.find((x) => typeof x === 'string' && x.startsWith('url '))
        if (!u) return false
        const r = u.slice(4).trim()
        return (cleanUrl(r) || r) === normalized
      })
    if (exists) return
    composerImetaTagsRef.current = [...composerImetaTagsRef.current, newTag]
    setMediaImetaTags([...composerImetaTagsRef.current])
  }, [])

  const handlePastedMediaUrl = useCallback(
    (url: string) => {
      const cleaned = cleanUrl(url) || url
      const basic = buildImetaTagFromMediaUrl(cleaned)
      mediaUpload.registerImetaTag(cleaned, basic)
      appendComposerImetaTag(basic)

      if (isMusicTrack) {
        if (isAudio(cleaned)) {
          setMusicTrackAudioUrl(cleaned)
          const ext = cleaned.split(/[?#]/)[0].split('.').pop()
          if (ext && !musicTrackFormat.trim()) {
            setMusicTrackFormat(ext)
          }
        } else if (isImage(cleaned)) {
          setMusicTrackImageUrl(cleaned)
        }
      }

      void enrichAndPatchComposerImeta(cleaned)
    },
    [appendComposerImetaTag, enrichAndPatchComposerImeta, isMusicTrack, musicTrackFormat]
  )

  const composerImetaSyncEnabled = useMemo(
    () =>
      !(
        isMusicTrack ||
        isWebBookmark ||
        isHighlight ||
        isPoll ||
        isLongFormArticle ||
        isWikiArticle ||
        isNostrSpecification ||
        isPublicationContent ||
        isCitationInternal ||
        isCitationExternal ||
        isCitationHardcopy ||
        isCitationPrompt ||
        (isDiscussionThread && !parentEvent)
      ),
    [
      isMusicTrack,
      isWebBookmark,
      isHighlight,
      isPoll,
      isLongFormArticle,
      isWikiArticle,
      isNostrSpecification,
      isPublicationContent,
      isCitationInternal,
      isCitationExternal,
      isCitationHardcopy,
      isCitationPrompt,
      isDiscussionThread,
      parentEvent
    ]
  )

  useEffect(() => {
    if (!composerImetaSyncEnabled) return

    const timer = window.setTimeout(() => {
      if (uploadProgressCountRef.current > 0) return
      const content = textareaRef.current?.getText() ?? text
      if (composerContentHasUploadPlaceholder(content)) return

      const prev = composerImetaTagsRef.current
      const result = reconcileComposerImetaWithContent(content, prev, (url) => {
        const cleaned = cleanUrl(url) || url
        return mediaUpload.getImetaTagByUrl(cleaned) ?? buildImetaTagFromMediaUrl(cleaned)
      })

      if (!composerImetaTagsEqual(prev, result.tags)) {
        for (const url of result.addedUrls) {
          const cleaned = cleanUrl(url) || url
          const tag =
            result.tags.find((t) => imetaUrlFromTagRow(t) === normalizeComposerMediaUrlKey(cleaned)) ??
            buildImetaTagFromMediaUrl(cleaned)
          mediaUpload.registerImetaTag(cleaned, tag)
        }
        composerImetaTagsRef.current = result.tags
        setMediaImetaTags(result.tags)
        for (const url of result.addedUrls) {
          enrichAndPatchComposerImeta(url)
        }
      }

      const mediaKey = mediaUrlRef.current
        ? normalizeComposerMediaUrlKey(cleanUrl(mediaUrlRef.current) || mediaUrlRef.current)
        : ''
      if (mediaKey) {
        const stillInContent = result.tags.some((t) => imetaUrlFromTagRow(t) === mediaKey)
        if (!stillInContent) {
          setMediaUrl('')
          setMediaNoteKind(null)
        }
      }
    }, COMPOSER_IMETA_CONTENT_SYNC_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [text, uploadProgresses.length, composerImetaSyncEnabled, enrichAndPatchComposerImeta])

  const isFirstRender = useRef(true)

  const allAvailableTopics = useMemo(
    () => buildAllAvailableTopics(discussionDynamicTopics),
    [discussionDynamicTopics]
  )

  const threadTopicResolved = useMemo(
    () => (isDiscussionThread ? resolveTopicFromInput(threadTopicInput, allAvailableTopics) : ''),
    [isDiscussionThread, threadTopicInput, allAvailableTopics]
  )

  const discussionPreviewExtraTags = useMemo((): string[][] | undefined => {
    if (!isDiscussionThread) return undefined
    const resolved = resolveTopicFromInput(threadTopicInput, allAvailableTopics)
    if (!resolved) return []
    return collectDiscussionThreadTags({
      processedContent: prefixNostrAddresses(text.trim()),
      topicForTags: resolved,
      title: threadTitle,
      dynamicTopics: discussionDynamicTopics,
      isReadingGroup: threadIsReadingGroup,
      author: threadReadingAuthor,
      subject: threadReadingSubject,
      isNsfw,
      contentWarningLabel
    })
  }, [
    isDiscussionThread,
    threadTopicInput,
    allAvailableTopics,
    text,
    threadTitle,
    discussionDynamicTopics,
    threadIsReadingGroup,
    threadReadingAuthor,
    threadReadingSubject,
    isNsfw,
    contentWarningLabel
  ])

  const handleRelayPublishCapChange = useCallback((preview: TPrePublishRelayCapPreview) => {
    setRelayCapPreview((prev) => {
      if (
        prev &&
        prev.outboxSlotsInPublish === preview.outboxSlotsInPublish &&
        prev.selectedContacted === preview.selectedContacted &&
        prev.selectedTotal === preview.selectedTotal &&
        prev.showCapHint === preview.showCapHint &&
        prev.blocksPublish === preview.blocksPublish
      ) {
        return prev
      }
      return preview
    })
    if (preview.blocksPublish) {
      setRelayCapBlockInfo((prev) => {
        const next = {
          outboxSlotsInPublish: preview.outboxSlotsInPublish,
          selectedContacted: preview.selectedContacted,
          selectedTotal: preview.selectedTotal
        }
        if (
          prev &&
          prev.outboxSlotsInPublish === next.outboxSlotsInPublish &&
          prev.selectedContacted === next.selectedContacted &&
          prev.selectedTotal === next.selectedTotal
        ) {
          return prev
        }
        return next
      })
    } else {
      setRelayCapBlockInfo((prev) => (prev == null ? prev : null))
    }
  }, [])

  useEffect(() => {
    if (isPoll) setRelayCapBlockInfo(null)
  }, [isPoll])

  useEffect(() => {
    if (!isPoll) return
    setPollCreateData((prev) =>
      prev.relays === additionalRelayUrls ? prev : { ...prev, relays: additionalRelayUrls }
    )
  }, [isPoll, additionalRelayUrls])

  // Clear highlight data when initialHighlightData changes or is removed
  useEffect(() => {
    if (initialHighlightData) {
      // Set highlight mode and data when provided
      setIsHighlight(true)
      setHighlightData(initialHighlightData)
    } else {
      // Clear highlight mode and data when not provided
      setIsHighlight(false)
      setHighlightData({
        sourceType: 'nostr',
        sourceValue: ''
      })
    }
  }, [initialHighlightData])

  // Extract mentions from content for public messages
  const extractMentionsFromContent = useCallback(async (content: string) => {
    try {
      // Extract nostr: protocol mentions
      const { pubkeys: nostrPubkeys } = await extractMentions(content, undefined)
      
      // For now, we'll use the nostr mentions
      // In a real implementation, you'd also resolve @ mentions to pubkeys
      setExtractedMentions(nostrPubkeys)
    } catch (error) {
      logger.error('Error extracting mentions', { error })
      setExtractedMentions([])
    }
  }, [])

  useEffect(() => {
    if (!text) {
      if (!initialPublicMessageTo) setExtractedMentions([])
      return
    }

    // Debounce the mention extraction for all posts (not just public messages)
    const timeoutId = setTimeout(() => {
      extractMentionsFromContent(text)
    }, 300)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [text, extractMentionsFromContent, initialPublicMessageTo])

  // Check for private relays availability
  useEffect(() => {
    if (!pubkey) {
      setHasPrivateRelaysAvailable(false)
      return
    }
    
    hasPrivateRelays(pubkey).then(setHasPrivateRelaysAvailable).catch(() => {
      setHasPrivateRelaysAvailable(false)
    })
  }, [pubkey])

  useEffect(() => {
    if (!isDiscussionThread || parentEvent) return
    if (!threadTitle && !text.trim()) return
    const h = setTimeout(() => {
      const tr = resolveTopicFromInput(threadTopicInput, allAvailableTopics)
      postEditorCache.setThreadDraft({
        title: threadTitle,
        content: text,
        topic: tr || threadSelectedTopic
      })
    }, 500)
    return () => clearTimeout(h)
  }, [
    isDiscussionThread,
    parentEvent,
    threadTitle,
    text,
    threadTopicInput,
    threadSelectedTopic,
    allAvailableTopics
  ])

  // Helper function to determine the kind that will be created
  const getDeterminedKind = useMemo((): number => {
    // Public messages always take priority - even with media, they stay as PMs
    if (isPublicMessage) {
      return ExtendedKind.PUBLIC_MESSAGE
    } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
      return ExtendedKind.PUBLIC_MESSAGE
    }
    
    // For voice comments in replies, check mediaNoteKind even if mediaUrl is not set yet (for preview)
    if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
      return ExtendedKind.VOICE_COMMENT
    } else if (isDiscussionThread && !parentEvent) {
      return ExtendedKind.DISCUSSION
    } else if (mediaNoteKind !== null && mediaUrl) {
      return mediaNoteKind
    } else if (isLongFormArticle) {
      return kinds.LongFormArticle
    } else if (isWikiArticle) {
      return ExtendedKind.WIKI_ARTICLE
    } else if (isNostrSpecification) {
      return ExtendedKind.NOSTR_SPECIFICATION
    } else if (isPublicationContent) {
      return ExtendedKind.PUBLICATION_CONTENT
    } else if (isMusicTrack) {
      return ExtendedKind.MUSIC_TRACK
    } else if (isCitationInternal) {
      return ExtendedKind.CITATION_INTERNAL
    } else if (isCitationExternal) {
      return ExtendedKind.CITATION_EXTERNAL
    } else if (isCitationHardcopy) {
      return ExtendedKind.CITATION_HARDCOPY
    } else if (isCitationPrompt) {
      return ExtendedKind.CITATION_PROMPT
    } else if (isWebBookmark) {
      return ExtendedKind.WEB_BOOKMARK
    } else if (isHighlight) {
      return kinds.Highlights
    } else if (isPoll) {
      return ExtendedKind.POLL
    } else if (parentEvent) {
      return resolveReplyDraftKind(parentEvent)
    } else {
      return kinds.ShortTextNote
    }
  }, [
    mediaNoteKind,
    mediaUrl,
    isDiscussionThread,
    isLongFormArticle,
    isWikiArticle,
    isNostrSpecification,
    isPublicationContent,
    isMusicTrack,
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isWebBookmark,
    isHighlight,
    isPublicMessage,
    isPoll,
    parentEvent
  ])

  const composerBlockReasonInput = useMemo(
    () => ({
      canSignEvents,
      posting,
      uploadInProgress: uploadProgresses.length > 0,
      text,
      hasUnsyncedEditorContent: editorHasContent && !text.trim(),
      determinedKind: getDeterminedKind,
      mediaNoteKind,
      mediaUrl,
      relayCapBlockInfo,
      isPoll,
      pollOptionCount: pollCreateData.options.filter((option) => !!option.trim()).length,
      isPublicMessage,
      extractedMentionCount: extractedMentions.length,
      parentEventKind: parentEvent?.kind,
      isHighlight,
      highlightSourceEmpty: !highlightData.sourceValue.trim(),
      isWebBookmark,
      webBookmarkUrlEmpty: !webBookmarkData.url.trim(),
      isCitationInternal,
      citationInternalCTag,
      isCitationExternal,
      citationExternalUrl,
      citationAccessedOn,
      isCitationHardcopy,
      isCitationPrompt,
      citationPromptLlm,
      isMusicTrack,
      musicTrackTitle,
      musicTrackAudioUrl,
      isDiscussionThread,
      hasParentEvent: !!parentEvent,
      threadTitle,
      threadTopicResolved: !!threadTopicResolved,
      threadContentOk:
        (editorHasContent || !!text.trim()) &&
        (text.length <= 5000 || (editorHasContent && text.length === 0)),
      additionalRelayCount: additionalRelayUrls.length,
      threadIsReadingGroup,
      threadReadingAuthor,
      threadReadingSubject
    }),
    [
      canSignEvents,
      posting,
      uploadProgresses.length,
      text,
      editorHasContent,
      getDeterminedKind,
      mediaNoteKind,
      mediaUrl,
      relayCapBlockInfo,
      isPoll,
      pollCreateData.options,
      isPublicMessage,
      extractedMentions.length,
      parentEvent?.kind,
      isHighlight,
      highlightData.sourceValue,
      isWebBookmark,
      webBookmarkData.url,
      isCitationInternal,
      citationInternalCTag,
      isCitationExternal,
      citationExternalUrl,
      citationAccessedOn,
      isCitationHardcopy,
      isCitationPrompt,
      citationPromptLlm,
      isMusicTrack,
      musicTrackTitle,
      musicTrackAudioUrl,
      isDiscussionThread,
      parentEvent,
      threadTitle,
      threadTopicResolved,
      threadIsReadingGroup,
      threadReadingAuthor,
      threadReadingSubject,
      additionalRelayUrls.length
    ]
  )

  const { canPost, blockMessage: composerBlockMessage } = useComposerController(
    composerBlockReasonInput,
    relayCapBlockInfo,
    t
  )

  const { isPageLayout, showInlineAdvancedPanel, showDialogFooter } =
    getComposerModeFlags({
      layoutMode,
      composerMode,
      hasParentEvent: !!parentEvent
    })

  const extendedComposerHeader = hasExtendedComposerHeaderFields({
    isDiscussionThread,
    parentEvent,
    isMusicTrack,
    isLongFormArticle,
    isWikiArticle,
    isNostrSpecification,
    isPublicationContent,
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isHighlight,
    isWebBookmark,
    isPoll,
    isPublicMessage
  })

  const composerHeaderScrollEnabled =
    !isPageLayout && (isSmallScreen || extendedComposerHeader)

  const composerHeaderScrollSize: 'default' | 'tall' =
    isMusicTrack ||
    isLongFormArticle ||
    isWikiArticle ||
    isNostrSpecification ||
    isPublicationContent ||
    isCitationInternal ||
    isCitationExternal ||
    isCitationHardcopy ||
    isCitationPrompt ||
    isDiscussionThread ||
    isHighlight ||
    isPoll
      ? 'tall'
      : 'default'

  const publishLabelForShell = useMemo(() => {
    if (parentEvent) return t('Reply')
    if (isPublicMessage) return t('Send Public Message')
    if (isDiscussionThread && !parentEvent) return t('Create Thread')
    return t('Post')
  }, [parentEvent, isPublicMessage, isDiscussionThread, t])

  const getDeterminedKindRef = useRef(getDeterminedKind)
  getDeterminedKindRef.current = getDeterminedKind

  const advancedLabPersistenceKey = useMemo(
    () =>
      postEditorCache.generateCacheKey({
        kind: getDeterminedKind,
        defaultContent,
        parentEvent
      }),
    [getDeterminedKind, defaultContent, parentEvent]
  )

  const advancedLabHostRef = useRef<PostEditorAdvancedLabHandle | null>(null)
  const advancedLabOpenRef = useRef(false)
  const [advancedLabOpen, setAdvancedLabOpen] = useState(false)
  const [advancedLabHostMounted, setAdvancedLabHostMounted] = useState(false)
  const pendingLabOpenRef = useRef<import('@/lib/advanced-event-lab-slice').AdvancedEventLabSlice | null>(
    null
  )

  const handleAdvancedLabOpenChange = useCallback(
    (next: boolean) => {
      advancedLabOpenRef.current = next
      setAdvancedLabOpen(next)
      onAdvancedLabOpenChange?.(next)
    },
    [onAdvancedLabOpenChange]
  )

  const plainComposerBody = usePlainComposerBody(textareaRef)
  const insertComposerText = enableAdvancedEditor
    ? (txt: string) => advancedLabHostRef.current?.insertComposerText(txt) ?? plainComposerBody.insertComposerText(txt)
    : plainComposerBody.insertComposerText
  const insertComposerEmoji = enableAdvancedEditor
    ? (em: string | import('@/types').TEmoji) =>
        advancedLabHostRef.current?.insertComposerEmoji(em) ?? plainComposerBody.insertComposerEmoji(em)
    : plainComposerBody.insertComposerEmoji
  const appendUploadedUrl = enableAdvancedEditor
    ? (url: string, treatAsImage: boolean) =>
        advancedLabHostRef.current?.appendUploadedUrl(url, treatAsImage) ??
        plainComposerBody.appendUploadedUrl(url, treatAsImage)
    : plainComposerBody.appendUploadedUrl

  const appendUploadedUrlToComposer = (url: string, treatAsImage: boolean) => {
    appendUploadedUrl(url, treatAsImage)
  }

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      const cachedSettings = postEditorCache.getPostSettingsCache({
        kind: getDeterminedKind,
        defaultContent,
        parentEvent
      })
      if (cachedSettings) {
        setIsNsfw(cachedSettings.isNsfw ?? false)
        setContentWarningLabel(cachedSettings.contentWarningLabel?.trim() ?? '')
        setIsPoll(cachedSettings.isPoll ?? false)
        setPollCreateData(
          cachedSettings.pollCreateData ?? {
            isMultipleChoice: false,
            options: ['', ''],
            endsAt: undefined,
            relays: []
          }
        )
        setAddClientTag(cachedSettings.addClientTag ?? storage.getAddClientTag())
      }
      return
    }
    postEditorCache.setPostSettingsCache(
      { kind: getDeterminedKind, defaultContent, parentEvent },
      {
        isNsfw,
        contentWarningLabel,
        isPoll,
        pollCreateData,
        addClientTag
      }
    )
  }, [getDeterminedKind, defaultContent, parentEvent, isNsfw, contentWarningLabel, isPoll, pollCreateData, addClientTag])

  const prevComposerShellOpenRef = useRef(open)
  const prevComposerPubkeyRef = useRef(pubkey)
  useEffect(() => {
    const wasOpen = prevComposerShellOpenRef.current
    prevComposerShellOpenRef.current = open
    if (!wasOpen && open && !advancedLabOpenRef.current) {
      // TipTap mounts async (immediatelyRender: false); retry after the editor exists.
      const sync = () => textareaRef.current?.syncFromPostCache()
      sync()
      const raf = requestAnimationFrame(sync)
      const tmr = window.setTimeout(sync, 0)
      return () => {
        cancelAnimationFrame(raf)
        window.clearTimeout(tmr)
      }
    }
  }, [open, getDeterminedKind, defaultContent, parentEvent])

  useEffect(() => {
    if (!open) {
      prevComposerPubkeyRef.current = pubkey
      return
    }
    const prevPk = prevComposerPubkeyRef.current
    prevComposerPubkeyRef.current = pubkey
    if (prevPk && pubkey && prevPk !== pubkey && !advancedLabOpenRef.current) {
      textareaRef.current?.syncFromPostCache()
    }
  }, [open, pubkey])

  useEffect(() => {
    if (!open) setComposerEditorTab('edit')
  }, [open])

  const rssReplyExtraPreviewTags = useMemo((): string[][] | undefined => {
    if (!parentEvent || parentEvent.kind !== ExtendedKind.RSS_THREAD_ROOT) return undefined
    const raw =
      parentEvent.tags.find((t) => t[0] === 'I')?.[1] ??
      parentEvent.tags.find((t) => t[0] === 'i')?.[1]
    if (!raw) return undefined
    const c = canonicalizeRssArticleUrl(raw)
    return [['i', c], ['I', c]]
  }, [parentEvent])

  const articlePreviewMetadata = useMemo(() => {
    const isArticle =
      isLongFormArticle || isWikiArticle || isNostrSpecification || isPublicationContent
    if (!isArticle) return undefined
    const topics = articleSubject.trim()
      ? articleSubject.split(/[,\s]+/).filter((s) => s.trim())
      : []
    const base = {
      dTag: articleDTag.trim() || undefined,
      title: articleTitle.trim() || undefined,
      summary: articleSummary.trim() || undefined,
      topics: topics.length > 0 ? topics : undefined
    }
    if (isNostrSpecification) {
      const affectedKinds = parseNostrSpecAffectedKinds(nostrSpecAffectedKindRows)
      return {
        ...base,
        affectedKinds: affectedKinds.length > 0 ? affectedKinds : undefined
      }
    }
    return { ...base, image: articleImage.trim() || undefined }
  }, [
    isLongFormArticle,
    isWikiArticle,
    isNostrSpecification,
    isPublicationContent,
    articleDTag,
    articleTitle,
    articleSummary,
    articleImage,
    articleSubject,
    nostrSpecAffectedKindRows
  ])

  const musicTrackPreviewMetadata = useMemo(() => {
    if (!isMusicTrack) return undefined
    const genres = musicTrackGenres.trim()
      ? musicTrackGenres.split(/[,\s]+/).filter((s) => s.trim())
      : []
    const durationRaw = Number.parseInt(musicTrackDuration.trim(), 10)
    return {
      dTag: musicTrackDTag.trim() || undefined,
      title: musicTrackTitle.trim() || undefined,
      audioUrl: musicTrackAudioUrl.trim() || undefined,
      artist: musicTrackArtist.trim() || undefined,
      imageUrl: musicTrackImageUrl.trim() || undefined,
      album: musicTrackAlbum.trim() || undefined,
      durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
      format: musicTrackFormat.trim() || undefined,
      language: musicTrackLanguage.trim() || undefined,
      genres: genres.length > 0 ? genres : undefined
    }
  }, [
    isMusicTrack,
    musicTrackDTag,
    musicTrackTitle,
    musicTrackAudioUrl,
    musicTrackArtist,
    musicTrackImageUrl,
    musicTrackAlbum,
    musicTrackDuration,
    musicTrackFormat,
    musicTrackLanguage,
    musicTrackGenres
  ])

  const mergedExtraPreviewTags = useMemo((): string[][] | undefined => {
    const contextual =
      isDiscussionThread && !parentEvent
        ? discussionPreviewExtraTags ?? []
        : rssReplyExtraPreviewTags ?? []
    return contextual.length ? contextual : undefined
  }, [isDiscussionThread, parentEvent, discussionPreviewExtraTags, rssReplyExtraPreviewTags])

  const labContentWarning = useMemo(
    () => contentWarningDraftOptions(isNsfw, contentWarningLabel),
    [isNsfw, contentWarningLabel]
  )

  // Shared function to create draft event - used by both preview and posting
  const createDraftEvent = useCallback(async (cleanedText: string): Promise<any> => {
    const uploadImetaTagsOpt = mediaImetaTags.length > 0 ? mediaImetaTags : undefined

    // Get expiration settings
    const isChattingKind = (kind: number) => 
      kind === kinds.ShortTextNote || 
      kind === ExtendedKind.COMMENT || 
      kind === ExtendedKind.VOICE || 
      kind === ExtendedKind.VOICE_COMMENT
    
    const addExpirationTag = storage.getDefaultExpirationEnabled()
    const expirationMonths = storage.getDefaultExpirationMonths()
    const contentWarningOpts = contentWarningDraftOptions(isNsfw, contentWarningLabel)

    // Public messages - check BEFORE media notes to ensure PMs with media stay as PMs
    if (isPublicMessage) {
      return await createPublicMessageDraftEvent(cleanedText, extractedMentions, {
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths,
        mediaImetaTags: uploadImetaTagsOpt
      })
    } else if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
      // For PM replies, always create PM even if there's media
      return await createPublicMessageReplyDraftEvent(cleanedText, parentEvent, mentions, {
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths,
        mediaImetaTags: uploadImetaTagsOpt
      })
    }

    if (isDiscussionThread && !parentEvent) {
      const processed = prefixNostrAddresses(cleanedText.trim())
      const topicResolved = resolveTopicFromInput(threadTopicInput, allAvailableTopics) || threadSelectedTopic
      const tags = collectDiscussionThreadTags({
        processedContent: processed,
        topicForTags: topicResolved,
        title: threadTitle,
        dynamicTopics: discussionDynamicTopics,
        isReadingGroup: threadIsReadingGroup,
        author: threadReadingAuthor,
        subject: threadReadingSubject,
        isNsfw,
        contentWarningLabel
      })
      const draft: TDraftEvent = {
        kind: ExtendedKind.DISCUSSION,
        content: processed,
        tags,
        created_at: dayjs().unix()
      }
      mergeUploadImetaTagsInto(draft.tags, uploadImetaTagsOpt)
      return draft
    }

    // Check for voice comments (only for non-PM replies)
    if (parentEvent && mediaNoteKind === ExtendedKind.VOICE_COMMENT) {
      const url = mediaUrl || 'placeholder://audio'
      const voiceImetaRows =
        mediaImetaTags.length > 0 ? [] : [['imeta', `url ${url}`, 'm audio/mpeg']]
      return await createVoiceCommentDraftEvent(
        cleanedText,
        parentEvent,
        url,
        voiceImetaRows,
        mentions,
        {
          addClientTag,
          ...contentWarningOpts,
          addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.VOICE_COMMENT),
          expirationMonths,
          mediaImetaTags: uploadImetaTagsOpt
        }
      )
    }

    // Media notes
    if (mediaNoteKind !== null && mediaUrl) {
      if (mediaNoteKind === ExtendedKind.VOICE) {
        const voiceImetaRows =
          mediaImetaTags.length > 0 ? [] : [['imeta', `url ${mediaUrl}`, 'm audio/mpeg']]
        return await createVoiceDraftEvent(
          cleanedText,
          mediaUrl,
          voiceImetaRows,
          mentions,
          {
            addClientTag,
            ...contentWarningOpts,
            addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.VOICE),
            expirationMonths,
            mediaImetaTags: uploadImetaTagsOpt
          }
        )
      } else if (mediaNoteKind === ExtendedKind.PICTURE) {
        return await createPictureDraftEvent(
          cleanedText,
          mediaImetaTags,
          mentions,
          {
            addClientTag,
            ...contentWarningOpts,
            addExpirationTag: false,
            expirationMonths,
            mediaImetaTags: uploadImetaTagsOpt
          }
        )
      } else if (isNip71StyleVideoKind(mediaNoteKind)) {
        return await createVideoDraftEvent(
          cleanedText,
          mediaImetaTags,
          mentions,
          mediaNoteKind,
          {
            addClientTag,
            ...contentWarningOpts,
            addExpirationTag: false,
            expirationMonths,
            mediaImetaTags: uploadImetaTagsOpt
          }
        )
      }
    }

    // Parse topics from subject field for articles
    const topics = articleSubject.trim()
      ? articleSubject.split(/[,\s]+/).filter(s => s.trim())
      : []

    if (isMusicTrack) {
      const trimmedDTag = musicTrackDTag.trim()
      let effectiveDTag = trimmedDTag
      if (!effectiveDTag) {
        if (!musicTrackDTagFallbackRef.current) {
          musicTrackDTagFallbackRef.current = `music-track-${Math.floor(Date.now() / 1000)}`
        }
        effectiveDTag = musicTrackDTagFallbackRef.current
      } else {
        musicTrackDTagFallbackRef.current = null
      }
      const genres = musicTrackGenres.trim()
        ? musicTrackGenres.split(/[,\s]+/).filter((s) => s.trim())
        : []
      const durationRaw = Number.parseInt(musicTrackDuration.trim(), 10)
      return await createMusicTrackDraftEvent(cleanedText, mentions, {
        dTag: effectiveDTag,
        title: musicTrackTitle.trim(),
        audioUrl: musicTrackAudioUrl.trim(),
        artist: musicTrackArtist.trim() || undefined,
        imageUrl: musicTrackImageUrl.trim() || undefined,
        album: musicTrackAlbum.trim() || undefined,
        durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
        format: musicTrackFormat.trim() || undefined,
        language: musicTrackLanguage.trim() || undefined,
        genres,
        addClientTag,
        ...contentWarningOpts
      })
    }

    // Articles
    const isArticleDraft =
      isLongFormArticle || isWikiArticle || isNostrSpecification || isPublicationContent
    let effectiveArticleDTag = ''
    if (isArticleDraft) {
      const trimmedDTag = articleDTag.trim()
      if (trimmedDTag) {
        effectiveArticleDTag = trimmedDTag
      } else {
        const slug = isLongFormArticle
          ? 'longform-article'
          : isWikiArticle
            ? 'wiki-article'
            : isNostrSpecification
              ? 'nostr-specification'
              : 'publication-content'
        const prev = articleDTagFallbackRef.current
        if (!prev || prev.slug !== slug) {
          articleDTagFallbackRef.current = {
            slug,
            value: `${slug}-${Math.floor(Date.now() / 1000)}`
          }
        }
        effectiveArticleDTag = articleDTagFallbackRef.current!.value
      }
    }

    if (isLongFormArticle) {
      return await createLongFormArticleDraftEvent(cleanedText, mentions, {
        dTag: effectiveArticleDTag,
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths
      })
    } else if (isWikiArticle) {
      return await createWikiArticleDraftEvent(cleanedText, mentions, {
        dTag: effectiveArticleDTag,
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths
      })
    } else if (isNostrSpecification) {
      const affectedKinds = parseNostrSpecAffectedKinds(nostrSpecAffectedKindRows)
      return await createNostrSpecificationDraftEvent(cleanedText, mentions, {
        dTag: effectiveArticleDTag,
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        affectedKinds: affectedKinds.length > 0 ? affectedKinds : undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths
      })
    } else if (isPublicationContent) {
      return await createPublicationContentDraftEvent(cleanedText, mentions, {
        dTag: effectiveArticleDTag,
        title: articleTitle.trim() || undefined,
        summary: articleSummary.trim() || undefined,
        image: articleImage.trim() || undefined,
        topics: topics.length > 0 ? topics : undefined,
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths
      })
    }

    // Citations
    if (isCitationInternal) {
      return createCitationInternalDraftEvent(cleanedText, {
        cTag: citationInternalCTag.trim(),
        relayHint: citationInternalRelayHint.trim() || undefined,
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() || undefined,
        accessedOn: citationAccessedOn.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        summary: citationSummary.trim() || undefined
      })
    } else if (isCitationExternal) {
      return createCitationExternalDraftEvent(cleanedText, {
        url: citationExternalUrl.trim(),
        accessedOn: citationAccessedOn.trim() || new Date().toISOString(),
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() || undefined,
        publishedBy: citationPublishedBy.trim() || undefined,
        version: citationVersion.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        openTimestamp: citationExternalOpenTimestamp.trim() || undefined,
        summary: citationSummary.trim() || undefined
      })
    } else if (isCitationHardcopy) {
      // Convert date strings to ISO 8601 format if they exist
      const formatDateToISO = (dateStr: string): string => {
        if (!dateStr || !dateStr.trim()) return ''
        // If already in ISO format, return as is
        if (dateStr.includes('T')) return dateStr
        // If in YYYY-MM-DD format, convert to ISO
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return new Date(dateStr + 'T00:00:00Z').toISOString()
        }
        return dateStr
      }
      
      const hardcopyOptions = {
        accessedOn: formatDateToISO(citationAccessedOn.trim()) || new Date().toISOString(),
        title: citationTitle.trim() || undefined,
        author: citationAuthor.trim() || undefined,
        pageRange: citationHardcopyPageRange.trim() || undefined,
        chapterTitle: citationHardcopyChapterTitle.trim() || undefined,
        editor: citationHardcopyEditor.trim() || undefined,
        publishedOn: citationPublishedOn.trim() ? formatDateToISO(citationPublishedOn.trim()) : undefined,
        publishedBy: citationPublishedBy.trim() || undefined,
        publishedIn: citationHardcopyPublishedIn.trim() || undefined,
        volume: citationHardcopyVolume.trim() || undefined,
        doi: citationHardcopyDoi.trim() || undefined,
        version: citationVersion.trim() || undefined,
        location: citationLocation.trim() || undefined,
        geohash: citationGeohash.trim() || undefined,
        summary: citationSummary.trim() || undefined
      }
      
      return createCitationHardcopyDraftEvent(cleanedText, hardcopyOptions)
    } else if (isCitationPrompt) {
      return createCitationPromptDraftEvent(cleanedText, {
        llm: citationPromptLlm.trim(),
        accessedOn: citationAccessedOn.trim() || new Date().toISOString(),
        version: citationVersion.trim() || undefined,
        summary: citationSummary.trim() || undefined,
        url: citationExternalUrl.trim() || undefined
      })
    }

    // Web bookmarks (NIP-B0)
    if (isWebBookmark) {
      return createWebBookmarkDraftEvent({
        url: webBookmarkData.url,
        title: webBookmarkData.title || undefined,
        note: cleanedText.trim() || undefined
      })
    }

    // Highlights
    if (isHighlight) {
      return await createHighlightDraftEvent(
        cleanedText,
        highlightData.sourceType,
        highlightData.sourceValue,
        highlightData.context,
        undefined,
        {
          addClientTag,
          ...contentWarningOpts,
          addExpirationTag: false,
          expirationMonths,
          mediaImetaTags: uploadImetaTagsOpt
        }
      )
    }


    if (parentEvent) {
      const replyKind = resolveReplyDraftKind(parentEvent)
      if (replyKind === kinds.ShortTextNote) {
        return await createShortTextNoteDraftEvent(cleanedText, mentions, {
          parentEvent,
          addClientTag,
          ...contentWarningOpts,
          addExpirationTag: addExpirationTag && isChattingKind(kinds.ShortTextNote),
          expirationMonths,
          mediaImetaTags: uploadImetaTagsOpt
        })
      }

      const replyRelays = Array.from(
        new Set([...relayHintsFromEventTags(parentEvent), ...additionalRelayUrls])
      )
      const shortNoteEdit = await shortNoteEditsService.resolveLatestEditForReplyParent(
        parentEvent,
        replyRelays
      )
      return await createCommentDraftEvent(cleanedText, parentEvent, mentions, {
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: addExpirationTag && isChattingKind(ExtendedKind.COMMENT),
        expirationMonths,
        mediaImetaTags: uploadImetaTagsOpt,
        shortNoteEdit
      })
    }

    // Polls
    if (isPoll) {
      return await createPollDraftEvent(pubkey!, cleanedText, mentions, pollCreateData, {
        addClientTag,
        ...contentWarningOpts,
        addExpirationTag: false,
        expirationMonths,
        mediaImetaTags: uploadImetaTagsOpt
      })
    }

    // Default: Short text note (kind 1), with optional NIP-94 imeta from uploads while still in "short note" mode
    return await createShortTextNoteDraftEvent(cleanedText, mentions, {
      parentEvent,
      addClientTag,
      ...contentWarningOpts,
      addExpirationTag: addExpirationTag && isChattingKind(kinds.ShortTextNote),
      expirationMonths,
      mediaImetaTags: uploadImetaTagsOpt
    })
  }, [
    parentEvent,
    additionalRelayUrls,
    mediaNoteKind,
    mediaUrl,
    mediaImetaTags,
    mentions,
    isDiscussionThread,
    threadTopicInput,
    allAvailableTopics,
    threadSelectedTopic,
    threadTitle,
    discussionDynamicTopics,
    threadIsReadingGroup,
    threadReadingAuthor,
    threadReadingSubject,
    isLongFormArticle,
    isWikiArticle,
    isNostrSpecification,
    isPublicationContent,
    isMusicTrack,
    musicTrackDTag,
    musicTrackTitle,
    musicTrackArtist,
    musicTrackAudioUrl,
    musicTrackImageUrl,
    musicTrackAlbum,
    musicTrackDuration,
    musicTrackFormat,
    musicTrackLanguage,
    musicTrackGenres,
    isCitationInternal,
    isCitationExternal,
    isCitationHardcopy,
    isCitationPrompt,
    isWebBookmark,
    webBookmarkData,
    isHighlight,
    highlightData,
    isPublicMessage,
    extractedMentions,
    isPoll,
    pollCreateData,
    addClientTag,
    isNsfw,
    contentWarningLabel,
    articleDTag,
    articleTitle,
    articleImage,
    articleSubject,
    nostrSpecAffectedKindRows,
    articleSummary,
    pubkey,
    t
  ])

  const applyPersistedLabTagsToDraft = useCallback(
    (draft: TDraftEvent, labKey: string): TDraftEvent => {
      const saved = postEditorCache.getAdvancedLabDraft(labKey)
      if (!saved || saved.kind !== draft.kind) return draft
      const tags = saved.tags.map((r) => [...r])
      mergeUploadImetaTagsInto(tags, collectUploadImetaTagsForContentUrls(draft.content))
      return { ...draft, tags }
    },
    []
  )

  const finalizeDraftEvent = useCallback(
    async (cleanedText: string): Promise<TDraftEvent> => {
      let draft = await createDraftEvent(cleanedText)
      draft = applyPersistedLabTagsToDraft(draft, advancedLabPersistenceKey)
      return draft
    },
    [createDraftEvent, applyPersistedLabTagsToDraft, advancedLabPersistenceKey]
  )

  const handleOpenAdvancedLab = useCallback(() => {
    void checkLogin(async () => {
      if (!pubkey) {
        toast.error(t('Log in to publish'))
        return
      }
      try {
        const body = textareaRef.current?.getText() ?? text
        const cleanedText = rewritePlainTextHttpUrls(body)
        const d = await finalizeDraftEvent(cleanedText)
        const slice = {
          kind: d.kind,
          content: d.content,
          tags: d.tags ?? []
        }
        pendingLabOpenRef.current = slice
        setAdvancedLabHostMounted(true)
        for (let i = 0; i < 120; i++) {
          if (advancedLabPortalRef?.current ?? advancedLabPortalContainer) break
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        }
        if (!advancedLabPortalRef?.current && !advancedLabPortalContainer) return
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      }
    })
  }, [
    checkLogin,
    pubkey,
    text,
    finalizeDraftEvent,
    advancedLabPortalContainer,
    advancedLabPortalRef,
    t
  ])

  useEffect(() => {
    const slice = pendingLabOpenRef.current
    if (!advancedLabHostMounted || !slice) return
    let cancelled = false
    const tryOpen = () => {
      if (cancelled) return
      if (advancedLabHostRef.current) {
        pendingLabOpenRef.current = null
        advancedLabHostRef.current.openLab(slice)
        return
      }
      requestAnimationFrame(tryOpen)
    }
    tryOpen()
    return () => {
      cancelled = true
    }
  }, [advancedLabHostMounted])

  const post = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    checkLogin(async () => {
      if (!canSignEvents) {
        toast.error(t('readOnlySession.cannotPublish'))
        return
      }
      if (!canPost) {
        logger.warn('Attempted to post while canPost is false')
        return
      }
      if (!canPublishWithContent(getDeterminedKind, text)) {
        return
      }

      if (isDiscussionThread && !parentEvent) {
        const newErrors: typeof threadErrors = {}
        const topicResolved = resolveTopicFromInput(threadTopicInput, allAvailableTopics)
        if (!threadTitle.trim()) {
          newErrors.title = t('Title is required')
        } else if (threadTitle.length > 100) {
          newErrors.title = t('Title must be 100 characters or less')
        }
        if (!topicResolved) {
          newErrors.topic = t('Topic is required')
        }
        if (!text.trim()) {
          newErrors.content = t('Content is required')
        } else if (text.length > 5000) {
          newErrors.content = t('Content must be 5000 characters or less')
        }
        if (additionalRelayUrls.length === 0) {
          newErrors.relay = t('Please select at least one relay')
        }
        if (threadIsReadingGroup) {
          if (!threadReadingAuthor.trim()) {
            newErrors.author = t('Author is required for reading groups')
          }
          if (!threadReadingSubject.trim()) {
            newErrors.subject = t('Subject (book title) is required for reading groups')
          }
        }
        setThreadErrors(newErrors)
        if (Object.keys(newErrors).length > 0) {
          return
        }
      }

      // console.log('🚀 Starting post process:', {
      //   isPublicMessage,
      //   parentEventKind: parentEvent?.kind,
      //   parentEventId: parentEvent?.id,
      //   text: text.substring(0, 50) + '...',
      //   mentions: mentions.length,
      //   canPost
      // })

      setPosting(true)
      const publishTrace = startPublishTrace(parentEvent ? 'reply' : 'post')
      let newEvent: any = null
      let draftEvent: any = null

      // Allow "Publishing…" (and other posting UI) to paint before draft build + network work.
      await yieldForPaintBeforeHeavyWork()
      publishTrace.step('UI painted')

      try {
        // Clean tracking parameters from URLs in the post content
        const cleanedText = rewritePlainTextHttpUrls(text)
        
        // Determine relay URLs for private events
        let privateRelayUrls: string[] = []
        const isPrivateEvent = isPublicationContent || isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt
        if (isPrivateEvent) {
          // Use all private relays (outbox + cache)
          privateRelayUrls = await getPrivateRelayUrls(pubkey!)
        }

        // Create draft event using shared function
        draftEvent = await finalizeDraftEvent(cleanedText)
        publishTrace.step('draft built', {
          kind: draftEvent.kind,
          contentChars: (draftEvent.content ?? '').length,
          tagCount: draftEvent.tags?.length ?? 0
        })

        const publishSuccessMessage = parentEvent
          ? t('Reply published')
          : isDiscussionThread && !parentEvent
            ? t('Thread published')
            : t('Post published')

        // console.log('Publishing draft event:', draftEvent)
        // For private events, only publish to private relays
        const relayUrls = isPrivateEvent && privateRelayUrls.length > 0 
          ? privateRelayUrls 
          : (additionalRelayUrls.length > 0 ? additionalRelayUrls : undefined)
        
        newEvent = await publish(draftEvent, {
          specifiedRelayUrls: relayUrls,
          additionalRelayUrls: isPoll ? pollCreateData.relays : (isPrivateEvent ? privateRelayUrls : additionalRelayUrls),
          minPow,
          disableFallbacks:
            additionalRelayUrls.length > 0 ||
            isPrivateEvent ||
            isPublicMessage ||
            parentEvent?.kind === ExtendedKind.PUBLIC_MESSAGE,
          addClientTag,
          publishTrace
        })
        publishTrace.step('publish() returned', {
          eventId: newEvent?.id?.slice(0, 12),
          relayStatusCount: (newEvent as { relayStatuses?: unknown[] })?.relayStatuses?.length
        })
        // console.log('Published event:', newEvent)

        // Full success - close the composer first so relay toasts / thread merge cannot leave it stuck open
        discardPublishedDraft()
        if (isDiscussionThread && !parentEvent) {
          discussionFeedCache.clearDiscussionsListCache()
        }
        deleteDraftEventCache(draftEvent)
        const relayStatuses = (newEvent as any).relayStatuses as TRelayPublishStatus[] | undefined
        const cleanEvent = { ...newEvent }
        delete (cleanEvent as any).relayStatuses

        if (parentEvent) {
          mergePublishedReplyIntoThread(cleanEvent, relayStatuses)
        } else {
          client.addEventToCache(cleanEvent)
          if (openFrom?.length) {
            for (const relayUrl of openFrom) {
              window.dispatchEvent(
                new CustomEvent('relay-refresh-needed', { detail: { relayUrl } })
              )
            }
          }
        }

        onPublishSuccess?.()
        close()

        if ((newEvent as any).relayStatuses) {
          showPublishingFeedback(
            {
              success: true,
              relayStatuses: (newEvent as any).relayStatuses,
              successCount: (newEvent as any).relayStatuses.filter((s: any) => s.success).length,
              totalCount: (newEvent as any).relayStatuses.length
            },
            {
              message: publishSuccessMessage,
              duration: 6000
            }
          )
        } else {
          showSimplePublishSuccess(publishSuccessMessage)
        }
      } catch (error) {
        publishTrace.step('publish failed', {
          error: error instanceof Error ? error.message : String(error)
        })
        if (error instanceof LoginRequiredError) {
          toast.error(t('readOnlySession.cannotPublish'))
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        if (
          message === t('Cancelled') ||
          message.includes('Signer pubkey does not match') ||
          message.includes(t('nip07.publishExtensionMismatch'))
        ) {
          toast.error(t('nip07.publishExtensionMismatch'))
          return
        }
        // AggregateError = "Failed to publish to any relay" is already logged in NostrProvider with relayStatuses; avoid duplicate noise
        if (!(error instanceof AggregateError && error.message === 'Failed to publish to any relay')) {
          logger.error('Publishing error', { error })
          logger.error('Publishing error details', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          })
        }

        // Check if we have relay statuses to display (even if publishing failed)
        if (error instanceof AggregateError && (error as any).relayStatuses) {
          const relayStatuses = (error as any).relayStatuses
          const successCount = relayStatuses.filter((s: any) => s.success).length
          const totalCount = relayStatuses.length
          
          // Handle partial success: show reply immediately (event already emitted by NostrProvider)
          if (successCount > 0) {
            const partialEvent = (error as any).event ?? newEvent
            if (parentEvent && partialEvent) {
              const clean = { ...partialEvent }
              delete (clean as any).relayStatuses
              mergePublishedReplyIntoThread(clean, (error as any).relayStatuses)
            } else if (partialEvent) {
              const clean = { ...partialEvent }
              delete (clean as any).relayStatuses
              client.addEventToCache(clean)
              if (openFrom?.length) {
                for (const relayUrl of openFrom) {
                  window.dispatchEvent(
                    new CustomEvent('relay-refresh-needed', { detail: { relayUrl } })
                  )
                }
              }
            }
            discardPublishedDraft()
            if (isDiscussionThread && !parentEvent) {
              discussionFeedCache.clearDiscussionsListCache()
            }
            if (draftEvent) deleteDraftEventCache(draftEvent)
            onPublishSuccess?.()
            close()

            showPublishingFeedback(
              {
                success: true,
                relayStatuses,
                successCount,
                totalCount
              },
              {
                message: parentEvent
                  ? t('Reply published to some relays')
                  : t('Post published to some relays'),
                duration: 6000
              }
            )
          } else {
            showPublishingFeedback(
              {
                success: false,
                relayStatuses,
                successCount,
                totalCount
              },
              {
                message: parentEvent ? t('Failed to publish reply') : t('Failed to publish post'),
                duration: 6000
              }
            )
          }
        } else {
          // Use standard publishing error feedback for cases without relay statuses
          if (error instanceof AggregateError) {
            const errorMessages = error.errors.map((err: any) => err.message).join('; ')
            showPublishingError(`Failed to publish to relays: ${errorMessages}`)
          } else if (error instanceof Error) {
            showPublishingError(error.message)
          } else {
            showPublishingError('Failed to publish')
          }
          // Don't close form on complete failure - let user try again
        }
      } finally {
        publishTrace.end({ posted: Boolean(newEvent?.id) })
        setPosting(false)
      }
    })
  }

  const postRef = useRef(post)
  postRef.current = post

  useEffect(() => {
    if (!onPublishRequestRef) return
    const ref = onPublishRequestRef as React.MutableRefObject<(() => void) | null>
    ref.current = () => {
      void postRef.current()
    }
    return () => {
      ref.current = null
    }
  }, [onPublishRequestRef])

  const [pageFooterSlot, setPageFooterSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!isPageLayout || !open) {
      setPageFooterSlot(null)
      return
    }
    const sync = () => setPageFooterSlot(document.getElementById('composer-page-footer-slot'))
    sync()
    const t = window.setTimeout(sync, 0)
    return () => window.clearTimeout(t)
  }, [isPageLayout, open])

  const handlePollToggle = () => {
    if (parentEvent) return

    setIsPoll((prev) => !prev)
    if (!isPoll) {
      // When enabling poll mode, clear other modes
      setIsPublicMessage(false)
      setIsHighlight(false)
      setIsWebBookmark(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsMusicTrack(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setIsDiscussionThread(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
    }
  }

  const handlePublicMessageToggle = () => {
    if (parentEvent) return

    setIsPublicMessage((prev) => !prev)
    if (!isPublicMessage) {
      // When enabling public message mode, clear other modes
      setIsPoll(false)
      setIsHighlight(false)
      setIsWebBookmark(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsMusicTrack(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setIsDiscussionThread(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
    }
  }

  const clearMediaNoteUploadIntent = useCallback(() => {
    mediaNoteUploaderIntentRef.current = false
    setMediaNoteUploadPending(false)
  }, [])

  /** Wipe persisted + in-memory draft after a successful publish (before close). */
  const discardPublishedDraft = useCallback(() => {
    textareaRef.current?.cancelPendingEditorSync()
    textareaRef.current?.clear({ skipCache: true })
    postEditorCache.clearPostCache(
      { kind: getDeterminedKind, defaultContent, parentEvent },
      { flush: true }
    )
    if (isDiscussionThread && !parentEvent) {
      postEditorCache.clearPostCache(discussionThreadDraftKindParams(), { flush: true })
      postEditorCache.clearThreadDraft()
    }
    postEditorCache.clearAdvancedLabDraft(advancedLabPersistenceKey)
    postEditorCache.flushPersist()
    setText('')
    setEditorHasContent(false)
    setMediaNoteKind(null)
    setMediaUrl('')
    clearMediaNoteUploadIntent()
    setMediaImetaTags([])
    composerImetaTagsRef.current = []
    uploadedMediaFileMap.current.clear()
    setUploadProgresses([])
    setMentions([])
    setExtractedMentions([])
  }, [
    getDeterminedKind,
    defaultContent,
    parentEvent,
    isDiscussionThread,
    advancedLabPersistenceKey,
    clearMediaNoteUploadIntent
  ])

  const isMediaNoteComposerMode = mediaNoteKind !== null || mediaNoteUploadPending

  const clearNonMediaNoteComposerModes = () => {
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsWebBookmark(false)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsNostrSpecification(false)
    setIsPublicationContent(false)
    setIsMusicTrack(false)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsDiscussionThread(false)
  }

  const beginMediaNoteUpload = () => {
    if (parentEvent) return
    clearNonMediaNoteComposerModes()
    clearMediaNoteUploadIntent()
    setMediaNoteUploadPending(true)
    mediaNoteUploaderIntentRef.current = true
    mediaUploaderBtnRef.current?.click()
  }

  const handlePlainNoteMode = () => {
    if (parentEvent) return
    clearNonMediaNoteComposerModes()
    clearMediaNoteUploadIntent()
    // Short note (kind 1) still supports NIP-94 imeta; only Clear should drop uploads/tags.
    setMediaNoteKind(null)
  }

  const inferKindFromEditorMediaUrl = (url: string): number | null => inferMediaKindFromUrl(url)

  const mimeFromUrlPathForKind = (url: string, kind: number): string =>
    mimeFromMediaUrl(url, kind) ?? 'video/mp4'

  const textLooksLikeImetaWithUrl = (s: string): boolean =>
    /\bimeta\b[\s\S]{0,400}?\burl\s+https?:\/\//i.test(s)

  const firstHttpUrlInNoteText = (s: string): string | undefined => {
    const m = s.match(/https?:\/\/[^\s<>\])}'"]+/)
    return m?.[0]
  }

  const canUseMediaKindFromUrlButton = useMemo(() => {
    if (parentEvent || isDiscussionThread || isPublicMessage || isMusicTrack) return false
    if (mediaNoteKind !== null && mediaUrl) return false
    if (mediaImetaTags.length > 0) return true
    if (mediaUrl) return true
    if (textLooksLikeImetaWithUrl(text)) return true
    const u = firstHttpUrlInNoteText(text)
    return !!(u && inferKindFromEditorMediaUrl(u) !== null)
  }, [
    parentEvent,
    isDiscussionThread,
    isPublicMessage,
    isMusicTrack,
    mediaNoteKind,
    mediaUrl,
    mediaImetaTags,
    text
  ])

  /** When the editor already contains a media URL (e.g. after drop/paste) but kind stayed 1. */
  const handleUseMediaNoteKindFromUrl = () => {
    if (parentEvent || isDiscussionThread || isPublicMessage || isMusicTrack) return
    if (mediaNoteKind !== null && mediaUrl) {
      toast.info(t('Already publishing as a media note'))
      return
    }
    const raw = textareaRef.current?.getText() ?? text
    const m = raw.match(/https?:\/\/[^\s<>\])}'"]+/)
    const found = m?.[0]
    if (!found) {
      toast.info(t('No media URL in note — upload or paste a link first'))
      return
    }
    const kind = inferKindFromEditorMediaUrl(found)
    if (kind === null) {
      toast.info(t('Cannot infer media type from URL — use Note type → Media Note to upload'))
      return
    }
    setIsPoll(false)
    setIsHighlight(false)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsNostrSpecification(false)
    setIsPublicationContent(false)
    setIsMusicTrack(false)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsDiscussionThread(false)
    setMediaUrl(found)
    setMediaNoteKind(kind)
    const mime = mimeFromUrlPathForKind(found, kind)
    const synth: string[] = ['imeta', `url ${found}`, `m ${mime}`]
    const foundNorm = cleanUrl(found) || found
    setMediaImetaTags((prev) => {
      const has = prev.some((tag) => {
        const u = tag.find((x) => typeof x === 'string' && x.startsWith('url '))
        if (!u) return false
        const r = u.slice(4).trim()
        return (cleanUrl(r) || r) === foundNorm
      })
      const next = has ? prev : [...prev, synth]
      composerImetaTagsRef.current = next
      return next
    })
  }

  const isPlainShortNoteToolbar = useMemo(
    () =>
      !parentEvent &&
      !isPoll &&
      !isPublicMessage &&
      !isHighlight &&
      !isWebBookmark &&
      !isLongFormArticle &&
      !isWikiArticle &&
      !isNostrSpecification &&
      !isPublicationContent &&
      !isMusicTrack &&
      !isCitationInternal &&
      !isCitationExternal &&
      !isCitationHardcopy &&
      !isCitationPrompt &&
      !isDiscussionThread &&
      !isMediaNoteComposerMode,
    [
      parentEvent,
      isPoll,
      isPublicMessage,
      isHighlight,
      isWebBookmark,
      isLongFormArticle,
      isWikiArticle,
      isNostrSpecification,
      isPublicationContent,
      isMusicTrack,
      isCitationInternal,
      isCitationExternal,
      isCitationHardcopy,
      isCitationPrompt,
      isDiscussionThread,
      isMediaNoteComposerMode
    ]
  )

  const showComposerAudioUpload = useMemo(
    () => {
      if (parentEvent || isPublicMessage) return true
      return !(
        isPoll ||
        isHighlight ||
        isWebBookmark ||
        isLongFormArticle ||
        isWikiArticle ||
        isNostrSpecification ||
        isPublicationContent ||
        isMusicTrack ||
        isCitationInternal ||
        isCitationExternal ||
        isCitationHardcopy ||
        isCitationPrompt ||
        isDiscussionThread
      )
    },
    [
      parentEvent,
      isPublicMessage,
      isPoll,
      isHighlight,
      isWebBookmark,
      isLongFormArticle,
      isWikiArticle,
      isNostrSpecification,
      isPublicationContent,
      isMusicTrack,
      isCitationInternal,
      isCitationExternal,
      isCitationHardcopy,
      isCitationPrompt,
      isDiscussionThread
    ]
  )

  const handleMusicTrackToggle = () => {
    if (parentEvent) return
    setIsMusicTrack((prev) => !prev)
    if (!isMusicTrack) {
      setIsPoll(false)
      setIsPublicMessage(false)
      setIsHighlight(false)
      setIsWebBookmark(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setIsDiscussionThread(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
      musicTrackDTagFallbackRef.current = null
    }
  }

  const handleHighlightToggle = () => {
    if (parentEvent) return

    setIsHighlight((prev) => !prev)
    if (!isHighlight) {
      // When enabling highlight mode, clear other modes and set client tag to true
      setIsPoll(false)
      setIsPublicMessage(false)
      setIsWebBookmark(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsMusicTrack(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setIsDiscussionThread(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
      setAddClientTag(true)
    }
  }

  const handleWebBookmarkToggle = () => {
    if (parentEvent) return
    setIsWebBookmark((prev) => !prev)
    if (!isWebBookmark) {
      setIsPoll(false)
      setIsPublicMessage(false)
      setIsHighlight(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsMusicTrack(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setIsDiscussionThread(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
      setAddClientTag(true)
    }
  }

  const handleDiscussionThreadToggle = () => {
    if (parentEvent) return
    if (!isDiscussionThread) {
      setIsPoll(false)
      setIsPublicMessage(false)
      setIsHighlight(false)
      setIsWebBookmark(false)
      setIsLongFormArticle(false)
      setIsWikiArticle(false)
      setIsNostrSpecification(false)
      setIsPublicationContent(false)
      setIsMusicTrack(false)
      setIsCitationInternal(false)
      setIsCitationExternal(false)
      setIsCitationHardcopy(false)
      setIsCitationPrompt(false)
      setMediaNoteKind(null)
      setMediaUrl('')
      setMediaImetaTags([])
      composerImetaTagsRef.current = []
      const draft = postEditorCache.getThreadDraft()
      if (draft) {
        setThreadTitle(draft.title)
        setText(draft.content)
        setThreadSelectedTopic(draft.topic)
        const predefined = DISCUSSION_TOPICS.find((x) => x.id === draft.topic)
        const dyn = discussionDynamicTopics?.allTopics.find((x) => x.id === draft.topic)
        setThreadTopicInput(predefined?.label ?? dyn?.label ?? draft.topic)
      } else {
        setThreadTitle('')
        setThreadSelectedTopic('general')
        const row = DISCUSSION_TOPICS.find((x) => x.id === 'general')
        setThreadTopicInput(row?.label ?? 'general')
      }
      setThreadErrors({})
      setIsDiscussionThread(true)
    } else {
      setIsDiscussionThread(false)
      setThreadErrors({})
    }
  }

  const handleUploadCompressPhase = useCallback((file: File, phase: 'compressing' | 'uploading') => {
    setUploadProgresses((prev) =>
      prev.map((row) =>
        row.file === file
          ? { ...row, phase, progress: phase === 'uploading' ? 0 : row.progress }
          : row
      )
    )
  }, [])

  const handleUploadCompressProgress = useCallback((file: File, percent: number) => {
    const p = Math.max(0, Math.min(100, Math.round(percent)))
    setUploadProgresses((prev) =>
      prev.map((row) =>
        row.file === file && row.phase === 'compressing' ? { ...row, progress: p } : row
      )
    )
  }, [])

  const handleUploadStart = (file: File, cancel: () => void) => {
    setUploadProgresses((prev) => [
      ...prev,
      {
        file,
        progress: 0,
        cancel,
        phase: fileLooksLikeUploadableMedia(file) ? 'compressing' : 'uploading'
      }
    ])
    // Track file for media upload
    if (fileLooksLikeUploadableMedia(file)) {
      const mapKey = `${file.name}-${file.size}-${file.lastModified}`
      uploadedMediaFileMap.current.set(mapKey, file)
      
      // For replies and PMs, if it's an audio file, set mediaNoteKind immediately for preview
      if (parentEvent || isPublicMessage) {
        const fileType = file.type
        const fileName = file.name.toLowerCase()
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|mka|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // For replies/PMs, webm/ogg/mp3/m4a files should be treated as audio since the microphone button only accepts audio/*
        // Even if the MIME type is incorrect, if it came through the audio uploader, it's audio
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        
        // For replies/PMs, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        if (isAudio) {
          // For PM replies, don't set mediaNoteKind - let PM reply handle it with imeta tags
          if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
            // Don't set mediaNoteKind - PM replies stay as kind 24 with imeta tags
          } else if (parentEvent) {
            setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
          } else if (isPublicMessage) {
            setMediaNoteKind(ExtendedKind.VOICE)
          }
          // Note: URL will be inserted when upload completes in handleMediaUploadSuccess
        }
      }
      // Root composer: video/voice kinds are set in processMediaUpload; images stay kind 1 with imeta (ambiguous types use the dialog).
    }
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) =>
        item.file === file ? { ...item, progress } : item
      )
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
    micAudioUploadIntentRef.current = false
    // Keep file in map until upload success is called
  }

  const handleMicUploadStart = useCallback(
    (file: File) => {
      if (!showComposerAudioUpload || parentEvent || isPublicMessage) return
      if (!fileLooksLikeMicAudioUpload(file)) return
      micAudioUploadIntentRef.current = true
      setMediaNoteKind(ExtendedKind.VOICE)
      mediaNoteKindRef.current = ExtendedKind.VOICE
    },
    [showComposerAudioUpload, parentEvent, isPublicMessage]
  )

  // Helper function to check if a file could be either audio or video
  const isAmbiguousMediaFile = (file: File): boolean => {
    if (parentEvent) {
      // For replies, we don't show the dialog - audio button only accepts audio/*
      return false
    }
    
    const fileType = file.type
    const fileName = file.name.toLowerCase()
    
    // Check if it's a webm or mp4 file that could be either audio or video
    const isWebm = /\.webm$/i.test(fileName)
    const isMp4 = /\.mp4$/i.test(fileName)
    
    if (isWebm || isMp4) {
      // If MIME type is missing, it's ambiguous
      if (!fileType || fileType === 'application/octet-stream') {
        return true
      }
      
      const isAudioMime = fileType.startsWith('audio/')
      const isVideoMime = fileType.startsWith('video/')
      
      // If MIME type doesn't clearly indicate one or the other, it's ambiguous
      // Some browsers report video/webm for audio-only webm files, so we show the dialog
      // to let the user choose
      if (isWebm) {
        // WebM files are often misreported, so show dialog
        return true
      }
      
      if (isMp4) {
        // MP4 files can be audio or video - if MIME type is video/mp4 but could be audio,
        // or if it's unclear, show dialog
        // Only show if MIME type suggests it could be either
        if (!isAudioMime && !isVideoMime) {
          return true
        }
        // If it's video/mp4, it could still be audio-only, so show dialog
        if (isVideoMime) {
          return true
        }
      }
    }
    
    return false
  }

  const handleMediaKindSelection = (selectedKind: number) => {
    if (!pendingMediaUpload) return
    
    const { url, tags, file, urlAlreadyInEditor } = pendingMediaUpload
    setShowMediaKindDialog(false)
    setPendingMediaUpload(null)
    
    // Process the upload with the selected kind
    processMediaUpload(url, tags, file, selectedKind, {
      skipComposerUrlAppend: urlAlreadyInEditor === true
    })
  }

  const processMediaUpload = async (
    url: string,
    tags: string[][],
    uploadingFile: File,
    selectedKind?: number,
    opts?: { skipComposerUrlAppend?: boolean }
  ) => {
    const fromMediaNoteMenu = mediaNoteUploaderIntentRef.current
    try {
      let resolvedKind: number
      if (selectedKind !== undefined) {
        resolvedKind = selectedKind
      } else {
        resolvedKind = await getMediaKindFromFile(uploadingFile, false)
      }

      // Toolbar/drop: images stay kind 1 (short text + imeta). Media Note menu: use NIP-94 media kinds (20/21/22/1222).
      if (fromMediaNoteMenu) {
        setMediaNoteKind(resolvedKind)
        setMediaUrl(url)
      } else if (resolvedKind === ExtendedKind.PICTURE) {
        setMediaNoteKind(null)
        setMediaUrl('')
      } else {
        setMediaNoteKind(resolvedKind)
        setMediaUrl(url)
      }

      const imetaTag = mediaUpload.getImetaTagByUrl(url)
      let newImetaTag: string[]
      if (imetaTag) {
        newImetaTag = imetaTag
      } else if (tags && tags.length > 0) {
        newImetaTag = nip94PairsToImetaTag(tags)
      } else {
        newImetaTag = ['imeta', `url ${url}`]
        let mimeType = uploadingFile.type
        const kindHint = selectedKind ?? resolvedKind
        if (kindHint === ExtendedKind.VOICE || kindHint === ExtendedKind.VOICE_COMMENT) {
          const fileName = uploadingFile.name.toLowerCase()
          if (/\.webm$/i.test(fileName)) {
            mimeType = 'audio/webm'
          } else if (/\.mka$/i.test(fileName)) {
            mimeType = 'audio/x-matroska'
          } else if (/\.mp4$/i.test(fileName)) {
            mimeType = 'audio/mp4'
          }
        } else if (isNip71StyleVideoKind(kindHint)) {
          const fileName = uploadingFile.name.toLowerCase()
          if (/\.webm$/i.test(fileName)) {
            mimeType = 'video/webm'
          } else if (/\.mkv$/i.test(fileName)) {
            mimeType = 'video/x-matroska'
          } else if (/\.mp4$/i.test(fileName)) {
            mimeType = 'video/mp4'
          }
        }
        if (mimeType) {
          newImetaTag.push(`m ${mimeType}`)
        }
      }

      appendComposerImetaTag(newImetaTag)

      if (!opts?.skipComposerUrlAppend) {
        const treatAsImage =
          resolvedKind === ExtendedKind.PICTURE ||
          (uploadingFile.type?.startsWith('image/') ?? false) ||
          imageUrlLooksLikeHttpImage(url)
        setTimeout(() => {
          appendUploadedUrlToComposer(url, treatAsImage)
        }, 100)
      }
    } catch (error) {
      logger.error('Error processing media upload', { error, file: uploadingFile.name })
      const imetaTag = mediaUpload.getImetaTagByUrl(url)
      const tagToAdd =
        imetaTag ??
        (() => {
          const basic: string[] = ['imeta', `url ${url}`]
          if (uploadingFile.type) basic.push(`m ${uploadingFile.type}`)
          return basic
        })()
      appendComposerImetaTag(tagToAdd)
      if (mediaNoteKindRef.current !== null) {
        setMediaUrl((prev) => prev || url)
      }
    } finally {
      if (fromMediaNoteMenu) {
        mediaNoteUploaderIntentRef.current = false
        setMediaNoteUploadPending(false)
      }
    }
  }

  const handleMediaUploadSuccess = async ({
    url,
    tags,
    file: fileFromCallback,
    urlAlreadyInEditor
  }: {
    url: string
    tags: string[][]
    file?: File
    urlAlreadyInEditor?: boolean
  }) => {
    try {
      let uploadingFile: File | undefined = fileFromCallback
      if (!uploadingFile) {
        for (const [, file] of uploadedMediaFileMap.current.entries()) {
          uploadingFile = file
          break
        }
      }
      if (!uploadingFile) {
        const progressItem = uploadProgresses.find((p) => p.file)
        uploadingFile = progressItem?.file
      }
      if (!uploadingFile) {
        logger.warn('Media upload succeeded but file not found')
        if (mediaNoteUploaderIntentRef.current) {
          mediaNoteUploaderIntentRef.current = false
          setMediaNoteUploadPending(false)
        }
        return
      }

      if (isDiscussionThread && !parentEvent) {
        if (!urlAlreadyInEditor) {
          setTimeout(() => {
            appendUploadedUrlToComposer(url, imageUrlLooksLikeHttpImage(url))
          }, 100)
        }
        uploadedMediaFileMap.current.delete(`${uploadingFile.name}-${uploadingFile.size}-${uploadingFile.lastModified}`)
        handleUploadEnd(uploadingFile)
        return
      }

      // Determine media kind from file
      // For replies, only audio comments are supported (kind 1244)
      // For new PMs, audio messages are supported (kind 1222)
      // For new posts, all media types are supported
      if (parentEvent || isPublicMessage) {
        // For replies and PMs, only allow audio
        const fileType = uploadingFile.type
        const fileName = uploadingFile.name.toLowerCase()
        // Check for audio files - including mp4/m4a/webm/ogg/mp3 which can be audio
        // mp4/m4a/webm/ogg/mp3 files can be audio if MIME type is audio/*
        // For replies/PMs, webm/ogg/mp3 files should be treated as audio since the microphone button only accepts audio/*
        // Mobile browsers may report m4a files as audio/m4a, audio/mp4, audio/x-m4a, or even video/mp4
        const isAudioMime = fileType.startsWith('audio/') || fileType === 'audio/mp4' || fileType === 'audio/x-m4a' || fileType === 'audio/m4a' || fileType === 'audio/webm' || fileType === 'audio/mpeg'
        const isAudioExt = /\.(mp3|m4a|mka|ogg|wav|opus|aac|flac|mpeg|mp4)$/i.test(fileName)
        // m4a files are always audio, even if MIME type is video/mp4 (mobile browsers sometimes report this)
        const isM4aFile = /\.m4a$/i.test(fileName)
        const isMp4Audio = /\.mp4$/i.test(fileName) && isAudioMime
        const isWebmFile = /\.webm$/i.test(fileName)
        const isOggFile = /\.ogg$/i.test(fileName)
        const isMp3File = /\.mp3$/i.test(fileName)
        
        // For replies/PMs, treat webm/ogg/mp3/m4a as audio (since accept="audio/*" should filter out video files)
        // m4a files are always audio, even if MIME type is wrong
        const isAudio = isAudioMime || isAudioExt || isM4aFile || isMp4Audio || isWebmFile || isOggFile || isMp3File
        
        if (isAudio) {
          // For PM replies, don't set mediaNoteKind - let PM reply handle it with imeta tags
          if (parentEvent && parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
            // Don't set mediaNoteKind - PM replies stay as kind 24 with imeta tags
            // Just set the URL and imeta tags
          } else if (parentEvent) {
            // For regular replies, always create voice comments (kind 1244), regardless of duration
            setMediaNoteKind(ExtendedKind.VOICE_COMMENT)
          } else if (isPublicMessage) {
            // For new PMs, create voice notes (kind 1222)
            setMediaNoteKind(ExtendedKind.VOICE)
          }
          setMediaUrl(url)
          // Get imeta tag from media upload service
          const imetaTag = mediaUpload.getImetaTagByUrl(url)
          if (imetaTag) {
            setMediaImetaTags([imetaTag])
            composerImetaTagsRef.current = [imetaTag]
          } else if (tags && tags.length > 0) {
            const nipRow = nip94PairsToImetaTag(tags)
            setMediaImetaTags([nipRow])
            composerImetaTagsRef.current = [nipRow]
          } else {
            const basicImetaTag: string[] = ['imeta', `url ${url}`]
            // For webm/ogg/mp3/m4a files uploaded via microphone, ensure MIME type is set to audio/*
            // even if the browser reports video/webm or video/mp4 (mobile browsers sometimes do this)
            let mimeType = uploadingFile.type
            const fileName = uploadingFile.name.toLowerCase()
            if (/\.m4a$/i.test(fileName)) {
              // m4a files are always audio, use audio/mp4 or audio/x-m4a
              mimeType = 'audio/mp4'
            } else if (/\.mka$/i.test(fileName)) {
              mimeType = 'audio/x-matroska'
            } else if (/\.webm$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/webm'
            } else if (/\.ogg$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/ogg'
            } else if (/\.mp3$/i.test(fileName) && !mimeType.startsWith('audio/')) {
              mimeType = 'audio/mpeg'
            }
            if (mimeType) {
              basicImetaTag.push(`m ${mimeType}`)
            }
            setMediaImetaTags([basicImetaTag])
            composerImetaTagsRef.current = [basicImetaTag]
          }
          // Insert the URL into the editor content so it shows in the edit pane
          // Use setTimeout to ensure the state has updated and editor is ready
          if (!urlAlreadyInEditor) {
            setTimeout(() => {
              appendUploadedUrlToComposer(url, false)
            }, 100)
          }
        } else {
          // Non-audio media in replies/PMs - don't set mediaNoteKind, will be handled as regular comment/PM
          // Clear any existing media note kind
          setMediaNoteKind(null)
          setMediaUrl('')
          setMediaImetaTags([])
          composerImetaTagsRef.current = []
          if (!urlAlreadyInEditor) {
            appendUploadedUrlToComposer(url, imageUrlLooksLikeHttpImage(url))
          }
          return // Don't set media note kind for non-audio in replies/PMs
        }
      } else if (isMusicTrack) {
        const fileType = uploadingFile.type
        const fileName = uploadingFile.name.toLowerCase()
        const isAudioMime =
          fileType.startsWith('audio/') ||
          fileType === 'audio/mp4' ||
          fileType === 'audio/x-m4a' ||
          fileType === 'audio/m4a'
        const isAudioExt = /\.(mp3|m4a|mka|ogg|wav|opus|aac|flac|mpeg)$/i.test(fileName)
        const isAudio = isAudioMime || isAudioExt || /\.m4a$/i.test(fileName)
        const isImage =
          fileType.startsWith('image/') || imageUrlLooksLikeHttpImage(url)

        if (isAudio) {
          setMusicTrackAudioUrl(url)
          const ext = fileName.split('.').pop()
          if (ext && !musicTrackFormat.trim()) {
            setMusicTrackFormat(ext)
          }
        } else if (isImage) {
          setMusicTrackImageUrl(url)
        } else if (!urlAlreadyInEditor) {
          appendUploadedUrlToComposer(url, imageUrlLooksLikeHttpImage(url))
        }
      } else {
        // Mic toolbar uploads publish as voice notes; skip the ambiguous webm/mp4 dialog.
        if (micAudioUploadIntentRef.current && fileLooksLikeMicAudioUpload(uploadingFile)) {
          micAudioUploadIntentRef.current = false
          await processMediaUpload(url, tags, uploadingFile, ExtendedKind.VOICE, {
            skipComposerUrlAppend: urlAlreadyInEditor === true
          })
        } else if (isAmbiguousMediaFile(uploadingFile)) {
          // Show dialog to let user choose
          setPendingMediaUpload({
            url,
            tags,
            file: uploadingFile,
            urlAlreadyInEditor: urlAlreadyInEditor === true
          })
          setShowMediaKindDialog(true)
          return
        } else {
          // Not ambiguous, auto-detect and process
          await processMediaUpload(url, tags, uploadingFile, undefined, {
            skipComposerUrlAppend: urlAlreadyInEditor === true
          })
        }
      }
    } catch (error) {
      logger.error('Error in handleMediaUploadSuccess', { error })
      // Don't throw - just log the error so the upload doesn't fail completely
    }
    
    if (!mediaNoteUploaderIntentRef.current && !isMusicTrack) {
      clearNonMediaNoteComposerModes()
    }

    // Clear uploaded file map (upload finished). Keep composerImetaTagsRef in sync with mediaImetaTags — do not wipe here.
    uploadedMediaFileMap.current.clear()
  }

  const toolbarUploadHandlers = useMemo<PostEditorFormatToolbarUploadHandlers>(
    () => ({
      onUploadSuccess: handleMediaUploadSuccess,
      onUploadStart: handleUploadStart,
      onMicUploadStart: handleMicUploadStart,
      onUploadEnd: handleUploadEnd,
      onProgress: handleUploadProgress,
      onUploadCompressPhase: handleUploadCompressPhase,
      onUploadCompressProgress: handleUploadCompressProgress
    }),
    [
      handleMediaUploadSuccess,
      handleUploadStart,
      handleMicUploadStart,
      handleUploadEnd,
      handleUploadProgress,
      handleUploadCompressPhase,
      handleUploadCompressProgress
    ]
  )

  const renderComposerFormatToolbar = useCallback(
    (
      portalOverride?: HTMLElement | null,
      toolbarOrientation: 'horizontal' | 'vertical' = 'horizontal'
    ) => (
      <PostEditorFormatToolbar
        insertText={insertComposerText}
        insertEmoji={insertComposerEmoji}
        upload={toolbarUploadHandlers}
        showAudioUpload={showComposerAudioUpload}
        audioUploadTitle={
          parentEvent
            ? t('Upload Audio Comment')
            : isPublicMessage
              ? t('Upload Audio Message')
              : t('Voice Note')
        }
        audioButtonHighlighted={
          mediaNoteKind === ExtendedKind.VOICE_COMMENT || mediaNoteKind === ExtendedKind.VOICE
        }
        showMoreOptions={showMoreOptions}
        onToggleMoreOptions={() => setShowMoreOptions((pre) => !pre)}
        onOpenComposerOptions={isPageLayout ? onOpenOptions : undefined}
        showAdvancedSettings={!isPageLayout || !!onOpenOptions}
        pickerPortalContainer={portalOverride ?? pickerPortalContainer}
        orientation={toolbarOrientation}
      />
    ),
    [
      insertComposerText,
      insertComposerEmoji,
      toolbarUploadHandlers,
      showComposerAudioUpload,
      parentEvent,
      isPublicMessage,
      mediaNoteKind,
      showMoreOptions,
      isPageLayout,
      onOpenOptions,
      pickerPortalContainer,
      t
    ]
  )

  const composerAdvancedPanelProps = useMemo(
    () => ({
      show: showMoreOptions,
      posting,
      addClientTag,
      setAddClientTag,
      isNsfw,
      setIsNsfw,
      contentWarningLabel,
      setContentWarningLabel,
      minPow,
      setMinPow,
      showMentionsPicker: !isHighlight && !isWebBookmark,
      mentionsContent: text,
      mentionsParentEvent: isPublicMessage ? undefined : parentEvent,
      mentions: isPublicMessage ? extractedMentions : mentions,
      setMentions: isPublicMessage ? setExtractedMentions : setMentions,
      showRelayPicker:
        !isPublicationContent &&
        !isCitationInternal &&
        !isCitationExternal &&
        !isCitationHardcopy &&
        !isCitationPrompt,
      setAdditionalRelayUrls,
      onRelayPublishCapChange: handleRelayPublishCapChange,
      relayParentEvent: parentEvent,
      relayOpenFrom: openFrom,
      relayContent: text,
      relayIsPublicMessage: isPublicMessage,
      relayMentions: extractedMentions,
      relayCapBlockInfo,
      discussionThreadRelayError: threadErrors.relay,
      isDiscussionThread
    }),
    [
      showMoreOptions,
      posting,
      addClientTag,
      isNsfw,
      contentWarningLabel,
      minPow,
      isHighlight,
      text,
      isPublicMessage,
      parentEvent,
      extractedMentions,
      mentions,
      isPublicationContent,
      isCitationInternal,
      isCitationExternal,
      isCitationHardcopy,
      isCitationPrompt,
      openFrom,
      relayCapBlockInfo,
      threadErrors.relay,
      isDiscussionThread,
      handleRelayPublishCapChange
    ]
  )

  const composerAdvancedPanel = useMemo(
    () => <PostEditorAdvancedPanel {...composerAdvancedPanelProps} />,
    [composerAdvancedPanelProps]
  )

  const sessionAdvancedPanelProps = useMemo(
    () => (isPageLayout ? { ...composerAdvancedPanelProps, show: true } : null),
    [isPageLayout, composerAdvancedPanelProps]
  )

  useRegisterComposerAdvancedPanel(sessionAdvancedPanelProps)

  const composerUiStateRef = useRef({
    publishDisabled: true,
    posting: false,
    blockMessage: null as string | null,
    publishLabel: '',
    hasDraft: false,
    relaySelectedTotal: undefined as number | undefined
  })

  useEffect(() => {
    if (!onComposerUiStateChange) return
    const next = {
      publishDisabled: !canPost,
      posting,
      blockMessage: composerBlockMessage,
      publishLabel: publishLabelForShell,
      hasDraft: editorHasContent || text.trim().length > 0,
      relaySelectedTotal: relayCapPreview?.selectedTotal
    }
    const prev = composerUiStateRef.current
    if (
      prev.publishDisabled === next.publishDisabled &&
      prev.posting === next.posting &&
      prev.blockMessage === next.blockMessage &&
      prev.publishLabel === next.publishLabel &&
      prev.hasDraft === next.hasDraft &&
      prev.relaySelectedTotal === next.relaySelectedTotal
    ) {
      return
    }
    composerUiStateRef.current = next
    onComposerUiStateChange(next)
  }, [
    onComposerUiStateChange,
    canPost,
    posting,
    composerBlockMessage,
    publishLabelForShell,
    text,
    editorHasContent,
    relayCapPreview?.selectedTotal
  ])

  const handleArticleToggle = (type: 'longform' | 'wiki' | 'nostr-specification' | 'publication') => {
    if (parentEvent) return // Can't create articles as replies
    
    setIsLongFormArticle(type === 'longform')
    setIsWikiArticle(type === 'wiki')
    setIsNostrSpecification(type === 'nostr-specification')
    setIsPublicationContent(type === 'publication')
    if (type === 'nostr-specification') {
      setArticleImage('')
      setNostrSpecAffectedKindRows((rows) =>
        rows.length > 0 ? rows : [newNostrSpecAffectedKindRow()]
      )
    }
    
    // Clear other types
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsWebBookmark(false)
    setMediaNoteKind(null)
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsDiscussionThread(false)
    setIsMusicTrack(false)
    
    // Clear article metadata when switching off article mode
    if (type === null) {
      setArticleTitle('')
      setArticleDTag('')
      setArticleImage('')
      setArticleSubject('')
      setArticleSummary('')
      setArticleSummary('')
    }
    
    // Clear article fields when toggling off
    if (type === 'longform' || type === 'wiki' || type === 'nostr-specification' || type === 'publication') {
      // Keep fields when switching between article types
    } else {
      setArticleTitle('')
      setArticleDTag('')
      setArticleImage('')
      setArticleSubject('')
      setArticleSummary('')
    }
  }

  const handleCitationToggle = (type: 'internal' | 'external' | 'hardcopy' | 'prompt') => {
    if (parentEvent) return // Can't create citations as replies

    setIsCitationInternal(type === 'internal')
    setIsCitationExternal(type === 'external')
    setIsCitationHardcopy(type === 'hardcopy')
    setIsCitationPrompt(type === 'prompt')
    
    // Clear other types
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsWebBookmark(false)
    setMediaNoteKind(null)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsNostrSpecification(false)
    setIsPublicationContent(false)
    setIsMusicTrack(false)
    setIsDiscussionThread(false)
    
    // Set default accessedOn if not already set
    if (!citationAccessedOn && (type === 'external' || type === 'hardcopy' || type === 'prompt')) {
      setCitationAccessedOn(new Date().toISOString().split('T')[0]) // ISO date format YYYY-MM-DD
    }
  }

  const handleClear = () => {
    const wasDiscussion = isDiscussionThread
    // Clear the post editor cache
    postEditorCache.clearPostCache({ kind: getDeterminedKind, defaultContent, parentEvent })
    
    // Clear the editor content
    textareaRef.current?.clear()
    
    // Reset all state
    setText('')
    setMediaNoteKind(null)
    setMediaUrl('')
    clearMediaNoteUploadIntent()
    setMediaImetaTags([])
    setMentions([])
    setExtractedMentions([])
    setIsPoll(false)
    setIsPublicMessage(false)
    setIsHighlight(false)
    setIsLongFormArticle(false)
    setIsWikiArticle(false)
    setIsNostrSpecification(false)
    setIsPublicationContent(false)
    setIsMusicTrack(false)
    setMusicTrackDTag('')
    setMusicTrackTitle('')
    setMusicTrackArtist('')
    setMusicTrackAudioUrl('')
    setMusicTrackImageUrl('')
    setMusicTrackAlbum('')
    setMusicTrackDuration('')
    setMusicTrackFormat('')
    setMusicTrackLanguage('')
    setMusicTrackGenres('')
    musicTrackDTagFallbackRef.current = null
    setIsCitationInternal(false)
    setIsCitationExternal(false)
    setIsCitationHardcopy(false)
    setIsCitationPrompt(false)
    setIsDiscussionThread(false)
    setThreadTitle('')
    setThreadSelectedTopic('general')
    const gRow = DISCUSSION_TOPICS.find((x) => x.id === 'general')
    setThreadTopicInput(gRow?.label ?? 'general')
    setThreadIsReadingGroup(false)
    setThreadReadingAuthor('')
    setThreadReadingSubject('')
    setThreadShowReadingsPanel(false)
    setThreadErrors({})
    if (wasDiscussion) {
      postEditorCache.clearThreadDraft()
      postEditorCache.clearPostCache(discussionThreadDraftKindParams())
    }
    // Clear citation fields
    setCitationInternalCTag('')
    setCitationInternalRelayHint('')
    setCitationExternalUrl('')
    setCitationExternalOpenTimestamp('')
    setCitationHardcopyPageRange('')
    setCitationHardcopyChapterTitle('')
    setCitationHardcopyEditor('')
    setCitationHardcopyPublishedIn('')
    setCitationHardcopyVolume('')
    setCitationHardcopyDoi('')
    setCitationTitle('')
    setCitationAuthor('')
    setCitationPublishedOn('')
    setCitationPublishedBy('')
    setCitationAccessedOn('')
    setCitationLocation('')
    setCitationGeohash('')
    setCitationVersion('')
    setCitationSummary('')
    setCitationPromptLlm('')
    setNostrSpecAffectedKindRows([newNostrSpecAffectedKindRow()])
    setPollCreateData({
      isMultipleChoice: false,
      options: ['', ''],
      endsAt: undefined,
      relays: []
    })
    setHighlightData({
      sourceType: 'nostr',
      sourceValue: ''
    })
    setIsNsfw(false)
    setContentWarningLabel('')
    uploadedMediaFileMap.current.clear()
    composerImetaTagsRef.current = []
    setUploadProgresses([])
    postEditorCache.flushPersist()
  }

  const handleClearRef = useRef(handleClear)
  handleClearRef.current = handleClear

  useEffect(() => {
    if (!onClearRequestRef) return
    const ref = onClearRequestRef as React.MutableRefObject<(() => void) | null>
    ref.current = () => {
      handleClearRef.current()
    }
    return () => {
      ref.current = null
    }
  }, [onClearRequestRef])

  return (
    <div
      className={cn(
        'min-w-0',
        isPageLayout
          ? 'flex flex-col gap-2'
          : isSmallScreen
            ? 'flex min-h-0 flex-1 flex-col'
            : 'flex min-h-0 flex-1 max-h-full flex-col'
      )}
    >
      <NeventPickerProvider>
        <div
          className={cn(
            'min-w-0',
            isPageLayout
              ? 'flex flex-col gap-2'
              : isSmallScreen
                ? 'flex min-h-0 flex-1 flex-col gap-2'
                : 'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pr-1'
          )}
        >
          <ComposerHeaderScroll
            enabled={composerHeaderScrollEnabled}
            size={composerHeaderScrollSize}
          >
      {/* Dynamic Title based on mode */}
      {!isPageLayout ? (
      <div className="text-lg font-semibold">
        {(() => {
          const determinedKind = getDeterminedKind
          if (parentEvent) {
            if (parentEvent.kind === ExtendedKind.PUBLIC_MESSAGE) {
              return t('Reply to Public Message')
            } else if (determinedKind === ExtendedKind.VOICE_COMMENT) {
              return t('Voice Comment')
            } else {
              return t('Reply to')
            }
          } else if (determinedKind === ExtendedKind.VOICE) {
            return t('Voice Note')
          } else if (determinedKind === ExtendedKind.PICTURE) {
            return t('Picture Note')
          } else if (isNip71StyleVideoKind(determinedKind)) {
            return isNip71ShortVideoKind(determinedKind) ? t('Short Video Note') : t('Video Note')
          } else if (determinedKind === ExtendedKind.POLL) {
            return t('New Poll')
          } else if (determinedKind === ExtendedKind.PUBLIC_MESSAGE) {
            return t('New Public Message')
          } else if (determinedKind === kinds.Highlights) {
            return t('New Highlight')
          } else if (determinedKind === ExtendedKind.DISCUSSION) {
            return t('New Discussion')
          } else if (determinedKind === kinds.LongFormArticle) {
            return t('New Long-form Article')
          } else if (determinedKind === ExtendedKind.WIKI_ARTICLE) {
            return t('New Wiki Article')
          } else if (determinedKind === ExtendedKind.NOSTR_SPECIFICATION) {
            return t('New Nostr Specification')
          } else if (determinedKind === ExtendedKind.PUBLICATION_CONTENT) {
            return t('Take a note')
          } else if (determinedKind === ExtendedKind.CITATION_INTERNAL) {
            return t('New Internal Citation')
          } else if (determinedKind === ExtendedKind.CITATION_EXTERNAL) {
            return t('New External Citation')
          } else if (determinedKind === ExtendedKind.CITATION_HARDCOPY) {
            return t('New Hardcopy Citation')
          } else if (determinedKind === ExtendedKind.CITATION_PROMPT) {
            return t('New Prompt Citation')
          } else {
            return t('New Note')
          }
        })()}
      </div>
      ) : null}
      
      {parentEvent && !isPageLayout && (
        <div className="shrink-0 max-h-32 overflow-y-auto rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {getParentReplyBlurbDisplayText(parentEvent, 320)}
        </div>
      )}

      {isComposerEditTab ? (
      <>
      {isDiscussionThread && !parentEvent && (
        <ComposerKindFieldsShell>
          <div className="space-y-2">
            <Label htmlFor="discussion-topic-input" className="text-sm font-medium">
              {t('Topic')} <span className="text-destructive">*</span>
            </Label>
            <div className="flex min-w-0 gap-2">
              <Input
                id="discussion-topic-input"
                value={threadTopicInput}
                onChange={(e) => setThreadTopicInput(e.target.value)}
                onBlur={() => {
                  const r = resolveTopicFromInput(threadTopicInput, allAvailableTopics)
                  if (r) {
                    setThreadSelectedTopic(r)
                    setThreadTopicInput(displayTopicLabel(r, allAvailableTopics))
                  }
                }}
                placeholder={t('Type a topic or pick from the list')}
                autoComplete="off"
                className={cn('min-w-0 flex-1 bg-background', threadErrors.topic && 'border-destructive')}
              />
              <Popover open={threadTopicPopoverOpen} onOpenChange={setThreadTopicPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    title={t('Suggested topics')}
                    aria-expanded={threadTopicPopoverOpen}
                  >
                    <ChevronDown className="h-4 w-4 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[10000] w-[min(18rem,calc(100vw-1.5rem))] max-w-none p-2"
                  align="end"
                  side="bottom"
                  sideOffset={4}
                >
                  <p className="text-muted-foreground mb-2 px-1 text-xs font-medium">{t('Suggested topics')}</p>
                  <div className="max-h-60 overflow-y-auto">
                    {allAvailableTopics.map((topic, index) => {
                      const Icon = topic.icon
                      return (
                        <div
                          key={`topic-${index}-${topic.id}`}
                          className="flex cursor-pointer items-center rounded p-2 hover:bg-accent"
                          onClick={() => {
                            setThreadSelectedTopic(topic.id)
                            setThreadTopicInput(topic.label)
                            setThreadTopicPopoverOpen(false)
                          }}
                        >
                          <Check
                            className={`mr-2 h-4 w-4 ${threadTopicResolved === topic.id ? 'opacity-100' : 'opacity-0'}`}
                          />
                          <Icon className="mr-2 h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate text-sm">{topic.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {threadErrors.topic && <p className="text-sm text-destructive">{threadErrors.topic}</p>}
            <p className="text-xs text-muted-foreground">
              {t(
                'Choose a suggested topic or type your own. It becomes a normalized tag (e.g. my-topic).'
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="discussion-thread-title" className="text-sm font-medium">
              {t('Title')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="discussion-thread-title"
              value={threadTitle}
              onChange={(e) => setThreadTitle(e.target.value)}
              placeholder={t('Enter a descriptive title for your thread')}
              maxLength={100}
              className={cn('bg-background', threadErrors.title && 'border-destructive')}
            />
            {threadErrors.title && <p className="text-sm text-destructive">{threadErrors.title}</p>}
            <p className="text-xs text-muted-foreground">
              {threadTitle.length}/100 {t('characters')}
            </p>
          </div>

          {threadTopicResolved === 'literature' && (
            <div className="shrink-0 space-y-2">
              <div className="flex items-center gap-2">
                <Book className="h-4 w-4" />
                <Label className="text-sm font-medium">{t('Readings Options')}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={threadShowReadingsPanel ? t('Hide') : t('Configure')}
                  onClick={() => setThreadShowReadingsPanel(!threadShowReadingsPanel)}
                  className="ml-auto"
                >
                  {threadShowReadingsPanel ? t('Hide') : t('Configure')}
                </Button>
              </div>

              {threadShowReadingsPanel && (
                <ComposerKindFieldsShell className="border-dashed bg-muted/15 p-3" contentClassName="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Book className="h-4 w-4 text-primary" />
                      <Label htmlFor="discussion-reading-group" className="text-sm">
                        {t('Reading group entry')}
                      </Label>
                    </div>
                    <Switch
                      id="discussion-reading-group"
                      checked={threadIsReadingGroup}
                      onCheckedChange={setThreadIsReadingGroup}
                    />
                  </div>

                  {threadIsReadingGroup && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="discussion-reading-author">{t('Author')}</Label>
                        <Input
                          id="discussion-reading-author"
                          value={threadReadingAuthor}
                          onChange={(e) => setThreadReadingAuthor(e.target.value)}
                          placeholder={t('Enter the author name')}
                          className={threadErrors.author ? 'border-destructive' : ''}
                        />
                        {threadErrors.author && <p className="text-sm text-destructive">{threadErrors.author}</p>}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="discussion-reading-subject">{t('Subject (Book Title)')}</Label>
                        <Input
                          id="discussion-reading-subject"
                          value={threadReadingSubject}
                          onChange={(e) => setThreadReadingSubject(e.target.value)}
                          placeholder={t('Enter the book title')}
                          className={threadErrors.subject ? 'border-destructive' : ''}
                        />
                        {threadErrors.subject && <p className="text-sm text-destructive">{threadErrors.subject}</p>}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        {t(
                          'This will add additional tags for author and subject to help organize reading group discussions.'
                        )}
                      </p>
                    </div>
                  )}
                </ComposerKindFieldsShell>
              )}
            </div>
          )}
        </ComposerKindFieldsShell>
      )}
      
      {/* Article metadata fields */}
      {(isLongFormArticle || isWikiArticle || isNostrSpecification || isPublicationContent) && (
        <ComposerKindFieldsShell>
          <div className="space-y-2">
            <Label htmlFor="article-dtag" className="text-sm font-medium">
              {t('D-Tag')}
            </Label>
            <Input
              id="article-dtag"
              value={articleDTag}
              onChange={(e) => setArticleDTag(e.target.value)}
              placeholder={t('e.g., my-article-title')}
            />
            <p className="text-xs text-muted-foreground">{t('articleDTagDefaultHint')}</p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-title" className="text-sm font-medium">
              {t('Title')}
            </Label>
            <Input
              id="article-title"
              value={articleTitle}
              onChange={(e) => setArticleTitle(e.target.value)}
              placeholder={t('Article title (optional)')}
            />
          </div>
          
          {!isNostrSpecification && (
            <div className="space-y-2">
              <Label htmlFor="article-image" className="text-sm font-medium">
                {t('Image URL')}
              </Label>
              <Input
                id="article-image"
                value={articleImage}
                onChange={(e) => setArticleImage(e.target.value)}
                placeholder={t('https://example.com/image.jpg')}
              />
              <p className="text-xs text-muted-foreground">
                {t('URL of the article cover image (optional)')}
              </p>
            </div>
          )}

          {isNostrSpecification && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t('nostrSpecAffectedKindLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('nostrSpecAffectedKindHint')}</p>
              <div className="space-y-2">
                {nostrSpecAffectedKindRows.map((row, index) => (
                  <div key={row.id} className="flex gap-2 items-center">
                    <Input
                      id={index === 0 ? 'nostr-spec-k-0' : undefined}
                      value={row.value}
                      inputMode="numeric"
                      className="font-mono text-sm"
                      placeholder={t('nostrSpecAffectedKindPlaceholder')}
                      onChange={(e) => {
                        const v = e.target.value
                        setNostrSpecAffectedKindRows((rows) =>
                          rows.map((r) => (r.id === row.id ? { ...r, value: v } : r))
                        )
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={nostrSpecAffectedKindRows.length <= 1}
                      onClick={() =>
                        setNostrSpecAffectedKindRows((rows) => rows.filter((r) => r.id !== row.id))
                      }
                      aria-label={t('Remove')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() =>
                  setNostrSpecAffectedKindRows((rows) => [...rows, newNostrSpecAffectedKindRow()])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                {t('nostrSpecAffectedKindAdd')}
              </Button>
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="article-subject" className="text-sm font-medium">
              {t('Subject / Topics')}
            </Label>
            <Input
              id="article-subject"
              value={articleSubject}
              onChange={(e) => setArticleSubject(e.target.value)}
              placeholder={t('topic1, topic2, topic3')}
            />
            <p className="text-xs text-muted-foreground">
              {t('Comma or space-separated topics (will be added as t-tags)')}
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="article-summary" className="text-sm font-medium">
              {t('Summary')}
            </Label>
            <Textarea
              id="article-summary"
              value={articleSummary}
              onChange={(e) => setArticleSummary(e.target.value)}
              placeholder={t('Brief summary of the article (optional)')}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {t('A short description of the article content')}
            </p>
          </div>
        </ComposerKindFieldsShell>
      )}

      {isMusicTrack && (
        <ComposerKindFieldsShell>
          <div className="space-y-2">
            <Label htmlFor="music-track-dtag" className="text-sm font-medium">
              {t('D-Tag')}
            </Label>
            <Input
              id="music-track-dtag"
              value={musicTrackDTag}
              onChange={(e) => setMusicTrackDTag(e.target.value)}
              placeholder={t('e.g., my-song-slug')}
            />
            <p className="text-xs text-muted-foreground">{t('articleDTagDefaultHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="music-track-title" className="text-sm font-medium">
              {t('Title')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="music-track-title"
              value={musicTrackTitle}
              onChange={(e) => setMusicTrackTitle(e.target.value)}
              placeholder={t('Track title')}
              className={!musicTrackTitle.trim() ? 'border-destructive' : ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="music-track-artist" className="text-sm font-medium">
              {t('Artist')}
            </Label>
            <Input
              id="music-track-artist"
              value={musicTrackArtist}
              onChange={(e) => setMusicTrackArtist(e.target.value)}
              placeholder={t('Artist name (optional)')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="music-track-audio-url" className="text-sm font-medium">
              {t('Audio URL')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="music-track-audio-url"
              value={musicTrackAudioUrl}
              onChange={(e) => setMusicTrackAudioUrl(e.target.value)}
              placeholder={t('https://example.com/track.m4a')}
              className={!musicTrackAudioUrl.trim() ? 'border-destructive' : ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="music-track-image-url" className="text-sm font-medium">
              {t('Cover image URL')}
            </Label>
            <Input
              id="music-track-image-url"
              value={musicTrackImageUrl}
              onChange={(e) => setMusicTrackImageUrl(e.target.value)}
              placeholder={t('https://example.com/cover.png')}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="music-track-album" className="text-sm font-medium">
                {t('Album')}
              </Label>
              <Input
                id="music-track-album"
                value={musicTrackAlbum}
                onChange={(e) => setMusicTrackAlbum(e.target.value)}
                placeholder={t('Album (optional)')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="music-track-duration" className="text-sm font-medium">
                {t('Duration (seconds)')}
              </Label>
              <Input
                id="music-track-duration"
                type="number"
                min={1}
                value={musicTrackDuration}
                onChange={(e) => setMusicTrackDuration(e.target.value)}
                placeholder="245"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="music-track-format" className="text-sm font-medium">
                {t('Format')}
              </Label>
              <Input
                id="music-track-format"
                value={musicTrackFormat}
                onChange={(e) => setMusicTrackFormat(e.target.value)}
                placeholder="mp3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="music-track-language" className="text-sm font-medium">
                {t('Language')}
              </Label>
              <Input
                id="music-track-language"
                value={musicTrackLanguage}
                onChange={(e) => setMusicTrackLanguage(e.target.value)}
                placeholder="de"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="music-track-genres" className="text-sm font-medium">
              {t('Genres')}
            </Label>
            <Input
              id="music-track-genres"
              value={musicTrackGenres}
              onChange={(e) => setMusicTrackGenres(e.target.value)}
              placeholder={t('heimatsound, deutschland')}
            />
            <p className="text-xs text-muted-foreground">
              {t('Comma-separated genre tags (kind 36787 also adds t=music automatically)', {
                defaultValue: 'Comma-separated genre tags (t=music is added automatically)'
              })}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Use the editor below for lyrics or notes (Markdown).', {
              defaultValue: 'Use the editor below for lyrics or notes (Markdown).'
            })}
          </p>
        </ComposerKindFieldsShell>
      )}
      
      {/* Citation metadata fields */}
      {(isCitationInternal ||
        isCitationExternal ||
        isCitationHardcopy ||
        isCitationPrompt) && (
        <ComposerKindFieldsShell
          title={
            isCitationInternal
              ? t('Internal Citation Settings')
              : isCitationExternal
                ? t('External Citation Settings')
                : isCitationHardcopy
                  ? t('Hardcopy Citation Settings')
                  : t('Prompt Citation Settings')
          }
          contentClassName="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          {/* Prompt Citation specific fields - shown first if prompt */}
          {isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-prompt-llm" className="text-sm font-medium">
                  {t('Language Model')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-prompt-llm"
                  value={citationPromptLlm}
                  onChange={(e) => setCitationPromptLlm(e.target.value)}
                  placeholder={t('e.g., GPT-4, Claude, etc. (required)')}
                  className={!citationPromptLlm.trim() ? 'border-destructive' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Name of the language model used')}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-external-url" className="text-sm font-medium">
                  {t('URL')}
                </Label>
                <Input
                  id="citation-external-url"
                  value={citationExternalUrl}
                  onChange={(e) => setCitationExternalUrl(e.target.value)}
                  placeholder={t('Website where LLM was accessed (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Shared fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-title" className="text-sm font-medium">
                  {t('Title')}
                </Label>
                <Input
                  id="citation-title"
                  value={citationTitle}
                  onChange={(e) => setCitationTitle(e.target.value)}
                  placeholder={t('Citation title (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-author" className="text-sm font-medium">
                  {t('Author')}
                </Label>
                <Input
                  id="citation-author"
                  value={citationAuthor}
                  onChange={(e) => setCitationAuthor(e.target.value)}
                  placeholder={t('Author name (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Internal Citation specific fields */}
          {isCitationInternal && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-internal-ctag" className="text-sm font-medium">
                  {t('C-Tag')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-internal-ctag"
                  value={citationInternalCTag}
                  onChange={(e) => setCitationInternalCTag(e.target.value)}
                  placeholder={t('kind:pubkey:hex format (required)')}
                  className={!citationInternalCTag.trim() ? 'border-destructive' : ''}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Reference to the cited Nostr event in kind:pubkey:hex format')}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-internal-relay-hint" className="text-sm font-medium">
                  {t('Relay Hint')}
                </Label>
                <Input
                  id="citation-internal-relay-hint"
                  value={citationInternalRelayHint}
                  onChange={(e) => setCitationInternalRelayHint(e.target.value)}
                  placeholder={t('Relay URL (optional)')}
                />
              </div>
            </>
          )}
          
          {/* External Citation specific fields */}
          {isCitationExternal && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-external-url" className="text-sm font-medium">
                  {t('URL')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="citation-external-url"
                  value={citationExternalUrl}
                  onChange={(e) => setCitationExternalUrl(e.target.value)}
                  placeholder={t('https://example.com (required)')}
                  className={!citationExternalUrl.trim() ? 'border-destructive' : ''}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-external-open-timestamp" className="text-sm font-medium">
                  {t('Open Timestamp')}
                </Label>
                <Input
                  id="citation-external-open-timestamp"
                  value={citationExternalOpenTimestamp}
                  onChange={(e) => setCitationExternalOpenTimestamp(e.target.value)}
                  placeholder={t('e tag of kind 1040 event (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-published-by" className="text-sm font-medium">
                  {t('Published By')}
                </Label>
                <Input
                  id="citation-published-by"
                  value={citationPublishedBy}
                  onChange={(e) => setCitationPublishedBy(e.target.value)}
                  placeholder={t('Publisher name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Hardcopy Citation specific fields */}
          {isCitationHardcopy && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-page-range" className="text-sm font-medium">
                  {t('Page Range')}
                </Label>
                <Input
                  id="citation-hardcopy-page-range"
                  value={citationHardcopyPageRange}
                  onChange={(e) => setCitationHardcopyPageRange(e.target.value)}
                  placeholder={t('e.g., 123-145 (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-chapter-title" className="text-sm font-medium">
                  {t('Chapter Title')}
                </Label>
                <Input
                  id="citation-hardcopy-chapter-title"
                  value={citationHardcopyChapterTitle}
                  onChange={(e) => setCitationHardcopyChapterTitle(e.target.value)}
                  placeholder={t('Chapter title (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-editor" className="text-sm font-medium">
                  {t('Editor')}
                </Label>
                <Input
                  id="citation-hardcopy-editor"
                  value={citationHardcopyEditor}
                  onChange={(e) => setCitationHardcopyEditor(e.target.value)}
                  placeholder={t('Editor name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-published-in" className="text-sm font-medium">
                  {t('Published In')}
                </Label>
                <Input
                  id="citation-hardcopy-published-in"
                  value={citationHardcopyPublishedIn}
                  onChange={(e) => setCitationHardcopyPublishedIn(e.target.value)}
                  placeholder={t('Journal/Publication name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-volume" className="text-sm font-medium">
                  {t('Volume')}
                </Label>
                <Input
                  id="citation-hardcopy-volume"
                  value={citationHardcopyVolume}
                  onChange={(e) => setCitationHardcopyVolume(e.target.value)}
                  placeholder={t('Volume number (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-hardcopy-doi" className="text-sm font-medium">
                  {t('DOI')}
                </Label>
                <Input
                  id="citation-hardcopy-doi"
                  value={citationHardcopyDoi}
                  onChange={(e) => setCitationHardcopyDoi(e.target.value)}
                  placeholder={t('Digital Object Identifier (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-published-by" className="text-sm font-medium">
                  {t('Published By')}
                </Label>
                <Input
                  id="citation-published-by"
                  value={citationPublishedBy}
                  onChange={(e) => setCitationPublishedBy(e.target.value)}
                  placeholder={t('Publisher name (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-version" className="text-sm font-medium">
                  {t('Version')}
                </Label>
                <Input
                  id="citation-version"
                  value={citationVersion}
                  onChange={(e) => setCitationVersion(e.target.value)}
                  placeholder={t('Version number (optional)')}
                />
              </div>
            </>
          )}
          
          {/* Shared date fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <div className="space-y-2">
              <Label htmlFor="citation-published-on" className="text-sm font-medium">
                {t('Published On')}
              </Label>
              <Input
                id="citation-published-on"
                type="date"
                value={citationPublishedOn}
                onChange={(e) => setCitationPublishedOn(e.target.value)}
              />
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="citation-accessed-on" className="text-sm font-medium">
              {t('Accessed On')} {(isCitationExternal || isCitationHardcopy || isCitationPrompt) && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id="citation-accessed-on"
              type="date"
              value={citationAccessedOn}
              onChange={(e) => setCitationAccessedOn(e.target.value)}
              className={(isCitationExternal || isCitationHardcopy || isCitationPrompt) && !citationAccessedOn.trim() ? 'border-destructive' : ''}
            />
          </div>
          
          {/* Summary field - different label for prompt citations - spans full width on desktop */}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="citation-summary" className="text-sm font-medium">
              {isCitationPrompt ? t('Prompt Conversation Script') : t('Summary')}
            </Label>
            <Textarea
              id="citation-summary"
              value={citationSummary}
              onChange={(e) => setCitationSummary(e.target.value)}
              placeholder={isCitationPrompt ? t('The full prompt conversation (optional)') : t('Brief summary (optional)')}
              rows={3}
            />
          </div>
          
          {/* Shared optional fields - not shown for prompt citations */}
          {!isCitationPrompt && (
            <>
              <div className="space-y-2">
                <Label htmlFor="citation-location" className="text-sm font-medium">
                  {t('Location')}
                </Label>
                <Input
                  id="citation-location"
                  value={citationLocation}
                  onChange={(e) => setCitationLocation(e.target.value)}
                  placeholder={t('Location (optional)')}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="citation-geohash" className="text-sm font-medium">
                  {t('Geohash')}
                </Label>
                <Input
                  id="citation-geohash"
                  value={citationGeohash}
                  onChange={(e) => setCitationGeohash(e.target.value)}
                  placeholder={t('Geohash (optional)')}
                />
              </div>
            </>
          )}
        </ComposerKindFieldsShell>
      )}

      {isHighlight ? (
          <HighlightEditor
            highlightData={highlightData}
            setHighlightData={setHighlightData}
            setIsHighlight={setIsHighlight}
          />
      ) : null}
      {isWebBookmark ? (
          <WebBookmarkEditor webBookmarkData={webBookmarkData} setWebBookmarkData={setWebBookmarkData} />
      ) : null}
      {isPoll ? (
          <PollEditor
            pollCreateData={pollCreateData}
            setPollCreateData={setPollCreateData}
            setIsPoll={setIsPoll}
          />
      ) : null}
      {isPublicMessage ? (
        <ComposerKindFieldsShell title={t('Recipients')}>
          {extractedMentions.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('Recipients detected from your message:')} {extractedMentions.length}
              {!showMoreOptions ? (
                <span className="block text-xs mt-1">{t('Open Advanced to adjust mention recipients')}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('Add recipients using nostr: mentions (e.g., nostr:npub1...) or open Advanced')}
            </p>
          )}
        </ComposerKindFieldsShell>
      ) : null}
      </>
      ) : null}
          </ComposerHeaderScroll>

      <div
        className={cn(
          'flex min-w-0 flex-col overflow-hidden min-h-0 flex-1',
          isPageLayout && 'shrink-0'
        )}
      >
      <div className={cn('flex min-h-0 flex-1 flex-col', !isPageLayout && 'min-h-0 flex-1')}>
      <PostTextarea
          ref={textareaRef}
          fillAvailableHeight={!isPageLayout}
          text={text}
          setText={setText}
          onEditorNonemptyChange={handleEditorNonemptyChange}
          defaultContent={defaultContent}
          parentEvent={isDiscussionThread && !parentEvent ? THREAD_POST_EDITOR_PARENT : parentEvent}
          onSubmit={() => post()}
          className={cn(isDiscussionThread && threadErrors.content && 'border-destructive')}
          onUploadStart={handleUploadStart}
          onUploadProgress={handleUploadProgress}
          onUploadEnd={handleUploadEnd}
          onUploadSuccess={handleMediaUploadSuccess}
          onUploadCompressPhase={handleUploadCompressPhase}
          onUploadCompressProgress={handleUploadCompressProgress}
          kind={getDeterminedKind}
          highlightData={isHighlight ? highlightData : undefined}
          webBookmarkData={isWebBookmark ? webBookmarkData : undefined}
          pollCreateData={isPoll ? pollCreateData : undefined}
          extraPreviewTags={mergedExtraPreviewTags}
          articleMetadata={articlePreviewMetadata}
          musicTrackMetadata={musicTrackPreviewMetadata}
          addClientTag={addClientTag}
          contentWarning={labContentWarning}
          mediaImetaTags={mediaImetaTags}
          mediaUrl={mediaUrl}
          onActiveTabChange={setComposerEditorTab}
          onMediaUrlPasted={handlePastedMediaUrl}
          headerActions={(() => {
              const ActiveIcon =
                isLongFormArticle ? FileText :
                isWikiArticle ? FileText :
                isNostrSpecification ? FileText :
                isPublicationContent ? Book :
                isMusicTrack ? Music :
                isCitationInternal || isCitationExternal || isCitationHardcopy || isCitationPrompt ? Quote :
                isHighlight ? Highlighter :
                isWebBookmark ? Bookmark :
                isPublicMessage ? MessageCircle :
                isPoll ? ListTodo :
                isDiscussionThread ? MessagesSquare :
                isMediaNoteComposerMode ? Upload :
                StickyNote
              const activeLabel =
                isLongFormArticle ? t('Long-form Article') :
                isWikiArticle ? t('Wiki Article (AsciiDoc)') :
                isNostrSpecification ? t('Nostr Specification') :
                isPublicationContent ? t('Publication Note') :
                isMusicTrack ? t('Music Track', { defaultValue: 'Music Track' }) :
                isCitationInternal ? t('Internal Citation') :
                isCitationExternal ? t('External Citation') :
                isCitationHardcopy ? t('Hardcopy Citation') :
                isCitationPrompt ? t('Prompt Citation') :
                isHighlight ? t('Highlight') :
                isWebBookmark ? t('Web bookmark') :
                isPublicMessage ? t('Public Message') :
                isPoll ? t('Poll') :
                isDiscussionThread ? t('Thread') :
                isMediaNoteComposerMode ? t('Media Note') :
                t('Short Note')
              return (
                <div className="flex w-full flex-wrap items-center gap-1 sm:flex-nowrap sm:justify-end">
                  {enableAdvancedEditor ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs font-normal sm:h-8 sm:text-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleOpenAdvancedLab()
                      }}
                      title={t('Advanced event lab')}
                    >
                      {t('Advanced editor button')}
                    </Button>
                  ) : null}
                  {!parentEvent ? (
                    <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    disabled={!canUseMediaKindFromUrlButton}
                    title={
                      canUseMediaKindFromUrlButton
                        ? t('Use image/audio/video note kind for the media URL in the editor')
                        : t('Media kind (disabled): add imeta tags, a media URL, or upload media first')
                    }
                    onClick={handleUseMediaNoteKindFromUrl}
                  >
                    <Upload className="h-3.5 w-3.5 shrink-0" />
                    <span className="sr-only">{t('Media kind')}</span>
                  </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 min-w-0 max-w-[11rem] shrink gap-1 px-2 text-xs font-normal sm:max-w-[15rem] sm:text-sm"
                    >
                      <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 truncate">{activeLabel}</span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[min(16rem,calc(100vw-1.5rem))]">
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                      {t('Note type')}
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={handlePlainNoteMode} className="gap-3 py-2 cursor-pointer">
                      <StickyNote className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Short Note')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Plain text note (kind 1)')}</span>
                      </div>
                      {isPlainShortNoteToolbar && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={beginMediaNoteUpload} className="gap-3 py-2 cursor-pointer">
                      <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Media Note')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Attach image, audio, or video')}</span>
                      </div>
                      {isMediaNoteComposerMode && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleMusicTrackToggle} className="gap-3 py-2 cursor-pointer">
                      <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Music Track', { defaultValue: 'Music Track' })}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {t('Publish audio with cover art and lyrics (kind 36787)', {
                            defaultValue: 'Publish audio with cover art and lyrics (kind 36787)'
                          })}
                        </span>
                      </div>
                      {isMusicTrack && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleHighlightToggle} className="gap-3 py-2 cursor-pointer">
                      <Highlighter className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Highlight')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Save a quote or passage')}</span>
                      </div>
                      {isHighlight && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleWebBookmarkToggle} className="gap-3 py-2 cursor-pointer">
                      <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Web bookmark')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {t('Save a link with optional title and note (kind 39701)', {
                            defaultValue: 'Save a link with optional title and note (kind 39701)'
                          })}
                        </span>
                      </div>
                      {isWebBookmark && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePublicMessageToggle} className="gap-3 py-2 cursor-pointer">
                      <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Public Message')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Public direct message (kind 4)')}</span>
                      </div>
                      {isPublicMessage && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handlePollToggle} className="gap-3 py-2 cursor-pointer">
                      <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Poll')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Create a voting poll')}</span>
                      </div>
                      {isPoll && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => checkLogin(() => handleDiscussionThreadToggle())} className="gap-3 py-2 cursor-pointer">
                      <MessagesSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Thread')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Start a discussion thread')}</span>
                      </div>
                      {isDiscussionThread && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                      {t('Articles')}
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleArticleToggle('longform')} className="gap-3 py-2 cursor-pointer">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Long-form Article')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Markdown article (NIP-23)')}</span>
                      </div>
                      {isLongFormArticle && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleArticleToggle('wiki')} className="gap-3 py-2 cursor-pointer">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Wiki Article (AsciiDoc)')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('AsciiDoc wiki contribution')}</span>
                      </div>
                      {isWikiArticle && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleArticleToggle('nostr-specification')} className="gap-3 py-2 cursor-pointer">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Nostr Specification')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">
                          {t('nostrSpecificationContribution')}
                        </span>
                      </div>
                      {isNostrSpecification && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </DropdownMenuItem>
                    {hasPrivateRelaysAvailable && (
                      <DropdownMenuItem onClick={() => handleArticleToggle('publication')} className="gap-3 py-2 cursor-pointer">
                        <Book className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex flex-col flex-1 min-w-0">
                          <span className="font-medium leading-none">{t('Publication Note')}</span>
                          <span className="text-xs text-muted-foreground mt-0.5">{t('Private relay publication')}</span>
                        </div>
                        {isPublicationContent && <Check className="h-4 w-4 shrink-0 text-primary" />}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground px-2 py-1">
                      {t('Citations')}
                    </DropdownMenuLabel>
                    {hasPrivateRelaysAvailable ? (
                      <>
                        <DropdownMenuItem onClick={() => handleCitationToggle('internal')} className="gap-3 py-2 cursor-pointer">
                          <Quote className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="font-medium leading-none">{t('Internal Citation')}</span>
                            <span className="text-xs text-muted-foreground mt-0.5">{t('Cite from private relay')}</span>
                          </div>
                          {isCitationInternal && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCitationToggle('external')} className="gap-3 py-2 cursor-pointer">
                          <Quote className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="font-medium leading-none">{t('External Citation')}</span>
                            <span className="text-xs text-muted-foreground mt-0.5">{t('Cite from external source')}</span>
                          </div>
                          {isCitationExternal && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCitationToggle('hardcopy')} className="gap-3 py-2 cursor-pointer">
                          <Quote className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="font-medium leading-none">{t('Hardcopy Citation')}</span>
                            <span className="text-xs text-muted-foreground mt-0.5">{t('Physical source citation')}</span>
                          </div>
                          {isCitationHardcopy && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCitationToggle('prompt')} className="gap-3 py-2 cursor-pointer">
                          <Quote className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="flex flex-col flex-1 min-w-0">
                            <span className="font-medium leading-none">{t('Prompt Citation')}</span>
                            <span className="text-xs text-muted-foreground mt-0.5">{t('AI / LLM prompt citation')}</span>
                          </div>
                          {isCitationPrompt && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                      </>
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        {t('Citations require private relays (NIP-65).')}
                      </div>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => checkLogin(() => setCreateCustomEventOpen(true))} className="gap-3 py-2 cursor-pointer">
                      <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="font-medium leading-none">{t('Custom Event')}</span>
                        <span className="text-xs text-muted-foreground mt-0.5">{t('Create event with custom kind')}</span>
                      </div>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                    </>
                  ) : null}
                </div>
              )
            })()
          }
        />
      </div>
      </div>
      {!showMoreOptions && isNsfw ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t('Post editor content warning summary', {
            label: normalizeContentWarningLabel(contentWarningLabel)
          })}
        </p>
      ) : null}
      {isComposerEditTab && isDiscussionThread && !parentEvent && (
        <div className="flex min-w-0 flex-col gap-1">
          {threadErrors.content && <p className="text-sm text-destructive">{threadErrors.content}</p>}
          <p className="text-xs text-muted-foreground">
            {text.length}/5000 {t('characters')}
          </p>
        </div>
      )}
      {uploadProgresses.length > 0 &&
        uploadProgresses.map(({ file, progress, cancel, phase }, index) => (
          <div key={`${file.name}-${index}`} className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-muted-foreground mb-0.5">
                {file.name ?? t('Uploading...')}
              </div>
              <div className="text-[11px] text-muted-foreground mb-1 leading-snug">
                {phase === 'compressing'
                  ? t('Compressing on your device before upload (large videos can take several minutes)…')
                  : t('Uploading to media server…')}
              </div>
              <div className="h-0.5 w-full rounded-full bg-muted overflow-hidden">
                {phase === 'compressing' && progress <= 0 ? (
                  <div
                    className="h-full w-1/3 max-w-[45%] animate-pulse rounded-full bg-primary motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-60"
                    aria-hidden
                  />
                ) : (
                  <div
                    className="h-full bg-primary transition-[width] duration-200 ease-out"
                    style={{
                      width: `${phase === 'compressing' ? Math.max(2, progress) : progress}%`
                    }}
                  />
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel?.()
                handleUploadEnd(file)
              }}
              className="text-muted-foreground hover:text-foreground"
              title={t('Cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      {/* Hidden uploader for the "Media Note" dropdown item */}
      {!parentEvent && (
        <Uploader
          onUploadSuccess={handleMediaUploadSuccess}
          onUploadStart={handleUploadStart}
          onUploadEnd={handleUploadEnd}
          onProgress={handleUploadProgress}
          onUploadCompressPhase={handleUploadCompressPhase}
          onUploadCompressProgress={handleUploadCompressProgress}
          accept="image/*,audio/*,video/*,.mkv,.mka,video/x-matroska,audio/x-matroska"
          className="sr-only"
        >
          <button ref={mediaUploaderBtnRef} type="button" aria-hidden="true" tabIndex={-1} />
        </Uploader>
      )}
        </div>
      {isPageLayout && pageFooterSlot
        ? createPortal(
            <div className="flex min-w-0 w-full items-center gap-1.5 px-1">
              <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
                {renderComposerFormatToolbar()}
              </div>
            </div>,
            pageFooterSlot
          )
        : null}
      {!advancedLabOpen && isPageLayout ? (
        <div className="sr-only" aria-hidden>
          {composerAdvancedPanel}
        </div>
      ) : null}
      {showDialogFooter ? (
      <div
        className={cn(
          'min-w-0 shrink-0 space-y-2 border-t border-border bg-background pt-3',
          isSmallScreen
            ? 'z-10 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]'
            : 'pb-2'
        )}
      >
      <div className="flex min-w-0 w-full flex-col items-stretch gap-2">
        <div className="min-w-0 w-full overflow-x-auto overscroll-x-contain">
          {renderComposerFormatToolbar()}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5">
          <div className="flex gap-2 items-center max-sm:hidden">
            <Button
              type="button"
              variant="outline"
              title={t('Clear')}
              onClick={(e) => {
                e.stopPropagation()
                handleClear()
              }}
            >
              {t('Clear')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              title={t('Cancel')}
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button
              type="submit"
              title={
                parentEvent
                  ? t('Reply')
                  : isPublicMessage
                    ? t('Send Public Message')
                    : isDiscussionThread
                      ? t('Create Thread')
                      : t('Post')
              }
              disabled={!canPost}
              onClick={post}
            >
              {posting && (
                <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />
              )}
              {parentEvent
                ? t('Reply')
                : isPublicMessage
                  ? t('Send Public Message')
                  : isDiscussionThread
                    ? t('Create Thread')
                    : t('Post')}
            </Button>
          </div>
        </div>
      </div>
      {!advancedLabOpen && showInlineAdvancedPanel ? composerAdvancedPanel : null}
      <div className="flex gap-2 items-center justify-around sm:hidden">
        <Button
          type="button"
          className="w-full"
          variant="outline"
          title={t('Clear')}
          onClick={(e) => {
            e.stopPropagation()
            handleClear()
          }}
        >
          {t('Clear')}
        </Button>
        <Button
          type="button"
          className="w-full"
          variant="secondary"
          title={t('Cancel')}
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          {t('Cancel')}
        </Button>
        <Button
          className="w-full"
          type="submit"
          title={
            parentEvent
              ? t('Reply')
              : isPublicMessage
                ? t('Send Public Message')
                : isDiscussionThread
                  ? t('Create Thread')
                  : t('Post')
          }
          disabled={!canPost}
          onClick={post}
        >
          {posting && (
            <Skeleton className="mr-2 inline-block size-4 shrink-0 rounded-full align-middle" aria-hidden />
          )}
          {parentEvent ? t('Reply') : isDiscussionThread ? t('Create Thread') : t('Post')}
        </Button>
      </div>
      {open ? (
        <StoredAccountSwitchSelect
          withTopBorder
          alignEnd
          className="w-full"
          showLabelAlways
          inComposer
        />
      ) : null}
      </div>
      ) : null}

      {/* Media Kind Selection Dialog */}
      <Dialog open={showMediaKindDialog} onOpenChange={setShowMediaKindDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Select Media Type')}</DialogTitle>
            <DialogDescription>
              {pendingMediaUpload && (
                <>
                  {t('This file could be either audio or video. Please select the correct type:')}
                  <br />
                  <span className="text-xs text-muted-foreground mt-2 block">
                    {pendingMediaUpload.file.name}
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              variant="outline"
              className="flex items-center justify-start gap-3 h-auto p-4"
              onClick={() => {
                // User selected audio - always use VOICE (kind 1222)
                handleMediaKindSelection(ExtendedKind.VOICE)
              }}
            >
              <Music className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-medium">{t('Audio')}</span>
                <span className="text-xs text-muted-foreground">{t('Voice note or audio file')}</span>
              </div>
            </Button>
            <Button
              variant="outline"
              className="flex items-center justify-start gap-3 h-auto p-4"
              onClick={() => {
                // Get duration to determine if it should be VIDEO (kind 21) or SHORT_VIDEO (kind 22)
                const file = pendingMediaUpload?.file
                if (file) {
                  // Create a temporary media element to get duration
                  const url = URL.createObjectURL(file)
                  const media = document.createElement('video')
                  
                  media.onloadedmetadata = () => {
                    const duration = media.duration || 0
                    URL.revokeObjectURL(url)
                    // Video files longer than 10 minutes (600 seconds) are long videos (kind 21)
                    // Otherwise use short video (kind 22)
                    const selectedKind = duration > 600 ? ExtendedKind.VIDEO : ExtendedKind.SHORT_VIDEO
                    handleMediaKindSelection(selectedKind)
                  }
                  
                  media.onerror = () => {
                    URL.revokeObjectURL(url)
                    // Fallback to SHORT_VIDEO if we can't determine duration
                    handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                  }
                  
                  media.src = url
                  media.load()
                  
                  // Timeout after 3 seconds
                  setTimeout(() => {
                    URL.revokeObjectURL(url)
                    handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                  }, 3000)
                } else {
                  // Fallback to SHORT_VIDEO if no file
                  handleMediaKindSelection(ExtendedKind.SHORT_VIDEO)
                }
              }}
            >
              <Video className="h-5 w-5" />
              <div className="flex flex-col items-start">
                <span className="font-medium">{t('Video')}</span>
                <span className="text-xs text-muted-foreground">{t('Video file')}</span>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {enableAdvancedEditor && advancedLabHostMounted && advancedLabPortalContainer ? (
        <Suspense fallback={null}>
          <PostEditorAdvancedLabHost
            hostRef={advancedLabHostRef}
            persistenceKey={advancedLabPersistenceKey}
            textareaRef={textareaRef}
            getKind={() => getDeterminedKindRef.current}
            onOpenChange={handleAdvancedLabOpenChange}
            advancedLabPortalContainer={advancedLabPortalContainer}
            advancedLabPortalRef={advancedLabPortalRef}
            markupMode={isAsciidocMarkupKind(getDeterminedKind) ? 'asciidoc' : 'markdown'}
            i18nLanguage={i18n.language}
            contextEventId={parentEvent?.id ?? null}
            previewAuthorPubkey={pubkey ?? null}
            addClientTag={addClientTag}
            contentWarning={labContentWarning}
            renderFormatToolbar={({ pickerPortalContainer: labPickerPortal, toolbarOrientation }) =>
              renderComposerFormatToolbar(labPickerPortal, toolbarOrientation ?? 'horizontal')
            }
            composerToolbarPanel={composerAdvancedPanel}
            onLabClose={() => setShowMoreOptions(false)}
            onApply={(payload) => {
              advancedLabHostRef.current?.persistLabDraft(payload)
              advancedLabHostRef.current?.applyToTipTap(payload.content)
            }}
          />
        </Suspense>
      ) : null}
      <EditOrCloneEventDialog
        open={createCustomEventOpen}
        onOpenChange={setCreateCustomEventOpen}
        mode="create"
      />
      </NeventPickerProvider>
    </div>
  )
}
