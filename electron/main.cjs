'use strict'

const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron')
const fs = require('fs')
const path = require('path')

/** True when running from source (`electron .`); false when packaged. */
const isDev = !app.isPackaged

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
  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
