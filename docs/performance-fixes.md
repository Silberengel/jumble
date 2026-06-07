# Performance fixes (audit follow-up)

This document records seven fixes identified during a sluggishness audit. They are ordered by impact and should be applied in sequence.

## Executive summary

Sluggishness came mainly from **main-thread work that scales with feed size** and **React context churn** that re-renders large subtrees. Orphaned files added maintenance noise but did not affect runtime.

The largest win is in `NoteList`: expensive per-event work ran inside a filter that scans up to **2,500 events** on every dependency change.

---

## Fix 1 — Hoist `pinnedEventHexIdSet` out of `shouldHideEvent`

**File:** `src/components/NoteList/index.tsx`

**Problem:** `shouldHideEvent` rebuilt `pinnedEventHexIdSet` (with `decode()` per pin) **inside** the per-event callback. That callback is used in a `useMemo` that scans up to `MAX_TIMELINE_EVENTS_SCAN_FOR_VISIBLE` (2500) rows, so pin decoding ran up to 2,500× per filter pass.

**Fix:** Compute `pinnedEventHexIdSet` once in a `useMemo` keyed on `pinnedEventIds`. `shouldHideEvent` reads the memoized set.

**Expected impact:** Largest feed-filter win; small diff.

---

## Fix 2 — Cap profile-prefetch walks to visible + lookahead

**File:** `src/components/NoteList/index.tsx`

**Problem:** A debounced `useEffect` walked **all** of `timelineEventsForFilter` and `newEvents` on every buffer change, then enqueued profile/emoji prefetch for every author found.

**Fix:** Walk only `filteredEvents.slice(0, showCount + prefetchMargin)` (capped, e.g. 120 rows) plus a small slice of `newEvents` (e.g. 32). Keep the existing note-stats slice for visible rows.

**Expected impact:** Fewer redundant kind-0 fetches and less main-thread work when the timeline buffer grows.

---

## Fix 3 — Memoize `MuteListProvider` and `ContentPolicyProvider` context values

**Files:**
- `src/providers/MuteListProvider.tsx`
- `src/providers/ContentPolicyProvider.tsx`

**Problem:** Both providers passed a new `value` object every render. Handler functions were recreated each render. Consumers include `NoteList`, `Note`, `Image`, `VideoPlayer`, etc., so parent re-renders cascaded through the feed.

**Fix:**
- Wrap mute handlers in `useCallback`.
- Wrap policy updaters in `useCallback`.
- Wrap provider `value` in `useMemo` with stable dependencies.

**Expected impact:** Fewer wide subtree re-renders when unrelated parent state changes.

---

## Fix 4 — Cap `iterateProfileEvents` IndexedDB scan

**File:** `src/services/indexed-db.service.ts`

**Problem:** `iterateProfileEvents` loaded **all** kind-0 rows from IndexedDB into a single `events[]` array before chunked callback processing. Large offline caches caused a big allocation on first @-mention search or session prewarm.

**Fix:** Cap rows collected during the cursor pass (`MAX_PROFILE_EVENTS_ITERATE`, e.g. 8,000). Log when truncated. Keep chunked `requestAnimationFrame` yields during callback processing.

**Expected impact:** Bounded memory and faster startup on accounts with very large profile caches.

---

## Fix 5 — Tune `ReplaceableEventService` batching during scroll

**Files:**
- `src/lib/scroll-activity.service.ts` (new)
- `src/components/NoteList/index.tsx`
- `src/services/client-replaceable-events.service.ts`

**Problem:** `maxBatchSize: 200` with 100ms batching queued many kind-0 fetches during fast scrolling, competing with timeline REQs (console: `Large batch detected, limiting processing`).

**Fix:**
- Add a lightweight scroll-activity signal (`markScrolling()` from feed scroll handlers).
- Lower `maxBatchSize` (64) and lengthen `batchScheduleFn` delay while scrolling (200ms vs 100ms idle).

**Expected impact:** Profile fetches defer during scroll; timeline paint stays responsive.

---

## Fix 6 — Delete unused files and junk

**Problem:** Knip reported 16 unused files plus `src/services/Untitled` (accidental single-character junk). No runtime cost, but bundle/clarity noise.

**Files removed:**

| Cluster | Files |
|---------|--------|
| Connected relays UI | `ActiveRelaysDropdownSection.tsx`, `ActiveRelaysIconGrid.tsx`, `active-relays-display.ts` |
| Old Explore tabs | `Explore/index.tsx`, `ExploreFavoriteRelays.tsx`, `ExplorePopularRelays.tsx`, `ExploreRelayReviews.tsx` |
| Other UI | `FollowingFavoriteRelayList`, `SeenOnButton`, `NotificationThreadWatchButtons`, `ProfileTimeline`, `Tabs/index.tsx`, `ProfileSearchBar`, `QuickZapSwitch` |
| Hooks | `useBtcUsdRate.ts`, `useRelayConnectionRows.ts` |
| Junk | `src/services/Untitled` |

**Note:** `useProfileTimeline` hook and `ExploreRelayDirectory` remain in use; only dead wrappers were removed.

---

## Fix 7 — YouTube iframe API poll timeout

**File:** `src/lib/youtube-iframe-api.ts`

**Problem:** When the YouTube script tag was already present but `YT.Player` never became available, `requestAnimationFrame` polled forever.

**Fix:** Cap polling (e.g. 5s / ~300 frames). Resolve the promise anyway so embeds fail gracefully instead of leaking rAF work.

---

## Verification

After applying all fixes:

```bash
npm run test -- --run src/lib/profile-author-warmup-spec.test.ts src/components/PostEditor/PostTextarea/Mention/mention-range.test.ts
npx tsc --noEmit
```

Manual checks:

1. Home feed scroll — no jank spike when many authors are visible.
2. @-mention search — still finds cached profiles after IDB cap.
3. YouTube embeds — still load when API is healthy; no infinite rAF when blocked.

---

## Phase 2 — Archives API was additive, not a replacement (2026-06-07)

**Why it still felt sluggish:** Nostr Archives REST was wired in parallel with relays for profiles/search, but **feed note stats still fired full relay REQ waves** for every visible card even when Archives already had interaction counts. Archives also consumed the shared **100 req/min** budget via sequential interaction prefetch, while relay work continued unchanged.

### Fix A — Feed cards: Archives-only stats

**File:** `src/components/NoteStats/index.tsx`

Background feed cards (`!foregroundStats`) now call `prefetchArchivesInteractions` only. Relay `fetchNoteStats` runs on foreground surfaces (open note, thread, interactions panel).

### Fix B — Parallel Archives interaction prefetch

**File:** `src/lib/note-stats-archives-prefetch.ts`

Prefetch runs with concurrency 5 instead of one note at a time.

### Fix C — Archives-first profile batch

**File:** `src/lib/profile-metadata-batch.ts`

Await Archives metadata (400ms cap), then relay-fetch **only pubkeys Archives did not return** — avoids duplicate kind-0 storms.

### Fix D — Remove 120× `subscribeNoteStats` in NoteList

**File:** `src/components/NoteList/index.tsx`

Dropped per-visible-note stats subscriptions that re-triggered profile batches on every Archives count update.

### Fix E — Stabilize superchat filter

**File:** `src/components/NoteList/index.tsx`

`feedAttestedSuperchatIds` read from a ref inside `shouldHideEvent` so attestation updates do not rescan 2500 rows.

### Fix F — Cap Archives blocking on thread resolve

**File:** `src/lib/thread-context-local.ts`

Archives event lookup races with a 700ms cap before falling through to local stores / relays.

---

## Related audit items (not in this pass)

| Area | Notes |
|------|--------|
| `DeepBrowsingProvider` + `Tabs` | Scroll updates context → tab chrome re-renders |
| `NostrProvider` | Account hydration causes broad tree updates |
| `useFeedAttestedSuperchatIds` | New attestations invalidate `shouldHideEvent` → full feed re-scan |
| `NoteList` stats subscriptions | Up to ~120 `subscribeNoteStats` listeners |
| `RssFeedList` | 20s IndexedDB poll while mounted |
| `client.service` | 45s HTTP timeline polling on index relays |
| Knip unused exports | Mostly shadcn re-exports; low priority |

The `while (true)` worker pool in `client.service.ts` (~line 390) is intentional and bounded.
