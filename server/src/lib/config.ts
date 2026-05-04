import 'dotenv/config'

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  syncIntervalMs: parseInt(process.env.SYNC_INTERVAL_MS ?? '30000', 10),
  initialSyncLimit: parseInt(process.env.INITIAL_SYNC_LIMIT ?? '200', 10),
  allowInsecureTls: process.env.ALLOW_INSECURE_MAIL_TLS === 'true',

  // Default account from env (can also be configured via API)
  defaultAccount: process.env.IMAP_USER
    ? {
        id: 'default',
        name: process.env.SMTP_FROM_NAME ?? 'User',
        email: process.env.IMAP_USER,
        username: process.env.IMAP_USER,
        password: process.env.IMAP_PASS ?? '',
        imapHost: process.env.IMAP_HOST ?? 'imap.gmail.com',
        imapPort: parseInt(process.env.IMAP_PORT ?? '993', 10),
        imapTls: process.env.IMAP_TLS !== 'false',
        smtpHost: process.env.SMTP_HOST ?? 'smtp.gmail.com',
        smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
        smtpSecure: process.env.SMTP_SECURE === 'true',
      }
    : null,
}
