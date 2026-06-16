<div align="center">
  <img src="./resources/banner.png" alt="Imwald" width="650" />
  <p>logo designed by <a href="http://wolfertdan.com/">Daniel David</a></p>
</div>

# Imwald

**Maintainer: [Silberengel](https://github.com/Silberengel)** · Evolved from [Cody Tseng’s Jumble](https://github.com/CodyTseng/jumble)

A Nostr web client focused on relay feeds, discovery, and spells. The public instance lives at [jumble.imwald.eu](https://jumble.imwald.eu).

---

## Product Shape

### Home vs feed

- **Home** is the **Explore** experience: relay directory, Following’s Favorites, and related discovery.
- **Feed** is a dedicated primary area for **favorite relays**, displaying their diverse social content as a feed: short text notes (microblogging), longform articles, wiki pages, media notes, calendar entries, etc.

### RSS

- **RSS** is a **separate primary page** with its own title bar, refresh, and filters
- Sidebar **RSS** opens that page directly when enabled in settings.

### Spells & faux feeds

- Built-in **faux spells** (notifications, discussions, following, follow packs, media, interests, bookmarks, calendar) all run through the **same `NoteList` path** as user-defined kind-777 spells.
- Sidebar **Notifications** and **Discussions** navigate to the correct faux feed with proper **active** states; primary page props are merged through the lazy `Suspense` boundary correctly.
- **Following** faux feed respects global kind filters and Notes/Replies mode; **bookmarks** faux uses classic **`e`-tag** ids from the bookmark list.

### Profiles

- **Pinned** notes (kind `10001` lists) appear first with a **pin** marker; the rest of the profile timeline uses **main-feed-style** kind and reply rules, with a clear split when pins exist.
- Profiles with **no pins** behave like a normal timeline (no empty pin chrome).

### Explore quality-of-life

- **Search for Relays** on Explore (below Favorite Relays): paste `wss://…` or a host, submit, and open the relay page with the same navigation as the relay cards. While typing, **suggestions** come from the **NIP-66 monitoring (public lively) list** on partial or full URL/host matches; you can still submit any URL the app does not know.

### Other

- Sidebar layout tuned for **long translations** (e.g. German) so labels don’t sit on the divider.

---

## Features

- **Relay feeds:** Browse content through relays, sets, and favorites
- **Relay-friendly requests:** Efficient subscriptions where possible
- **Relay sets:** Switch between saved relay groups
- **Spells:** Portable filters (kind 777) plus built-in faux feeds above

## Screenshots

<img src="./screenshots/01.png" alt="Imwald screenshot 01" width="650" />
<div> 
  <img src="./screenshots/02.png" alt="Imwald screenshot 02" width="200" />
  <img src="./screenshots/03.png" alt="Imwald screenshot 03" width="200" />
  <img src="./screenshots/04.png" alt="Imwald screenshot 04" width="200" />
</div>

## Upstream & related forks

- **Original project:** [CodyTseng/jumble](https://github.com/CodyTseng/jumble) — upstream design and history.
- **This repository:** [Silberengel/jumble](https://github.com/Silberengel/jumble) — Imwald source and releases.
- Other public forks (examples): [grouped-notes.dtonon.com](https://grouped-notes.dtonon.com/), [jumblekat.shakespeare.wtf](https://jumblekat.shakespeare.wtf/).

## Run locally

```bash
git clone https://github.com/Silberengel/jumble.git
cd jumble
npm install
npm run dev
```

## Run with Docker

```bash
git clone https://github.com/Silberengel/jumble.git
cd jumble
docker compose up --build -d
```

Then open: http://localhost:8089

## Tor & I2P relays (operators and power users)

Browsers cannot open SOCKS connections or resolve `.onion` / `.i2p` hostnames. Imwald therefore **terminates hidden-network WebSocket relays on your machine** and forwards them through local Tor/I2P SOCKS.

### Where it works

| Runtime | Hidden relays |
|---------|----------------|
| `npm run dev` | Yes — Vite dev server SOCKS bridge (`/__imwald/hidden-relay`) |
| Public website (`jumble.imwald.eu`) | **No** — use clearnet `wss://` relays |

Check status under **Settings → Relays and Storage → Tor & I2P**.

### Local requirements

1. **Tor** — system daemon on `127.0.0.1:9050`, *or* Tor Browser on `127.0.0.1:9150` (auto-detected; daemon is tried first).
2. **I2P** — router SOCKS outproxy on `127.0.0.1:7657` (default for Java I2P).

Example relay URL forms:

```text
ws://your-relay.onion:7778
ws://abcdef…b32.i2p:7778
```

Add them to **Read & Write relays** or **Favorite relays** like any clearnet URL.

### SOCKS overrides

If your router uses non-default ports:

```bash
export IMWALD_TOR_SOCKS=socks5://127.0.0.1:9150
export IMWALD_I2P_SOCKS=socks5://127.0.0.1:7657
npm run dev
```

### Verify connectivity

```bash
# Hidden-network relay URL planning + gateway tests (no live publish)
npm run test:run -- src/lib/hidden-network-relay.test.ts
```

First hidden-network connections can take **30–90 seconds** while Tor/I2P builds circuits.

## License

MIT
