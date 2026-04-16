'use strict'

const { app, BrowserWindow, ipcMain, shell, Menu, session } = require('electron')
const fs = require('fs')
const http = require('http')
const path = require('path')

/** True when running from source (`electron .`); false when packaged. */
const isDev = !app.isPackaged

/** Stable loopback origin for packaged builds so YouTube embeds get a real `origin` (see YoutubeEmbeddedPlayer). */
const PACKAGED_STATIC_PORT_START = 45279
const PACKAGED_STATIC_PORT_TRIES = 40

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

let packagedStaticServer = null
/** @type {string | null} */
let packagedStaticBaseUrl = null
/** @type {Promise<string> | null} */
let packagedStaticStartPromise = null

function resolveUnderDist(distDir, pathname) {
  let rel = pathname
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  const candidate = path.resolve(distDir, rel)
  const root = path.resolve(distDir)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  if (candidate !== root && !candidate.startsWith(prefix)) return null
  return candidate
}

function createPackagedStaticHandler(distDir) {
  const indexPath = path.join(distDir, 'index.html')

  return function handleRequest(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }

    let pathname = '/'
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch {
      pathname = '/'
    }

    const sendIndex = () => {
      fs.readFile(indexPath, (err, data) => {
        if (err) {
          res.writeHead(500).end('Missing index.html')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': data.length })
        res.end(req.method === 'HEAD' ? undefined : data)
      })
    }

    const filePath = resolveUnderDist(distDir, pathname)
    if (!filePath) {
      res.writeHead(403).end()
      return
    }

    fs.stat(filePath, (err, st) => {
      if (!err && st.isFile()) {
        const ext = path.extname(filePath).toLowerCase()
        const ct = MIME[ext] || 'application/octet-stream'
        res.writeHead(200, { 'Content-Type': ct, 'Content-Length': st.size })
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        fs.createReadStream(filePath).pipe(res)
        return
      }
      sendIndex()
    })
  }
}

function startPackagedStaticServer(distDir) {
  return new Promise((resolve, reject) => {
    const handler = createPackagedStaticHandler(distDir)
    const server = http.createServer(handler)

    const listenOn = (port, attempt) => {
      if (attempt >= PACKAGED_STATIC_PORT_TRIES) {
        reject(new Error('No free port for packaged static server'))
        return
      }
      const onErr = (err) => {
        server.removeListener('error', onErr)
        if (err && err.code === 'EADDRINUSE') {
          listenOn(port + 1, attempt + 1)
        } else {
          reject(err)
        }
      }
      server.on('error', onErr)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onErr)
        packagedStaticServer = server
        const addr = server.address()
        const p = typeof addr === 'object' && addr ? addr.port : port
        packagedStaticBaseUrl = `http://127.0.0.1:${p}`
        resolve(packagedStaticBaseUrl)
      })
    }

    listenOn(PACKAGED_STATIC_PORT_START, 0)
  })
}

function ensurePackagedStaticBaseUrl() {
  if (packagedStaticBaseUrl) return Promise.resolve(packagedStaticBaseUrl)
  if (!packagedStaticStartPromise) {
    const distDir = path.join(__dirname, '..', 'dist')
    packagedStaticStartPromise = startPackagedStaticServer(distDir).catch((err) => {
      packagedStaticStartPromise = null
      throw err
    })
  }
  return packagedStaticStartPromise
}

function resolveWindowIcon() {
  const candidates = isDev
    ? [path.join(__dirname, '..', 'public', 'favicon.png')]
    : [path.join(__dirname, '..', 'dist', 'favicon.png')]
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return undefined
}

function loadRenderer(win) {
  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
    void win.loadURL(devUrl)
    if (!win.webContents.isDevToolsOpened()) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    return
  }
  void ensurePackagedStaticBaseUrl()
    .then((baseUrl) => {
      if (win.isDestroyed()) return
      const u = new URL('/', baseUrl)
      u.search = ''
      u.hash = ''
      void win.loadURL(u.href)
    })
    .catch((err) => {
      console.error('Packaged static server failed, falling back to file://', err)
      if (!win.isDestroyed()) {
        void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
      }
    })
}

/**
 * Packaged (and dev) renderer runs on http://127.0.0.1; hls.js and other fetches hit third-party
 * streams without CORS. Chromium still enforces CORS, so inject permissive CORS on subresources only.
 * LanguageTool / LibreTranslate use POST + non-simple Content-Type → preflight must see Allow-Methods /
 * Allow-Headers, not only ACAO.
 */
function relaxCorsForRendererSubresources() {
  const stripCors = new Set([
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-expose-headers',
    'access-control-max-age'
  ])
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      callback({ cancel: false, responseHeaders: details.responseHeaders })
      return
    }
    const raw = details.responseHeaders
    if (!raw) {
      callback({ cancel: false })
      return
    }
    const responseHeaders = { ...raw }
    for (const key of Object.keys(responseHeaders)) {
      if (stripCors.has(key.toLowerCase())) {
        delete responseHeaders[key]
      }
    }
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    responseHeaders['Access-Control-Allow-Methods'] = ['GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS']
    responseHeaders['Access-Control-Allow-Headers'] = [
      'Authorization,Content-Type,Accept,Accept-Language,Origin,X-Requested-With'
    ]
    callback({ cancel: false, responseHeaders })
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 400,
    minHeight: 500,
    show: false,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  loadRenderer(win)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Electron does not show Chromium’s full-page context menu; without this, users only get in-app UI
  // (e.g. selection highlight) and no Copy / Paste / Select all for text fields and content.
  win.webContents.on('context-menu', (_event, params) => {
    const template = []

    if (params.linkURL && /^https?:\/\//i.test(params.linkURL)) {
      template.push({
        label: 'Open link in browser',
        click: () => void shell.openExternal(params.linkURL)
      })
      template.push({ type: 'separator' })
    }

    template.push(
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    )

    if (isDev) {
      template.push({ type: 'separator' })
      template.push({
        label: 'Inspect element',
        click: () => win.webContents.inspectElement(params.x, params.y)
      })
    }

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

app.whenReady().then(() => {
  relaxCorsForRendererSubresources()

  ipcMain.handle('imwald:reload-app', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return false
    loadRenderer(win)
    return true
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  if (packagedStaticServer) {
    try {
      packagedStaticServer.close()
    } catch {
      // ignore
    }
    packagedStaticServer = null
    packagedStaticBaseUrl = null
    packagedStaticStartPromise = null
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
