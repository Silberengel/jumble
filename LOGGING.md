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
