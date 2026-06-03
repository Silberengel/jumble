# Nostr Archives integration — rollout checkpoint

**Last updated:** 2026-06-03  
**Purpose:** Preserve plan position across agent “Fix” runs and chat resets. Resume from **Next step** below.

**API docs:** https://nostrarchives.com/docs  
**Rule file:** `.cursor/rules/nostr-archives-integration.mdc`

---

## Status summary

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Foundation (API client, ingest, graceful failure, search relay constant) | **DONE** |
| **1** | Profile: follower count + paginated followers list | **DONE** |
| **2** | `search.nostrarchives.com` in `SEARCHABLE_RELAY_URLS` | **DONE** (in Phase 0) |
| **3** | General notes search: local + Archives REST merge | **DONE** |
| **4** | Note stats: prefetch `/v1/events/{id}/interactions` | **DONE** |
| **5a** | `/v1/search/suggest` in profile picker | **DONE** |
| **5b** | `POST /v1/profiles/metadata` in search/thread UIs | **DONE** |
| **6** | Note page: layered load (session → IDB → Archives → relays) | **DONE** |

**Other recent work (same branch, separate from Archives):** Post editor TipTap blank-field fix (stable extensions + placeholder shell) — see commit history on `imwald`.

---

## Cross-cutting rules (all phases)

1. **Persist verified events** — Any Archives payload with valid Nostr events goes through `persistArchivesEventsIfNew` / `persistArchivesPayloadEvents` → session cache + IndexedDB archive (`client.addEventToCache` → `queuePersistSeenEvent`). Skip if already in session or archive. Slim rows without valid `sig` are not persisted; use `getEventById` or relay backfill for offline.
2. **Graceful failure** — `nostrArchivesApi` returns `TArchivesApiResult`; never throw. On failure: hide Archives-only UI or fall back to relays/local. Circuit breaker (2 failures → 60s). Setting: `storage.getUseNostrArchivesApi()` (default on). Hook: `useNostrArchivesAvailable()`.
3. **Rate limit** — 100 req/min client budget via `nostrArchivesApi` only; batch metadata and interaction prefetch.

---

## Phase 0 — DONE (foundation files)

| File | Role |
|------|------|
| `src/constants.ts` | `NOSTR_ARCHIVES_API_BASE_URL`, `NOSTR_ARCHIVES_SEARCH_RELAY_URL`, rate limit, `StorageKey.USE_NOSTR_ARCHIVES_API`, search relay in `SEARCHABLE_RELAY_URLS` |
| `src/types/nostr-archives.ts` | `TArchivesApiResult`, social, interactions, metadata, note page types |
| `src/lib/nostr-archives-event.ts` | Strip enrichment fields; `archivesJsonToVerifiedEvent()` |
| `src/lib/nostr-archives-ingest.ts` | `persistArchivesEventsIfNew`, `persistArchivesPayloadEvents` |
| `src/services/nostr-archives-api.service.ts` | HTTP client, circuit breaker, all endpoint stubs |
| `src/services/local-storage.service.ts` | `getUseNostrArchivesApi` / `setUseNostrArchivesApi` |
| `src/hooks/useNostrArchivesAvailable.ts` | UI availability |
| `.cursor/rules/nostr-archives-integration.mdc` | Agent constraints |

**Service methods ready:** `getEventInteractions`, `getSocialGraph`, `getEventById`, `getNotePage`, `searchNotes`, `searchGeneral`, `searchSuggest`, `fetchProfilesMetadata`.

---

## Phase 1 — DONE: Followers on profile

| File | Role |
|------|------|
| `src/hooks/useNostrArchivesSocial.ts` | Counts via `getSocialGraph` (`followers_limit=0`) |
| `src/components/Profile/SmartFollowers.tsx` | Count + link; hidden when API unavailable or no count |
| `src/components/Profile/index.tsx` | Renders `SmartFollowers` next to `SmartFollowings` |
| `src/pages/secondary/FollowersListPage/index.tsx` | Paginated list (100/page), infinite scroll |
| `src/lib/link.ts` | `toFollowersList` |
| `src/routes.tsx`, `PageManager.tsx`, `navigation.service.ts` | Route + mobile/desktop nav |
| i18n `en.ts` / `de.ts` | Followers strings + indexer hint |

**Offline:** `!social.ok` or `!useNostrArchivesAvailable()` → hide count and list unavailable message on list page.

---

## Phase 3 — DONE: General notes search

| File | Role |
|------|------|
| `src/lib/nostr-archives-search.ts` | `searchArchivesNotesForGeneralSearch` → `/v1/notes/search` |
| `src/components/SearchResult/FullTextSearchByRelay.tsx` | Parallel local + Archives rows; merged hits; source badges |

**Offline:** Archives progress row hidden when `!useNostrArchivesAvailable()`; local search unchanged.

**Deferred:** `searchGeneral` `resolved` entity navigation (profile/note picker) — not wired in notes full-text UI yet.

---

## Phase 4 — DONE: Interaction prefetch

| File | Role |
|------|------|
| `src/lib/note-stats-archives-prefetch.ts` | Batched queue → `getEventInteractions` |
| `src/services/note-stats.service.ts` | `archivesInteractions` on `TNoteStats`, `applyArchivesInteractionCounts`, display helpers |
| `src/components/NoteStats/index.tsx` | `prefetchArchivesInteractions` when near viewport |
| Stat buttons | `displayListCountWithArchives` / `displayZapSatsWithArchives`, `noteStatsHasResolvableCounts` |

**Offline:** Prefetch no-op; relay stats unchanged.

---

## Phase 5 — Profiles medium

### 5a — DONE
- `src/lib/archives-profile-metadata.ts` — `archivesMetadataToProfile`
- `client.searchProfilesStaged` — `searchSuggest` after local, before profile relays

### 5b — DONE
| File | Role |
|------|------|
| `src/lib/profile-metadata-batch.ts` | `fetchProfilesMetadataBatch` — Archives POST metadata, relay gap fill |
| `FullTextSearchByRelay.tsx` | Search merged profile provider |
| `ThreadProfileBatchProvider.tsx` | Thread/note panel batch |
| `ProfileList/index.tsx` | Followers list + other pubkey lists |
| `ProfileListBySearch/index.tsx` | Profile search results prefetch |

---

## Phase 6 — DONE: Note page pipeline

| File | Role |
|------|------|
| `src/lib/note-page-load-pipeline.ts` | `resolveNoteEventFromArchives`, `fetchArchivesNotePageBundle`, `prewarmArchivesNotePage` |
| `src/lib/thread-context-local.ts` | Archives REST after IDB archive, before publication store |
| `src/hooks/useFetchEvent.tsx` | Local stores + Archives before relay `fetchEvent` |
| `src/pages/secondary/NotePage/index.tsx` | Background `prewarmArchivesNotePage` (replies + interaction counts) |

**Deferred:** optional IDB bundle cache service; NoteCard hover prewarm (no hover handler in card today).

---


## Suggested PR order (unchanged)

1. ~~PR0+2: Foundation + search relay~~ (done)
2. **PR1: Phase 1 followers** ← resume here after review fixes
3. PR3: Notes search merge
4. PR4: Interactions prefetch
5. PR5: Suggest
6. PR6: Metadata batch
7. PR7: Note page pipeline

---

## Agent review / Fix button — scratch pad

_Use this section to note review findings so the next session does not lose context._

### Open issues (fill in when Fix runs)

_None — minor gaps addressed 2026-06-03 (settings toggle, search resolved, note bundle profiles, feed metadata batch)._

### Fixes applied

- **`ARCHIVES_ENGAGEMENT_KEYS` included `'event'`** — stripped nested `{ event: … }` wrappers before `archivesJsonToVerifiedEvent` could unwrap them. Removed `'event'` from the set; test in `src/lib/nostr-archives-event.test.ts`.
- **`isPersistableNostrEventShape` allowed `NaN` kind** — `typeof NaN === 'number'` passed; now `Number.isFinite(ev.kind)` (and early return in `archivesJsonToVerifiedEvent` after coercion).
- **Duplicate `getEventById` in `useFetchEvent`** — removed second `resolveNoteEventFromArchives` call; `resolveThreadContextEventFromLocalStores` already hits Archives REST.
- **Settings UI** — General settings toggle for `useNostrArchivesApi`; `nostrArchivesApi.notifySettingsChanged()` on change.
- **`searchGeneral` resolved** — `tryResolveSearchViaArchives` in SearchPage submit path; `src/lib/nostr-archives-search-resolved.ts`.
- **Note page bundle profiles** — `ThreadProfileBatchProvider.seedProfiles` + `prewarmArchivesNotePage` callback on NotePage.
- **Feed profile batch** — `NoteList` uses `fetchProfilesMetadataBatch`.

---

## Resume prompt (paste into a new chat)

```
Continue Nostr Archives rollout from `.cursor/plans/nostr-archives-rollout.md`.
Nostr Archives rollout phases 0–6 are complete. Use this file for review fixes or follow-ups (e.g. `searchGeneral` resolved navigation, optional note bundle IDB cache).
Respect `.cursor/rules/nostr-archives-integration.mdc`.
Check "Agent review / Fix button" section for any open issues first.
```
