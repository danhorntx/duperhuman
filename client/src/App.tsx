import { useEffect, useState } from 'react'
import { AppLayout }    from '@/components/layout/AppLayout'
import { useGlobalKeyboard } from '@/hooks/useKeyboard'
import { useEmailStore } from '@/store/emailStore'
import { accounts as accountsApi } from '@/lib/api'
import { db }           from '@/db/db'
import type { Account } from '@/types/email'

// ─── Electron API bridge (typed, optional) ────────────────────────────────────

interface ElectronAPI {
  platform:      string
  isElectron:    boolean
  loadAccounts:  () => Promise<(Account & { password: string })[]>
  saveAccount:   (a: Account & { password: string }) => Promise<void>
  removeAccount: (id: string) => Promise<void>
}

function electronAPI(): ElectronAPI | null {
  return (window as typeof window & { electronAPI?: ElectronAPI }).electronAPI ?? null
}

// ─── First-run setup screen ───────────────────────────────────────────────────

function SetupScreen({ onSetup }: { onSetup: (account: Account, password: string) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', password: '',
    imapHost: 'imap.gmail.com', imapPort: 993, imapTls: true,
    smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false,
  })
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const account = await accountsApi.create({ ...form, username: form.email })
      onSetup(account, form.password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  const presets: Record<string, Partial<typeof form>> = {
    Gmail:    { imapHost: 'imap.gmail.com',        imapPort: 993, imapTls: true, smtpHost: 'smtp.gmail.com',        smtpPort: 587, smtpSecure: false },
    Fastmail: { imapHost: 'imap.fastmail.com',     imapPort: 993, imapTls: true, smtpHost: 'smtp.fastmail.com',     smtpPort: 587, smtpSecure: false },
    iCloud:   { imapHost: 'imap.mail.me.com',      imapPort: 993, imapTls: true, smtpHost: 'smtp.mail.me.com',      smtpPort: 587, smtpSecure: false },
    Outlook:  { imapHost: 'outlook.office365.com', imapPort: 993, imapTls: true, smtpHost: 'smtp.office365.com',    smtpPort: 587, smtpSecure: false },
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
      >
        {/* Header */}
        <div className="px-8 py-8 text-center"
          style={{ background: 'linear-gradient(135deg, #1b1938 0%, #13121f 100%)' }}
        >
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(203,183,251,0.15)', border: '1px solid rgba(203,183,251,0.3)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M17.5 1L7.5 13h5l-1 10 10-12h-5l1-10z" fill="#cbb7fb" stroke="#cbb7fb" strokeWidth="0.5" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]" style={{ letterSpacing: '-0.03em' }}>
            Connect your email
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Your credentials are stored locally and never leave your machine.
          </p>
        </div>

        <form onSubmit={submit} className="px-8 py-6 space-y-4">
          {/* Provider presets */}
          <div>
            <label className="text-label text-[var(--text-muted)] block mb-2">Provider</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(presets).map(([name, vals]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, ...vals }))}
                  className="py-1.5 px-2 rounded-lg text-xs font-medium transition-colors duration-100"
                  style={{
                    background: form.imapHost === vals.imapHost ? 'var(--accent-faint)' : 'var(--bg-overlay)',
                    border:     form.imapHost === vals.imapHost ? '1px solid var(--border-accent)' : '1px solid var(--border-subtle)',
                    color:      form.imapHost === vals.imapHost ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label text-[var(--text-muted)] block mb-1">Name</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your Name"
                className="w-full px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] bg-[var(--bg-overlay)] outline-none transition-all"
                style={{ border: '1px solid var(--border-subtle)' }}
                onFocus={e => e.target.style.borderColor = 'var(--border-accent)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border-subtle)'}
              />
            </div>
            <div>
              <label className="text-label text-[var(--text-muted)] block mb-1">Email</label>
              <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@gmail.com"
                className="w-full px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] bg-[var(--bg-overlay)] outline-none"
                style={{ border: '1px solid var(--border-subtle)' }}
                onFocus={e => e.target.style.borderColor = 'var(--border-accent)'}
                onBlur={e  => e.target.style.borderColor = 'var(--border-subtle)'}
              />
            </div>
          </div>

          <div>
            <label className="text-label text-[var(--text-muted)] block mb-1">
              App Password
              <span className="ml-2 font-normal normal-case text-[var(--text-disabled)]">(not your main password)</span>
            </label>
            <input required type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="xxxx xxxx xxxx xxxx"
              className="w-full px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] bg-[var(--bg-overlay)] outline-none font-mono"
              style={{ border: '1px solid var(--border-subtle)' }}
              onFocus={e => e.target.style.borderColor = 'var(--border-accent)'}
              onBlur={e  => e.target.style.borderColor = 'var(--border-subtle)'}
            />
          </div>

          {error && <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-100 disabled:opacity-50"
            style={{ background: 'var(--accent)', color: '#1a0617' }}
          >
            {loading ? 'Connecting…' : 'Connect Account'}
          </button>

          <p className="text-xs text-center text-[var(--text-disabled)]">
            For Gmail/Google Workspace, generate an App Password at myaccount.google.com/apppasswords
          </p>
        </form>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

function AppInner() {
  useGlobalKeyboard()
  return <AppLayout />
}

export default function App() {
  const { setAccounts, addAccount, setActiveAccount, loadEmails } = useEmailStore()
  const [ready,      setReady]      = useState(false)
  const [hasAccount, setHasAccount] = useState(false)

  useEffect(() => {
    const boot = async () => {
      try {
        // ── 1. Try to load persisted accounts (Electron) ──────────────────
        const eAPI = electronAPI()
        if (eAPI) {
          const stored = await eAPI.loadAccounts()
          if (stored.length > 0) {
            // Re-register each account with the server (server is stateless)
            const registered: Account[] = []
            for (const sa of stored) {
              try {
                const acc = await accountsApi.create(sa)
                registered.push(acc)
              } catch {
                // If already registered (server kept it), try listing
              }
            }
            // Fall back to server list if registration failed for all
            const serverAccounts = registered.length > 0
              ? registered
              : await accountsApi.list()

            if (serverAccounts.length > 0) {
              setAccounts(serverAccounts)
              await loadEmails()
              setHasAccount(true)
              setReady(true)
              return
            }
          }
        }

        // ── 2. No persisted accounts — check server (dev / web mode) ──────
        const serverAccounts = await accountsApi.list()
        if (serverAccounts.length > 0) {
          setAccounts(serverAccounts)
          await loadEmails()
          setHasAccount(true)
          setReady(true)
          return
        }

        // ── 3. Fall back to local IndexedDB cache (offline) ───────────────
        const local = await db.accounts.toArray()
        if (local.length > 0) {
          setAccounts(local)
          await loadEmails()
          setHasAccount(true)
        }
      } catch (err) {
        console.error('boot error', err)
        // Try IndexedDB fallback
        const local = await db.accounts.toArray()
        if (local.length > 0) {
          setAccounts(local)
          await loadEmails()
          setHasAccount(true)
        }
      } finally {
        setReady(true)
      }
    }
    boot()
  }, [])

  const handleFirstAccount = async (account: Account, password: string) => {
    const eAPI = electronAPI()
    if (eAPI) {
      await eAPI.saveAccount({ ...account, password })
    }
    addAccount(account)
    setActiveAccount(account.id)
    await loadEmails()
    setHasAccount(true)
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(203,183,251,0.12)', border: '1px solid rgba(203,183,251,0.2)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M17.5 1L7.5 13h5l-1 10 10-12h-5l1-10z" fill="#cbb7fb" stroke="#cbb7fb" strokeWidth="0.5" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Loading…</p>
        </div>
      </div>
    )
  }

  if (!hasAccount) {
    return <SetupScreen onSetup={handleFirstAccount} />
  }

  return <AppInner />
}
