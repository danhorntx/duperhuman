import type { FastifyInstance } from 'fastify'
import { registerAccount, getAccount, listAccounts, removeAccount, logicalFolderName } from '../services/sync.js'
import { verifySmtp, clearTransport } from '../services/smtp.js'
import { listFolders, closeConnection } from '../services/imap.js'
import crypto from 'crypto'

// Belt-and-suspenders. Even if verifySmtp's own 20s timeout misbehaves,
// the route still resolves within 25s so the renderer is never stuck.
const ROUTE_HARD_TIMEOUT_MS = 25_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer) }) as Promise<T>
}

export async function accountRoutes(app: FastifyInstance) {
  // List accounts (passwords redacted)
  app.get('/accounts', async () => {
    return listAccounts().map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      imapHost: a.imapHost,
      imapPort: a.imapPort,
      imapTls: a.imapTls,
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      smtpSecure: a.smtpSecure,
      username: a.username,
      isActive: a.isActive,
      syncState: {
        lastFullSync: a.lastSync,
        lastDeltaSync: a.lastSync,
        status: 'idle',
        progress: 100,
      },
    }))
  })

  // Add account
  app.post<{
	    Body: {
	      id?: string; name: string; email: string; password: string
      imapHost: string; imapPort: number; imapTls: boolean
      smtpHost: string; smtpPort: number; smtpSecure: boolean
      username?: string
    }
  }>('/accounts', async (req, reply) => {
    const body = req.body
    const id = body.id ?? `acc_${crypto.randomBytes(6).toString('hex')}`

    console.log(`[POST /accounts] start id=${id} email=${body.email} host=${body.imapHost}`)

    const account = {
      id,
      name: body.name,
      email: body.email,
      username: body.username ?? body.email,
      password: body.password,
      imapHost: body.imapHost,
      imapPort: body.imapPort,
      imapTls: body.imapTls,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpSecure: body.smtpSecure,
      isActive: true,
      lastSync: 0,
    }

    // Verify SMTP connectivity before persisting. Wrapped in an outer race
    // so even if verifySmtp's own ceiling misfires, the request resolves.
    try {
      await withTimeout(verifySmtp(account), ROUTE_HARD_TIMEOUT_MS, 'SMTP verify')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[POST /accounts] verify failed id=${id} err=${msg}`)
      // Make absolutely sure we don't leave a wedged transport behind.
      clearTransport(id)
      return reply.status(400).send({ error: `SMTP connection failed: ${msg}` })
    }

    console.log(`[POST /accounts] verify ok id=${id}`)
    registerAccount(account)
    console.log(`[POST /accounts] registered id=${id}`)

    return {
      id,
      name:       account.name,
      email:      account.email,
      imapHost:   account.imapHost,
      imapPort:   account.imapPort,
      imapTls:    account.imapTls,
      smtpHost:   account.smtpHost,
      smtpPort:   account.smtpPort,
      smtpSecure: account.smtpSecure,
      username:   account.username,
      isActive:   true,
      syncState:  { lastFullSync: 0, lastDeltaSync: 0, status: 'idle', progress: 0 },
    }
  })

  // Delete account
  app.delete<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const { id } = req.params
    if (!getAccount(id)) return reply.status(404).send({ error: 'Account not found' })
    closeConnection(id)
    removeAccount(id)
    return reply.status(204).send()
  })

  // List folders for an account
  app.get<{ Params: { id: string } }>('/accounts/:id/folders', async (req, reply) => {
    const account = getAccount(req.params.id)
    if (!account) return reply.status(404).send({ error: 'Not found' })
    const folders = await listFolders(account)
    return {
      folders: folders.map(path => {
        const name = logicalFolderName(account.imapHost, path)
        return { name, path, role: folderRole(name) }
      }),
    }
  })
}

function folderRole(name: string) {
  const n = name.toLowerCase()
  if (n === 'inbox') return 'inbox'
  if (n === 'sent' || n.includes('sent mail')) return 'sent'
  if (n === 'drafts' || n.includes('draft')) return 'drafts'
  if (n === 'trash' || n.includes('bin') || n.includes('deleted')) return 'trash'
  if (n === 'spam' || n.includes('junk')) return 'spam'
  if (n === 'starred') return 'starred'
  if (n === 'all mail' || n === 'archive') return 'archive'
  return undefined
}
