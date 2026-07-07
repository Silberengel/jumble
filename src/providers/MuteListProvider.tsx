import { buildAccountListRelayUrlsForMerge } from '@/lib/account-list-relay-urls'
import { createMuteListDraftEvent } from '@/lib/draft-event'
import {
  dedupePTagsAppendPubkey,
  fetchLatestReplaceableListEvent,
  removePubkeyFromPTags
} from '@/lib/replaceable-list-latest'
import { getPubkeysFromPTags } from '@/lib/tag'
import { MuteListContext } from '@/contexts/mute-list-context'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { kinds } from 'nostr-tools'
import dayjs from 'dayjs'
import { Event } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { useNostr } from './NostrProvider'
import { useFavoriteRelays } from './FavoriteRelaysProvider'
import logger from '@/lib/logger'
import { muteSetHas } from '@/lib/mute-set'
import {
  decryptNip51ListPrivateContent,
  encryptNip51ListPrivateContent
} from '@/lib/nip51-list-private-content'

/**
 * Decryption failures are common and usually benign (npub-only session, extension declined NIP-44/NIP-04,
 * legacy/other-client ciphertext, corrupted relay copy). Log at most once per event id per load.
 */
const muteListPrivateSectionIssueLogged = new Set<string>()

function logMuteListPrivateIssueOnce(eventId: string, message: string, detail?: Record<string, unknown>) {
  if (muteListPrivateSectionIssueLogged.has(eventId)) return
  muteListPrivateSectionIssueLogged.add(eventId)
  logger.warn(message, { eventId, ...detail })
}

export function MuteListProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const {
    pubkey: accountPubkey,
    account,
    isAccountSessionHydrating,
    muteListEvent,
    publish,
    updateMuteListEvent,
    nip04Decrypt,
    nip04Encrypt,
    nip44Decrypt,
    nip44Encrypt
  } = useNostr()
  const { favoriteRelays, blockedRelays } = useFavoriteRelays()
  const [tags, setTags] = useState<string[][]>([])
  const [privateTags, setPrivateTags] = useState<string[][]>([])
  const publicMutePubkeySet = useMemo(
    () => new Set(getPubkeysFromPTags(tags).map((p) => p.toLowerCase())),
    [tags]
  )
  const privateMutePubkeySet = useMemo(
    () => new Set(getPubkeysFromPTags(privateTags).map((p) => p.toLowerCase())),
    [privateTags]
  )
  const mutePubkeySet = useMemo(() => {
    return new Set([...Array.from(privateMutePubkeySet), ...Array.from(publicMutePubkeySet)])
  }, [publicMutePubkeySet, privateMutePubkeySet])
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    muteListPrivateSectionIssueLogged.clear()
  }, [accountPubkey])

  const getPrivateTags = async (muteListEvent: Event) => {
    if (!muteListEvent.content?.trim()) return []

    // npub-only sessions cannot decrypt; never surface a stale IDB decrypt from a prior signing session.
    if (!account || account.signerType === 'npub') {
      return []
    }

    const storedDecryptedTags = await indexedDb.getMuteDecryptedTags(muteListEvent.id)

    if (storedDecryptedTags) {
      const cached = z.array(z.array(z.string())).safeParse(storedDecryptedTags)
      if (cached.success) return cached.data
      try {
        await indexedDb.deleteMuteDecryptedTags(muteListEvent.id)
      } catch {
        /* ignore */
      }
    }

    // During account hydrate, mute list can be set before every downstream invariant is ready; skip
    // decrypt and the empty-ciphertext warning, then retry when hydration finishes.
    if (isAccountSessionHydrating) {
      return []
    }

    const { plainText } = await decryptNip51ListPrivateContent(muteListEvent.content.trim(), muteListEvent.pubkey, {
      nip04Decrypt,
      nip44Decrypt
    })

    if (!plainText.trim()) {
      logMuteListPrivateIssueOnce(
        muteListEvent.id,
        'Mute list ciphertext could not be decrypted (npub-only / extension blocked NIP-44 or NIP-04 / wrong key / corrupt payload). Public `p`/`e` mutes still apply.',
        { signerType: account.signerType }
      )
      return []
    }

    try {
      const privateTags = z.array(z.array(z.string())).parse(JSON.parse(plainText))
      await indexedDb.putMuteDecryptedTags(muteListEvent.id, privateTags)
      return privateTags
    } catch (error) {
      try {
        await indexedDb.deleteMuteDecryptedTags(muteListEvent.id)
      } catch {
        /* ignore */
      }
      logMuteListPrivateIssueOnce(
        muteListEvent.id,
        'Mute list decrypted but private payload was not valid JSON (public mutes still apply).',
        { cause: error instanceof Error ? error.message : String(error) }
      )
      return []
    }
  }

  useEffect(() => {
    const updateMuteTags = async () => {
      if (!muteListEvent) {
        setTags([])
        setPrivateTags([])
        return
      }

      const privateTags = await getPrivateTags(muteListEvent).catch(() => {
        return []
      })
      setPrivateTags(privateTags)
      setTags(muteListEvent.tags)
    }
    updateMuteTags()
  }, [muteListEvent, isAccountSessionHydrating, account?.signerType, account?.pubkey, nip04Decrypt, nip44Decrypt])

  const encryptPrivateTags = useCallback(
    async (authorPubkey: string, privateTags: string[][]) => {
      const { cipherText } = await encryptNip51ListPrivateContent(
        JSON.stringify(privateTags),
        authorPubkey,
        { nip04Decrypt, nip44Decrypt, nip04Encrypt, nip44Encrypt }
      )
      return cipherText
    },
    [nip04Decrypt, nip44Decrypt, nip04Encrypt, nip44Encrypt]
  )

  const getMutePubkeys = useCallback(() => {
    return Array.from(mutePubkeySet)
  }, [mutePubkeySet])

  const getMuteType = useCallback(
    (pubkey: string): 'public' | 'private' | null => {
      if (muteSetHas(publicMutePubkeySet, pubkey)) return 'public'
      if (muteSetHas(privateMutePubkeySet, pubkey)) return 'private'
      return null
    },
    [publicMutePubkeySet, privateMutePubkeySet]
  )

  const loadLatestMuteListEvent = useCallback(async (): Promise<Event | null> => {
    if (!accountPubkey) return null
    const relays = await buildAccountListRelayUrlsForMerge({
      accountPubkey,
      favoriteRelays: favoriteRelays ?? [],
      blockedRelays
    })
    const fromNetwork = await fetchLatestReplaceableListEvent(accountPubkey, kinds.Mutelist, relays)
    if (fromNetwork) return fromNetwork
    return (await client.fetchMuteListEvent(accountPubkey)) ?? null
  }, [accountPubkey, favoriteRelays, blockedRelays])

  const publishNewMuteListEvent = useCallback(async (tags: string[][], content?: string) => {
    if (dayjs().unix() === muteListEvent?.created_at) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    const newMuteListDraftEvent = createMuteListDraftEvent(tags, content)
    const event = await publish(newMuteListDraftEvent)
    toast.success(t('Successfully updated mute list'))
    return event
  }, [muteListEvent?.created_at, publish, t])

  const checkMuteListEvent = useCallback((muteListEvent: Event | null | undefined) => {
    if (!muteListEvent) {
      const result = confirm(t('MuteListNotFoundConfirmation'))

      if (!result) {
        throw new Error('Mute list not found')
      }
    }
  }, [t])

  const mutePubkeyPublicly = useCallback(async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      checkMuteListEvent(muteListEvent)
      if (
        muteListEvent &&
        muteListEvent.tags.some(
          ([tagName, tagValue]) => tagName === 'p' && tagValue?.toLowerCase() === pubkey.toLowerCase()
        )
      ) {
        return
      }
      const newTags = dedupePTagsAppendPubkey(muteListEvent?.tags ?? [], pubkey)
      const newMuteListEvent = await publishNewMuteListEvent(newTags, muteListEvent?.content)
      const privateTags = await getPrivateTags(newMuteListEvent)
      await updateMuteListEvent(newMuteListEvent, privateTags)
    } catch (error) {
      toast.error(t('Failed to mute user publicly') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }, [
    accountPubkey,
    changing,
    loadLatestMuteListEvent,
    publishNewMuteListEvent,
    t,
    updateMuteListEvent
  ])

  const mutePubkeyPrivately = useCallback(async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      checkMuteListEvent(muteListEvent)
      const privateTags = muteListEvent ? await getPrivateTags(muteListEvent) : []
      if (
        privateTags.some(
          ([tagName, tagValue]) => tagName === 'p' && tagValue?.toLowerCase() === pubkey.toLowerCase()
        )
      ) {
        return
      }

      const newPrivateTags = dedupePTagsAppendPubkey(privateTags, pubkey)
      const cipherText = await encryptPrivateTags(accountPubkey, newPrivateTags)
      const newMuteListEvent = await publishNewMuteListEvent(muteListEvent?.tags ?? [], cipherText)
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } catch (error) {
      toast.error(t('Failed to mute user privately') + ': ' + (error as Error).message)
    } finally {
      setChanging(false)
    }
  }, [
    accountPubkey,
    changing,
    loadLatestMuteListEvent,
    encryptPrivateTags,
    publishNewMuteListEvent,
    t,
    updateMuteListEvent
  ])

  const unmutePubkey = useCallback(async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter(
        (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
      )
      let cipherText = muteListEvent.content
      if (newPrivateTags.length !== privateTags.length) {
        cipherText = await encryptPrivateTags(accountPubkey, newPrivateTags)
      }

      const newMuteListEvent = await publishNewMuteListEvent(
        removePubkeyFromPTags(muteListEvent.tags, pubkey),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }, [
    accountPubkey,
    changing,
    loadLatestMuteListEvent,
    encryptPrivateTags,
    publishNewMuteListEvent,
    updateMuteListEvent
  ])

  const switchToPublicMute = useCallback(async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = privateTags.filter(
        (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
      )
      if (newPrivateTags.length === privateTags.length) {
        return
      }

      const cipherText = await encryptPrivateTags(accountPubkey, newPrivateTags)
      const newMuteListEvent = await publishNewMuteListEvent(
        dedupePTagsAppendPubkey(removePubkeyFromPTags(muteListEvent.tags, pubkey), pubkey),
        cipherText
      )
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }, [
    accountPubkey,
    changing,
    loadLatestMuteListEvent,
    encryptPrivateTags,
    publishNewMuteListEvent,
    updateMuteListEvent
  ])

  const switchToPrivateMute = useCallback(async (pubkey: string) => {
    if (!accountPubkey || changing) return

    setChanging(true)
    try {
      const muteListEvent = await loadLatestMuteListEvent()
      if (!muteListEvent) return

      const newTags = removePubkeyFromPTags(muteListEvent.tags, pubkey)
      if (newTags.length === muteListEvent.tags.length) {
        return
      }

      const privateTags = await getPrivateTags(muteListEvent)
      const newPrivateTags = dedupePTagsAppendPubkey(
        privateTags.filter(
          (tag) => !(tag[0] === 'p' && tag[1]?.toLowerCase() === pubkey.toLowerCase())
        ),
        pubkey
      )
      const cipherText = await encryptPrivateTags(accountPubkey, newPrivateTags)
      const newMuteListEvent = await publishNewMuteListEvent(newTags, cipherText)
      await updateMuteListEvent(newMuteListEvent, newPrivateTags)
    } finally {
      setChanging(false)
    }
  }, [
    accountPubkey,
    changing,
    loadLatestMuteListEvent,
    encryptPrivateTags,
    publishNewMuteListEvent,
    updateMuteListEvent
  ])

  const contextValue = useMemo(
    () => ({
      mutePubkeySet,
      changing,
      getMutePubkeys,
      getMuteType,
      mutePubkeyPublicly,
      mutePubkeyPrivately,
      unmutePubkey,
      switchToPublicMute,
      switchToPrivateMute
    }),
    [
      mutePubkeySet,
      changing,
      getMutePubkeys,
      getMuteType,
      mutePubkeyPublicly,
      mutePubkeyPrivately,
      unmutePubkey,
      switchToPublicMute,
      switchToPrivateMute
    ]
  )

  return (
    <MuteListContext.Provider value={contextValue}>
      {children}
    </MuteListContext.Provider>
  )
}
