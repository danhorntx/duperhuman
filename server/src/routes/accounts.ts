import type { FastifyInstance } from 'fastify'
import { registerAccount, getAccount, listAccounts, removeAccount, logicalFolderName, type StoredAccount } from '../services/sync.js'
import { verifySmtp, clearTransport } from '../services/smtp.js'
import { listFolders, closeConnection } from '../services/imap.js'
import { exchangeCode, getGoogleUser, listGmailLabels, persistGmailAccount, removePersistedGmailAccount } from '../services/gmail.js'
import { config } from '../lib/config.js'
import crypto from 'crypto'

// Belt-and-suspenders. Even if verifySmtp's own 20s timeout misbehaves,
// the route still resolves within 25s so the renderer is never stuck.
const ROUTE_HARD_TIMEOUT_MS = 25_000
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60_000
const googleOAuthStates = new Set<string>()

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer) }) as Promise<T>
}

function redactedAccount(account: StoredAccount) {
  return {
    id: account.id,
    provider: account.provider ?? 'imap',
    name: account.name,
    email: account.email,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapTls: account.imapTls,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    smtpSecure: account.smtpSecure,
    username: account.username,
    gmailHistoryId: account.gmailHistoryId,
    isActive: account.isActive,
    syncState: {
      lastFullSync: account.lastSync,
      lastDeltaSync: account.lastSync,
      status: 'idle',
      progress: 100,
    },
  }
}

export async function accountRoutes(app: FastifyInstance) {
  // List accounts (passwords redacted)
  app.get('/accounts', async () => {
    return listAccounts().map(redactedAccount)
  })

  // Add account
  app.post<{
	    Body: {
	      id?: string; name: string; email: string; password?: string
	      provider?: 'imap' | 'gmail'
	      oauthRefreshToken?: string
	      gmailHistoryId?: string
	      imapHost: string; imapPort: number; imapTls: boolean
	      smtpHost: string; smtpPort: number; smtpSecure: boolean
      username?: string
    }
  }>('/accounts', async (req, reply) => {
    const body = req.body
    const id = body.id ?? `acc_${crypto.randomBytes(6).toString('hex')}`

    console.log(`[POST /accounts] start id=${id} email=${body.email} host=${body.imapHost}`)

    if (body.provider === 'gmail' && !body.oauthRefreshToken) {
      const existing = getAccount(id)
      if (existing?.provider === 'gmail') {
        console.log(`[POST /accounts] reused encrypted Gmail credentials id=${id}`)
        return redactedAccount(existing)
      }
      return reply.status(400).send({ error: 'Gmail OAuth credentials are missing. Connect with Google again.' })
    }

	    const account = {
	      id,
	      name: body.name,
	      email: body.email,
	      username: body.username ?? body.email,
	      password: body.password ?? '',
	      provider: body.provider ?? 'imap',
	      imapHost: body.imapHost,
      imapPort: body.imapPort,
      imapTls: body.imapTls,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpSecure: body.smtpSecure,
	      isActive: true,
	      lastSync: 0,
	      oauthRefreshToken: body.oauthRefreshToken,
	      gmailHistoryId: body.gmailHistoryId,
	    }

	    if (account.provider !== 'gmail') {
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
	    }

    console.log(`[POST /accounts] verify ok id=${id}`)
    registerAccount(account)
    console.log(`[POST /accounts] registered id=${id}`)

    return redactedAccount(account)
  })

  // Delete account
  app.delete<{ Params: { id: string } }>('/accounts/:id', async (req, reply) => {
    const { id } = req.params
    if (!getAccount(id)) return reply.status(404).send({ error: 'Account not found' })
	    closeConnection(id)
	    removePersistedGmailAccount(id)
	    removeAccount(id)
    return reply.status(204).send()
  })

  // List folders for an account
	  app.get<{ Params: { id: string } }>('/accounts/:id/folders', async (req, reply) => {
	    const account = getAccount(req.params.id)
	    if (!account) return reply.status(404).send({ error: 'Not found' })
	    if (account.provider === 'gmail') {
	      const labels = await listGmailLabels(account)
	      return {
	        folders: labels.map(label => ({
	          name: gmailLabelName(label.id, label.name),
	          path: label.id,
	          role: folderRole(gmailLabelName(label.id, label.name)),
	        })),
	      }
	    }
	    const folders = await listFolders(account)
    return {
      folders: folders.map(path => {
        const name = logicalFolderName(account.imapHost, path)
        return { name, path, role: folderRole(name) }
      }),
    }
	  })

	  app.get('/auth/google/start', async (_req, reply) => {
	    if (!config.googleOAuth.clientId || !config.googleOAuth.clientSecret) {
	      return reply.status(400).send({ error: 'Google OAuth is not configured' })
	    }
	    const state = crypto.randomBytes(12).toString('hex')
	    googleOAuthStates.add(state)
	    setTimeout(() => googleOAuthStates.delete(state), GOOGLE_OAUTH_STATE_TTL_MS).unref()
	    const qs = new URLSearchParams({
	      client_id: config.googleOAuth.clientId,
	      redirect_uri: config.googleOAuth.redirectUri,
	      response_type: 'code',
	      access_type: 'offline',
	      prompt: 'consent',
	      state,
	      scope: [
	        'https://www.googleapis.com/auth/gmail.modify',
	        'https://www.googleapis.com/auth/gmail.send',
	        'https://www.googleapis.com/auth/userinfo.email',
	        'https://www.googleapis.com/auth/userinfo.profile',
	      ].join(' '),
	    })
	    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${qs}`)
	  })

	  app.get<{ Querystring: { code?: string; error?: string; state?: string } }>('/auth/google/callback', async (req, reply) => {
	    if (req.query.error) return reply.type('text/html').send(`<h1>Google sign-in failed</h1><p>${req.query.error}</p>`)
	    if (!req.query.code) return reply.status(400).send({ error: 'Missing OAuth code' })
	    if (!req.query.state || !googleOAuthStates.delete(req.query.state)) {
	      return reply.status(400).send({ error: 'Invalid OAuth state' })
	    }
	    const tokens = await exchangeCode(req.query.code)
	    if (!tokens.refresh_token) {
	      return reply.type('text/html').send('<h1>Google sign-in needs consent</h1><p>Please try again and approve offline access.</p>')
	    }
	    const user = await getGoogleUser(tokens.access_token)
	    const id = `gmail_${crypto.createHash('sha1').update(user.email).digest('hex').slice(0, 12)}`
		    const account = {
		      id,
		      provider: 'gmail' as const,
	      name: user.name,
	      email: user.email,
	      username: user.email,
	      password: '',
	      imapHost: 'gmail-api',
	      imapPort: 0,
	      imapTls: true,
	      smtpHost: 'gmail-api',
	      smtpPort: 0,
	      smtpSecure: true,
	      isActive: true,
	      lastSync: 0,
	      oauthRefreshToken: tokens.refresh_token,
	      gmailAccessToken: tokens.access_token,
	      gmailAccessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
	    }
	    registerAccount(account)
	    persistGmailAccount(account)
	    return reply.type('text/html').send('<h1>Duperhuman connected Gmail</h1><p>You can close this window and return to Duperhuman.</p>')
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

function gmailLabelName(id: string, name: string) {
  const map: Record<string, string> = {
    INBOX: 'INBOX',
    SENT: 'Sent',
    DRAFT: 'Drafts',
    TRASH: 'Trash',
    SPAM: 'Spam',
    STARRED: 'Starred',
  }
  return map[id] ?? name
}
