/**
 * Electron main process
 * Dev:  loads http://localhost:3000 (Vite dev server)
 * Prod: registers an app:// protocol that serves the React build from the
 *       asar with correct MIME types, then loads app://duperhuman/.
 *       Forks the bundled server.mjs in parallel for /api/* on :3001.
 */
const { app, BrowserWindow, shell, nativeTheme, Menu, safeStorage, ipcMain, utilityProcess, protocol, net } = require('electron')
const path = require('path')
const fs   = require('fs')
const http = require('http')
const { pathToFileURL } = require('url')

// ─── Custom protocol registration ─────────────────────────────────────────────
// Must run *before* app is ready. We serve the React build from app://duperhuman/
// in production. Loading via a custom standard scheme avoids every file:// quirk
// (MIME, module-script crossorigin, CORS) and lets us read the built assets
// straight out of the asar via Electron's fs patch.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard:        true,   // proper URL parsing + relative path resolution
      // NOTE: do NOT set `secure: true`. Marking the scheme secure makes
      // Chromium treat app:// like https:// and block any fetch to plain
      // http:// (mixed content). The renderer needs to call the embedded
      // server on http://127.0.0.1:3001, so app:// must stay "insecure".
      supportFetchAPI: true,
      stream:          true,
      corsEnabled:     true,
    },
  },
])

// ─── Single-instance lock ─────────────────────────────────────────────────────
// Prevents macOS from launching 30 windows when the dock icon is clicked rapidly

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  // Someone tried to open a second instance — focus the existing window instead
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

const isDev = !app.isPackaged

let mainWindow    = null
let serverProcess = null
let windowCreating = false   // guard against concurrent createWindow() calls

// ─── Persistent account storage ───────────────────────────────────────────────

function accountsFilePath() {
  return path.join(app.getPath('userData'), 'accounts.json')
}

function loadStoredAccounts() {
  try {
    const raw  = fs.readFileSync(accountsFilePath(), 'utf-8')
    const list = JSON.parse(raw)
    return list.map(a => {
      let password = a.password ?? ''
      if (a.encryptedPassword && safeStorage.isEncryptionAvailable()) {
        try {
          password = safeStorage.decryptString(Buffer.from(a.encryptedPassword, 'base64'))
        } catch { /* corrupted entry — skip decryption */ }
      }
      const { encryptedPassword, ...rest } = a          // strip encrypted blob
      return { ...rest, password }
    })
  } catch {
    return []
  }
}

function persistAccount(account) {
  // Read fresh, upsert, write back
  let list = []
  try { list = JSON.parse(fs.readFileSync(accountsFilePath(), 'utf-8')) } catch {}

  let toStore = { ...account }
  if (safeStorage.isEncryptionAvailable() && account.password) {
    toStore.encryptedPassword = safeStorage.encryptString(account.password).toString('base64')
    delete toStore.password   // never store plaintext when encryption is available
  }

  const idx = list.findIndex(a => a.id === account.id)
  if (idx >= 0) list[idx] = toStore
  else list.push(toStore)

  fs.mkdirSync(path.dirname(accountsFilePath()), { recursive: true })
  fs.writeFileSync(accountsFilePath(), JSON.stringify(list, null, 2), 'utf-8')
}

function deleteStoredAccount(id) {
  let list = []
  try { list = JSON.parse(fs.readFileSync(accountsFilePath(), 'utf-8')) } catch {}
  fs.writeFileSync(accountsFilePath(), JSON.stringify(list.filter(a => a.id !== id), null, 2), 'utf-8')
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('accounts:load',   ()          => loadStoredAccounts())
ipcMain.handle('accounts:save',   (_, account) => { persistAccount(account);     return true })
ipcMain.handle('accounts:remove', (_, id)      => { deleteStoredAccount(id);     return true })

// ─── Embedded server (production only) ───────────────────────────────────────

function startServer() {
  if (isDev) return   // concurrently handles this in dev

  const serverPath = path.join(process.resourcesPath, 'server.mjs')

  if (!fs.existsSync(serverPath)) {
    console.error(`[main] server bundle missing: ${serverPath}`)
    return
  }

  // IMPORTANT: spread process.env first. utilityProcess.fork *replaces* the
  // child's env when an `env` object is passed — leaving PATH/HOME/TMPDIR/etc.
  // unset breaks TLS, DNS, dotenv, and IMAP handshakes.
  serverProcess = utilityProcess.fork(serverPath, [], {
    env: {
      ...process.env,
	      PORT:     '3001',
	      NODE_ENV: 'production',
	      DUPERHUMAN_USER_DATA: app.getPath('userData'),
	    },
    stdio: 'pipe',
  })
  serverProcess.stdout?.on('data', d => console.log('[server]', d.toString().trim()))
  serverProcess.stderr?.on('data', d => console.error('[server]', d.toString().trim()))
  serverProcess.on('exit', code => {
    if (code) console.error(`[server] exited with code ${code}`)
    serverProcess = null
  })
}

// ─── app:// protocol handler ─────────────────────────────────────────────────
// Serves the React build out of the asar with correct MIME types. Falls back to
// index.html for any path that doesn't look like a static asset (SPA routing).
function registerAppProtocol() {
  const distRoot = path.join(__dirname, '..', 'client', 'dist')

  protocol.handle('app', async (request) => {
    try {
      const url      = new URL(request.url)
      let   pathname = decodeURIComponent(url.pathname)

      // Strip leading slash, default to index.html for the root
      if (pathname === '/' || pathname === '') {
        pathname = '/index.html'
      }

      // SPA fallback: treat any extension-less path as a client route
      const hasExtension = path.extname(pathname).length > 0
      const target       = hasExtension ? pathname : '/index.html'
      const filePath     = path.normalize(path.join(distRoot, target))

      // Path traversal guard
      if (!filePath.startsWith(distRoot)) {
        return new Response('Forbidden', { status: 403 })
      }

      return await net.fetch(pathToFileURL(filePath).toString())
    } catch (err) {
      console.error('[app://] handler error', err)
      return new Response(`Internal error: ${err.message}`, { status: 500 })
    }
  })
}

async function waitForServer(maxMs = 12000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const ok = await new Promise(resolve => {
      const req = http.get('http://127.0.0.1:3001/health', res => {
        res.resume()
        resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.setTimeout(500, () => { req.destroy(); resolve(false) })
    })
    if (ok) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

// ─── BrowserWindow ────────────────────────────────────────────────────────────

async function createWindow() {
  // Prevent stacking: only one window at a time
  if (mainWindow !== null || windowCreating) return
  windowCreating = true

  nativeTheme.themeSource = 'dark'

  mainWindow = new BrowserWindow({
    width:    1440,
    height:   960,
    minWidth: 860,
    minHeight: 600,
    titleBarStyle:         process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition:  { x: 16, y: 16 },
    backgroundColor:       '#0d0c1a',
    vibrancy:              process.platform === 'darwin' ? 'under-window' : undefined,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      // Both dev and prod load over http origins — keep webSecurity on always.
      webSecurity:      true,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => {
    windowCreating = false
    mainWindow.show()
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('closed', () => { mainWindow = null; windowCreating = false })

  // External links → system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000')
  } else {
    // In prod the React build is served by the main-process custom protocol
    // handler above. The /api/* surface is still on http://127.0.0.1:3001.
    await mainWindow.loadURL('app://duperhuman/')
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Register activate before whenReady so it catches the initial macOS launch activation
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  if (!isDev) registerAppProtocol()
  startServer()
  if (!isDev) {
    const ready = await waitForServer(12000)
    if (!ready) console.error('[main] Server did not become ready in time — opening window anyway')
  }
  await createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null }
})
