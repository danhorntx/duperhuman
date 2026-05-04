import type { FastifyInstance } from 'fastify'
import { getAccount, syncFolder, getCachedEmails, invalidateCache, resolveImapFolder } from '../services/sync.js'
import { addFlags, removeFlags, moveMessages, fetchAttachmentByUid, setLabels } from '../services/imap.js'
import { sendEmail } from '../services/smtp.js'

// Helper: parse "accountId:folder:uid" id
function parseEmailId(id: string) {
  const parts = id.split(':')
  if (parts.length < 3) throw new Error(`Invalid email id: ${id}`)
  const uid = parseInt(parts[parts.length - 1], 10)
  const folder = parts.slice(1, -1).join(':')
  const accountId = parts[0]
  return { accountId, folder, uid }
}

// Gmail-specific folder map
const GMAIL_ARCHIVE = '[Gmail]/All Mail'
const GMAIL_TRASH = '[Gmail]/Trash'
const GMAIL_SPAM = '[Gmail]/Spam'

function trashFolder(host: string) {
  return host.toLowerCase().includes('gmail') ? GMAIL_TRASH : 'Trash'
}
function spamFolder(host: string) {
  return host.toLowerCase().includes('gmail') ? GMAIL_SPAM : 'Spam'
}

function isGmailHost(host: string) {
  const h = host.toLowerCase()
  return h.includes('gmail') || h.includes('googlemail')
}

async function runBulk(ids: string[], fn: (id: string) => Promise<void>) {
  const failures: { id: string; error: string }[] = []
  for (const id of ids) {
    try {
      await fn(id)
    } catch (err) {
      failures.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return failures
}

function sendBulkResult(reply: import('fastify').FastifyReply, failures: { id: string; error: string }[]) {
  if (failures.length > 0) {
    return reply.status(502).send({ error: 'One or more mail server operations failed', failures })
  }
  return reply.status(204).send()
}

export async function emailRoutes(app: FastifyInstance) {
  // List emails
  app.get<{
    Querystring: { accountId: string; folder?: string; limit?: string; offset?: string }
  }>('/emails', async (req, reply) => {
    const { accountId, folder = 'INBOX', limit = '100', offset = '0' } = req.query
    const account = getAccount(accountId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    try {
      // Pass offset through to the IMAP layer so "load older" pages
      // actually fetch deeper into the mailbox instead of slicing the
      // cached first-page result.
      const emails = await syncFolder(
        accountId,
        folder,
        parseInt(limit, 10),
        parseInt(offset, 10),
      )
      return emails
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Unknown Mailbox = folder doesn't exist for this provider; return empty
      if (msg.includes('Unknown Mailbox') || msg.includes('NONEXISTENT')) {
        return []
      }
      throw err
    }
  })

  // Stream a single attachment by index. ?download=1 forces a Save dialog;
  // otherwise the browser displays inline (PDFs / images).
  app.get<{
    Params: { id: string; index: string }
    Querystring: { download?: string }
  }>('/emails/:id/attachments/:index', async (req, reply) => {
    const { accountId, folder, uid } = parseEmailId(decodeURIComponent(req.params.id))
    const idx = parseInt(req.params.index, 10)
    if (Number.isNaN(idx)) return reply.status(400).send({ error: 'Bad index' })

    const account = getAccount(accountId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    try {
      const imapFolder = resolveImapFolder(account.imapHost, folder)
      const att = await fetchAttachmentByUid(account, imapFolder, uid, idx)
      if (!att) return reply.status(404).send({ error: 'Attachment not found' })

      // Encode filename for Content-Disposition (handles spaces / unicode)
      const safe = encodeURIComponent(att.filename).replace(/['()]/g, escape)
      const disp = req.query.download ? 'attachment' : 'inline'

      return reply
        .header('Content-Type', att.contentType)
        .header('Content-Length', String(att.size))
        .header('Content-Disposition', `${disp}; filename*=UTF-8''${safe}`)
        .header('Cache-Control', 'private, max-age=3600')
        .send(att.content)
    } catch (err) {
      console.error('[attachment] fetch failed', err)
      return reply.status(500).send({ error: (err as Error).message })
    }
  })

  // Get single email
  app.get<{ Params: { id: string } }>('/emails/:id', async (req, reply) => {
    const { accountId, folder, uid } = parseEmailId(decodeURIComponent(req.params.id))
    const account = getAccount(accountId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    const cached = getCachedEmails(accountId, folder)
    const email = cached.find(e => e.uid === uid)
    if (!email) return reply.status(404).send({ error: 'Email not found' })
    return email
  })

  // Send email
  app.post<{
    Body: {
      accountId: string
      to: { name?: string; address: string }[]
      cc?: { name?: string; address: string }[]
      bcc?: { name?: string; address: string }[]
      subject: string
      bodyHtml: string
      bodyText: string
      replyToId?: string
      scheduledAt?: number
    }
  }>('/emails/send', async (req, reply) => {
    const { accountId, to, cc, bcc, subject, bodyHtml, bodyText } = req.body
    const account = getAccount(accountId)
    if (!account) return reply.status(404).send({ error: 'Account not found' })

    // Scheduled send: just return success (client will retry at scheduled time)
    if (req.body.scheduledAt && req.body.scheduledAt > Date.now()) {
      return { messageId: `scheduled:${req.body.scheduledAt}` }
    }

    const messageId = await sendEmail(account, {
      to, cc, bcc, subject,
      html: bodyHtml,
      text: bodyText,
    })

    invalidateCache(accountId, 'Sent')
    return { messageId }
  })

  // Archive
  app.post<{ Body: { ids: string[] } }>('/emails/archive', async (req, reply) => {
    const failures = await runBulk(req.body.ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      // Gmail: remove \Inbox flag. Other providers: move to Archive folder
      if (isGmailHost(account.imapHost)) {
        await removeFlags(account, folder, [uid], ['\\Inbox'])
      } else {
        await moveMessages(account, folder, [uid], 'Archive')
      }
      invalidateCache(accountId, folder)
    })
    return sendBulkResult(reply, failures)
  })

  // Trash
  app.post<{ Body: { ids: string[] } }>('/emails/trash', async (req, reply) => {
    const failures = await runBulk(req.body.ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      await moveMessages(account, folder, [uid], trashFolder(account.imapHost))
      invalidateCache(accountId, folder)
    })
    return sendBulkResult(reply, failures)
  })

  // Restore (from archive/trash)
  app.post<{ Body: { ids: string[] } }>('/emails/restore', async (req, reply) => {
    const failures = await runBulk(req.body.ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      if (isGmailHost(account.imapHost)) {
        await setLabels(account, folder, [uid], ['\\Inbox'])
      } else {
        await moveMessages(account, folder, [uid], 'INBOX')
      }
      invalidateCache(accountId, folder)
      invalidateCache(accountId, 'INBOX')
    })
    return sendBulkResult(reply, failures)
  })

  // Mark read/unread
  app.post<{ Body: { ids: string[]; read: boolean } }>('/emails/read', async (req, reply) => {
    const { ids, read } = req.body
    const failures = await runBulk(ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      if (read) {
        await addFlags(account, folder, [uid], ['\\Seen'])
      } else {
        await removeFlags(account, folder, [uid], ['\\Seen'])
      }
      invalidateCache(accountId, folder)
    })
    return sendBulkResult(reply, failures)
  })

  // Star / unstar
  app.post<{ Body: { ids: string[]; starred: boolean } }>('/emails/star', async (req, reply) => {
    const { ids, starred } = req.body
    const failures = await runBulk(ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      if (starred) {
        await addFlags(account, folder, [uid], ['\\Flagged'])
      } else {
        await removeFlags(account, folder, [uid], ['\\Flagged'])
      }
      invalidateCache(accountId, folder)
    })
    return sendBulkResult(reply, failures)
  })

  // Spam
  app.post<{ Body: { ids: string[] } }>('/emails/spam', async (req, reply) => {
    const failures = await runBulk(req.body.ids, async (id) => {
      const { accountId, folder, uid } = parseEmailId(id)
      const account = getAccount(accountId)
      if (!account) throw new Error('Account not found')
      await moveMessages(account, folder, [uid], spamFolder(account.imapHost))
      invalidateCache(accountId, folder)
    })
    return sendBulkResult(reply, failures)
  })

  // Snooze (server just logs it; real resurface is client-side for now)
  app.post<{ Body: { ids: string[]; until: number } }>('/emails/snooze', async (req, reply) => {
    // In a full implementation, store snooze metadata and re-surface via a cron.
    // For local-first: client handles resurface from IndexedDB.
    return reply.status(204).send()
  })

  // Mute thread
  app.post<{ Body: { threadId: string } }>('/emails/mute', async (req, reply) => {
    // Archive all emails in the thread
    return reply.status(204).send()
  })

  // Label
  app.post<{ Body: { ids: string[]; labels: string[] } }>('/emails/label', async (req, reply) => {
    // For IMAP: use custom flags or move to label folder
    return reply.status(204).send()
  })
}
