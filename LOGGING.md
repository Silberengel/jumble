# Logging

Imwald uses `src/lib/logger.ts` for application logs. Prefer it over direct `console.*` calls in shared code.

## Overview

Current behavior:
- Development without debug mode: `info`, `warn`, and `error` are logged with formatted prefixes.
- Development with debug mode: `debug`, `info`, `warn`, `error`, component logs, and performance logs are available.
- Production: only `warn` and `error` are emitted, without formatted timestamp/caller strings.

## Usage

### Browser Console

In development mode, you can control logging from the browser console:

```javascript
imwaldLogger.setDebugMode(true)

imwaldLogger.setDebugMode(false)

imwaldLogger.isDebugEnabled()
```

`jumbleLogger` is still exposed as a legacy alias in development.

### For Code

Use the logger instead of direct console statements:

```typescript
import logger from '@/lib/logger'

// Debug logging (only shows in dev mode with debug enabled)
logger.debug('Debug information', data)

// Info logging (development only by default)
logger.info('Important information', data)

// Warning logging
logger.warn('Warning message', data)

// Error logging
logger.error('Error message', data)

// Performance logging (development only)
logger.perf('Performance metric', data)
```

## Log Levels

- **debug**: Development debugging information (disabled in production)
- **info**: Development application information
- **warn**: Warning messages (always enabled)
- **error**: Error messages (always enabled)
- **perf**: Performance metrics (development only)

## Configuration

The logger automatically configures itself based on:

1. **Environment**: Debug logging is disabled in production builds
2. **Local Storage**: `imwald-debug=true` enables debug mode (legacy: `jumble-debug=true`)
3. **Environment Variable**: `VITE_DEBUG=true` enables debug mode

## Debug Mode

To enable debug mode:

1. **In Browser Console** (development only):
   ```javascript
   imwaldLogger.setDebugMode(true)
   ```

2. **Via Local Storage**:
   ```javascript
   localStorage.setItem('imwald-debug', 'true')
   ```

3. **Via Environment Variable**:
   ```bash
   VITE_DEBUG=true npm run dev
   ```

Debug mode shows debug-level logs with timestamps, levels, and caller hints.

## Activity trace (background noise / performance)

Separate from general debug logging. Tracks **what runs when**: renders, relay REQ/subscribe waves, ingest, note-stats batches, publish, Archives API, polls, etc.

### Enable

```javascript
// Recommended: trace + debug relay detail
imwaldDebug.traceOn({ verbose: true })

// Or trace only (sampled renders, 5s counter summary)
imwaldTrace.enable()

// Persist across reload
localStorage.setItem('imwald-trace', 'true')
localStorage.setItem('imwald-debug', 'true') // optional: full logger debug
location.reload()
```

### Console commands

| Command | Purpose |
|---------|---------|
| `imwaldTrace.summary()` | Top counters right now |
| `imwaldTrace.recent(50)` | Last 50 traced events |
| `imwaldTrace.enable({ verbose: true })` | Log every event (firehose) |
| `imwaldTrace.disable()` | Stop tracing |
| `imwaldDebug.traceSummary()` | Same as summary (works even if trace off) |

### Categories

- **render** — `PostContent`, `NoteList`, `FeedProvider`, …
- **relay** — subscribe/query batches (also `[RelayOp]` when debug on)
- **ingest** — reply map, thread panel store
- **stats** — note-stats subscribe / batch / merge
- **publish** — `client.publishEvent`
- **provider** — e.g. `ReplyProvider` map size changes
- **poll** — e.g. live activities refresh
- **api** — Nostr Archives REST
- **editor** — debounced composer text sync to parent

Every **5 seconds** while trace is on, a collapsed summary table prints to the console and a text summary is appended to **Settings → Cache → Console Logs**.

### In-app Console Logs modal

- **Log filter** dropdown: All | Errors & warnings | **Trace**
- **Activity trace** switch: turns tracing on/off (persists in `localStorage` as `imwald-trace`)
- Trace lines are written directly into the console log buffer (cyan highlight in the modal)
