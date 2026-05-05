import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { config } from './lib/config.js'
import { accountRoutes } from './routes/accounts.js'
import { emailRoutes } from './routes/emails.js'
import { searchRoutes } from './routes/search.js'
import { registerAccount, startBackgroundSync } from './services/sync.js'
import { loadPersistedGmailAccounts } from './services/gmail.js'

const app = Fastify({
  // Pino's default async writer uses thread-stream → a worker thread whose
  // entry file (`lib/worker.js`) doesn't survive esbuild bundling, so the
  // worker silently crashes the whole utility process at startup. In dev
  // (`tsx`, real node_modules on disk) the pretty logger works fine; in
  // packaged production we disable Fastify's logger entirely. `app.log.*`
  // calls remain safe — they become no-ops.
  logger:
    config.nodeEnv === 'development'
      ? {
          level:     'info',
          transport: { target: 'pino-pretty', options: { colorize: true } },
        }
      : false,
})

// ─── Plugins ──────────────────────────────────────────────────────────────────

await app.register(cors, {
  // Allow the Vite dev server, direct localhost access, and the packaged
  // Electron renderer (which loads from the custom app:// scheme).
  origin: (origin, cb) => {
    if (
      !origin ||                                   // null / undefined origin
      origin === 'null' ||
      origin.startsWith('app://') ||               // packaged Electron renderer
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1')
    ) {
      cb(null, true)
    } else {
      cb(new Error(`CORS: blocked origin ${origin}`), false)
    }
  },
  credentials: true,
})

await app.register(sensible)

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(accountRoutes, { prefix: '/api' })
await app.register(emailRoutes, { prefix: '/api' })
await app.register(searchRoutes, { prefix: '/api' })

// Health check
app.get('/health', async () => ({ ok: true, ts: Date.now() }))

// ─── Startup: seed default account from env ───────────────────────────────────

if (config.defaultAccount) {
  const d = config.defaultAccount
  registerAccount({
    id: d.id,
    name: d.name,
    email: d.email,
    username: d.username,
    password: d.password,
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapTls: d.imapTls,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecure: d.smtpSecure,
    isActive: true,
    lastSync: 0,
  })
  app.log.info(`Default account registered: ${d.email}`)
}

for (const account of loadPersistedGmailAccounts()) {
  registerAccount(account)
  app.log.info(`Persisted Gmail account registered: ${account.email}`)
}

// ─── Start background sync ────────────────────────────────────────────────────

startBackgroundSync(config.syncIntervalMs)
app.log.info(`Background sync every ${config.syncIntervalMs}ms`)

// ─── Listen ───────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.port, host: '127.0.0.1' })
  // console.log so the message survives `logger: false` in production
  console.log(`Server ready at http://127.0.0.1:${config.port}`)
} catch (err) {
  console.error('Server failed to start:', err)
  process.exit(1)
}
