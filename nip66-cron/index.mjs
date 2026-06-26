/**
 * NIP-66 relay monitor cron. Runs on the server; nsec stays in env, never sent to client.
 * - On startup: publish kind 10166 (monitor announcement) once.
 * - Every INTERVAL_MS after the previous round finishes: for each relay in the resolved monitor list, fetch NIP-11, build & publish 30166.
 *
 * Which relays are monitored:
 *   1) If RELAYS_TO_MONITOR is set: use that comma-separated list only (operator override).
 *   2) Else (default): merge built-in DEFAULT_RELAYS_TO_MONITOR with the monitor account’s kind 10002
 *      (`r` tags), deduped (defaults first, then 10002-only URLs). If no 10002 is found or it has no `r`
 *      URLs, use defaults only.
 *   Set RELAY_LIST_SKIP_KIND10002=1 to skip fetching 10002 and use defaults only.
 *
 * nostr.watch (and similar) only show relays that received a 30166. Relays whose NIP-11 HTTPS fetch
 * fails from this container are skipped — check logs for "NIP-11 fetch failed" / "Skipping relay".
 *
 * Env:
 *   NIP66_MONITOR_NSEC        - required; nsec for signing 30166/10166 (also used to find kind 10002 author)
 *   RELAYS_TO_MONITOR         - optional; if set, replaces merged list (static URLs only)
 *   RELAY_LIST_SKIP_KIND10002 - optional; "1"/"true" = do not fetch kind 10002; defaults only
 *   PUBLISH_RELAYS            - optional; comma-separated relays to publish/query / REQ 10002
 *   MAX_RELAYS_TO_MONITOR     - optional; cap after merge (default 500)
 *   INTERVAL_MS               - optional; ms pause between monitor runs (default 900000 = 15m)
 */

import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools'
import WebSocket from 'ws'
import { DEFAULT_RELAYS_TO_MONITOR } from './default-relays.mjs'

const RELAY_DISCOVERY_KIND = 30166
const RELAY_MONITOR_ANNOUNCEMENT_KIND = 10166

/** Same convention as kind-0 profile metadata (`["bot","true"]`): marks automated monitor output. */
const MONITOR_BOT_TAG = ['bot', 'true']

/**
 * Default URLs to run NIP-11 checks against (30166); merged with monitor kind 10002 unless overridden.
 * Generated from relay presets in src/constants.ts — run `node scripts/sync-nip66-default-relays.mjs`.
 */

/** Relays to publish 30166/10166 and to REQ kind 10002 from; broad enough for Imwald + NIP-66 discovery. */
const DEFAULT_PUBLISH_RELAYS = [
  'wss://nos.lol',
  'wss://relay.nostr.watch',
  'wss://relay.primal.net',
  'wss://relaypag.es',
  'wss://thecitadel.nostr1.com'
]

/** Default 15 minutes; kind 10166 `frequency` tag uses the same interval in seconds. */
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 900000

const MAX_RELAYS_TO_MONITOR = Math.min(
  2000,
  Math.max(1, Number(process.env.MAX_RELAYS_TO_MONITOR) || 500)
)

function log (msg, data = {}) {
  const ts = new Date().toISOString()
  console.log(ts, '[nip66-cron]', msg, Object.keys(data).length ? JSON.stringify(data) : '')
}

function normalizeRelayUrl (url) {
  try {
    const u = url.replace(/^ws:\/\//, 'wss://')
    const p = new URL(u.startsWith('wss://') ? u : `wss://${u}`)
    p.pathname = p.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
    return p.toString()
  } catch {
    return url
  }
}

/** Returns decoded secret key from env. Never log or expose process.env.NIP66_MONITOR_NSEC. */
function getSecretKey () {
  const raw = process.env.NIP66_MONITOR_NSEC
  if (!raw || typeof raw !== 'string') return null
  try {
    const { type, data } = nip19.decode(raw)
    if (type !== 'nsec') return null
    return data
  } catch {
    return null
  }
}

async function fetchNip11 (relayUrl) {
  const httpUrl = relayUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  try {
    const res = await fetch(httpUrl, { headers: { Accept: 'application/nostr+json' } })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    log('NIP-11 fetch failed', { url: relayUrl, err: err.message })
    return null
  }
}

function build30166 (relayUrl, nip11, sk) {
  const d = normalizeRelayUrl(relayUrl)
  const tags = [['d', d]]
  const nips = nip11?.supported_nips
  if (Array.isArray(nips)) {
    for (const n of nips) tags.push(['N', String(n)])
  }
  const lim = nip11?.limitation
  tags.push(['R', lim?.auth_required ? 'auth' : '!auth'])
  tags.push(['R', lim?.payment_required ? 'payment' : '!payment'])
  const draft = {
    kind: RELAY_DISCOVERY_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [...tags, MONITOR_BOT_TAG]
  }
  return finalizeEvent(draft, sk)
}

function build10166 (sk) {
  const freqSec = Math.max(60, Math.round(INTERVAL_MS / 1000))
  const draft = {
    kind: RELAY_MONITOR_ANNOUNCEMENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [['frequency', String(freqSec)], ['c', 'nip11'], ['c', 'ws'], MONITOR_BOT_TAG]
  }
  return finalizeEvent(draft, sk)
}

function parseListEnv (envVar, defaultList) {
  const raw = process.env[envVar]
  if (!raw || typeof raw !== 'string') return defaultList
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * REQ kind 10002 from `authorPubkey` on first relay that returns events; return deduped wss URLs from `r` tags.
 */
async function fetchRelayUrlsFromKind10002 (authorPubkey, queryRelayUrls) {
  const pk = (authorPubkey || '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(pk)) {
    log('Invalid pubkey for kind 10002 fetch (expected 64 hex chars)')
    return []
  }
  const subId = 'nip66rl' + Math.random().toString(36).slice(2, 10)
  const filter = { kinds: [10002], authors: [pk], limit: 30 }

  for (const relayUrl of queryRelayUrls) {
    let ws
    try {
      ws = new WebSocket(relayUrl, { handshakeTimeout: 12000 })
      await new Promise((resolve, reject) => {
        let timeoutId
        let settled = false
        const detachConnect = () => {
          ws.removeListener('open', onOpen)
          ws.removeListener('error', onConnectError)
        }
        const onOpen = () => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          detachConnect()
          resolve()
        }
        const onConnectError = (err) => {
          if (settled) return
          settled = true
          clearTimeout(timeoutId)
          detachConnect()
          reject(err)
        }
        timeoutId = setTimeout(() => {
          if (settled) return
          settled = true
          detachConnect()
          reject(new Error('open timeout'))
        }, 15000)
        ws.once('open', onOpen)
        ws.once('error', onConnectError)
      })
      const events = await new Promise((resolve) => {
        const acc = []
        let settled = false
        const t = setTimeout(() => {
          finish(acc)
        }, 20000)
        const onReqError = (err) => {
          log('Kind 10002 WS error during REQ', { relay: relayUrl, err: err?.message })
          finish(acc)
        }
        function finish (result) {
          if (settled) return
          settled = true
          clearTimeout(t)
          ws.removeListener('message', onMessage)
          ws.removeListener('error', onReqError)
          resolve(result)
        }
        function onMessage (data) {
          let msg
          try {
            msg = JSON.parse(data.toString())
          } catch {
            return
          }
          if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) acc.push(msg[2])
          if (msg[0] === 'EOSE' && msg[1] === subId) {
            finish(acc)
          }
        }
        ws.on('message', onMessage)
        ws.once('error', onReqError)
        ws.send(JSON.stringify(['REQ', subId, filter]))
      })

      if (!events.length) continue

      events.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
      const ev = events[0]
      const urls = new Set()
      for (const t of ev.tags || []) {
        if (t[0] !== 'r' || !t[1] || typeof t[1] !== 'string') continue
        const u = t[1].trim()
        if (u.startsWith('wss://') || u.startsWith('ws://')) urls.add(normalizeRelayUrl(u))
      }
      const list = [...urls]
      log('Fetched kind 10002 relay list', { relay: relayUrl, author: pk.slice(0, 12), count: list.length })
      return list
    } catch (err) {
      log('Kind 10002 fetch relay error', { relay: relayUrl, err: err.message })
    } finally {
      try {
        ws?.close()
      } catch (_) {}
    }
  }
  log('No kind 10002 found for author on query relays', { author: pk.slice(0, 12) })
  return []
}

/** Concatenate lists, normalize, dedupe by URL string; order preserved (first list wins position). */
function mergeRelayUrlLists (...lists) {
  const seen = new Set()
  const out = []
  for (const list of lists) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'string') continue
      const n = normalizeRelayUrl(raw.trim())
      if (!n.startsWith('wss://') && !n.startsWith('ws://')) continue
      if (seen.has(n)) continue
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/**
 * Resolve monitor URL list for this run.
 */
async function resolveRelaysToMonitor (sk, publishRelays) {
  const rawEnv = process.env.RELAYS_TO_MONITOR
  if (rawEnv && typeof rawEnv === 'string' && rawEnv.trim()) {
    const list = rawEnv.split(',').map(s => normalizeRelayUrl(s.trim())).filter(Boolean)
    log('Using RELAYS_TO_MONITOR override', { count: list.length })
    return list.slice(0, MAX_RELAYS_TO_MONITOR)
  }

  const defaults = DEFAULT_RELAYS_TO_MONITOR.map((u) => normalizeRelayUrl(u))

  const skip10002 =
    process.env.RELAY_LIST_SKIP_KIND10002 === '1' ||
    process.env.RELAY_LIST_SKIP_KIND10002 === 'true' ||
    process.env.RELAY_LIST_SKIP_KIND10002 === 'yes'

  if (skip10002) {
    log('RELAY_LIST_SKIP_KIND10002 set; using default relay list only', { count: defaults.length })
    return defaults.slice(0, MAX_RELAYS_TO_MONITOR)
  }

  const monitorPubkey = getPublicKey(sk)
  const from10002 = await fetchRelayUrlsFromKind10002(monitorPubkey, publishRelays)

  if (from10002.length === 0) {
    log('No kind 10002 relays merged; using default list only', {
      monitorPubkey: monitorPubkey.slice(0, 12),
      defaultCount: defaults.length
    })
    return defaults.slice(0, MAX_RELAYS_TO_MONITOR)
  }

  const merged = mergeRelayUrlLists(defaults, from10002)
  log('Merged default relays with monitor kind 10002', {
    monitorPubkey: monitorPubkey.slice(0, 12),
    defaultCount: defaults.length,
    kind10002Count: from10002.length,
    mergedCount: merged.length
  })
  return merged.slice(0, MAX_RELAYS_TO_MONITOR)
}

async function publishToOneRelay (url, msg, eventId) {
  let ws
  try {
    ws = new WebSocket(url, { handshakeTimeout: 8000 })
    await new Promise((resolve, reject) => {
      let timeoutId
      let settled = false
      const settle = (fn, arg) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        ws.removeListener('open', onOpen)
        ws.removeListener('error', onOpenError)
        if (arg !== undefined) fn(arg)
        else fn()
      }
      const onOpen = () => settle(resolve)
      const onOpenError = (err) => settle(reject, err)
      timeoutId = setTimeout(() => settle(reject, new Error('open timeout')), 10000)
      ws.once('open', onOpen)
      ws.once('error', onOpenError)
    })

    let accepted = false
    await new Promise((resolve) => {
      let settled = false
      let timeoutId
      const onMessageError = (err) => {
        log('Publish WS error waiting for OK', { url, err: err?.message })
        finish()
      }
      const onMessage = (data) => {
        try {
          const j = JSON.parse(data.toString())
          if (j[0] === 'OK' && j[1] === eventId) {
            if (j[2] === true) {
              accepted = true
            } else {
              log('Relay rejected event', { url, reason: j[3] })
            }
            finish()
          }
        } catch {
          /* ignore malformed frames */
        }
      }
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        ws.removeListener('message', onMessage)
        ws.removeListener('error', onMessageError)
        resolve()
      }
      timeoutId = setTimeout(finish, 3000)
      ws.on('message', onMessage)
      ws.once('error', onMessageError)
      ws.send(msg)
    })
    return accepted ? 1 : 0
  } catch (err) {
    log('Publish relay error', { url, err: err.message })
    return 0
  } finally {
    try {
      ws?.removeAllListeners()
      ws?.close()
    } catch (_) {}
  }
}

async function publishEvent (relayUrls, event) {
  const msg = JSON.stringify(['EVENT', event])
  const results = await Promise.all(
    relayUrls.map((url) => publishToOneRelay(url, msg, event.id))
  )
  return results.reduce((sum, n) => sum + n, 0)
}

async function run10166 (sk, publishRelays) {
  const event = build10166(sk)
  log('Publishing 10166 (monitor announcement)')
  const count = await publishEvent(publishRelays, event)
  log('Published 10166', { successCount: count })
}

const MONITOR_ROUND_CONCURRENCY = 8

async function run30166Round (sk, relaysToMonitor, publishRelays) {
  log('30166 round start', { relayCount: relaysToMonitor.length })
  for (let i = 0; i < relaysToMonitor.length; i += MONITOR_ROUND_CONCURRENCY) {
    const chunk = relaysToMonitor.slice(i, i + MONITOR_ROUND_CONCURRENCY)
    await Promise.all(
      chunk.map(async (relayUrl) => {
        const nip11 = await fetchNip11(relayUrl)
        if (!nip11) {
          log('Skipping relay (no NIP-11)', { url: relayUrl })
          return
        }
        const event = build30166(relayUrl, nip11, sk)
        const count = await publishEvent(publishRelays, event)
        log('Published 30166', { url: relayUrl, successCount: count })
      })
    )
  }
}

async function runMonitorRound (sk, publishRelays) {
  const relaysToMonitor = await resolveRelaysToMonitor(sk, publishRelays)
  await run30166Round(sk, relaysToMonitor, publishRelays)
}

/** Run monitor rounds sequentially; never start a new round while the previous is in flight. */
async function loopMonitorRounds (sk, publishRelays) {
  for (;;) {
    try {
      await runMonitorRound(sk, publishRelays)
    } catch (err) {
      console.error('[nip66-cron] monitor round failed', err)
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS))
  }
}

async function main () {
  const sk = getSecretKey()
  if (!sk) {
    log('No NIP66_MONITOR_NSEC set; exiting')
    process.exit(0)
  }
  log('NIP-66 monitor cron started (nsec configured)')

  // Normalize/dedupe/validate like resolveRelaysToMonitor does, so env-provided URLs (e.g. ws://,
  // trailing slashes, mixed case) match the rest of the pipeline.
  let publishRelays = mergeRelayUrlLists(parseListEnv('PUBLISH_RELAYS', DEFAULT_PUBLISH_RELAYS))
  if (publishRelays.length === 0) {
    log('PUBLISH_RELAYS contained no valid relay URLs; falling back to defaults')
    publishRelays = mergeRelayUrlLists(DEFAULT_PUBLISH_RELAYS)
  }

  await run10166(sk, publishRelays)

  void loopMonitorRounds(sk, publishRelays)
}

main().catch((err) => {
  console.error('[nip66-cron]', err)
  process.exit(1)
})
