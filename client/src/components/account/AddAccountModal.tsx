import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { XIcon } from '@phosphor-icons/react'
import { accounts as accountsApi } from '@/lib/api'
import { useEmailStore } from '@/store/emailStore'
import type { Account } from '@/types/email'

interface Props {
  onClose: () => void
}

const PRESETS: Record<string, { imapHost: string; imapPort: number; imapTls: boolean; smtpHost: string; smtpPort: number; smtpSecure: boolean }> = {
  Gmail:    { imapHost: 'imap.gmail.com',            imapPort: 993, imapTls: true,  smtpHost: 'smtp.gmail.com',            smtpPort: 587, smtpSecure: false },
  Fastmail: { imapHost: 'imap.fastmail.com',         imapPort: 993, imapTls: true,  smtpHost: 'smtp.fastmail.com',         smtpPort: 587, smtpSecure: false },
  iCloud:   { imapHost: 'imap.mail.me.com',          imapPort: 993, imapTls: true,  smtpHost: 'smtp.mail.me.com',          smtpPort: 587, smtpSecure: false },
  Outlook:  { imapHost: 'outlook.office365.com',     imapPort: 993, imapTls: true,  smtpHost: 'smtp.office365.com',        smtpPort: 587, smtpSecure: false },
}

export function AddAccountModal({ onClose }: Props) {
  const addAccount    = useEmailStore(s => s.addAccount)
  const setActiveAccount = useEmailStore(s => s.setActiveAccount)

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
      const account: Account = await accountsApi.create({ ...form, username: form.email })

      // Persist credentials (Electron) or skip gracefully (web)
      const api = (window as typeof window & { electronAPI?: { saveAccount: (a: Account & { password: string }) => Promise<void> } }).electronAPI
      if (api?.saveAccount) {
        await api.saveAccount({ ...account, password: form.password } as Account & { password: string })
      }

      addAccount(account)
      setActiveAccount(account.id)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed — check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <motion.div
          className="w-full max-w-md rounded-2xl overflow-hidden"
          style={{
            background: 'var(--bg-elevated)',
            border:     '1px solid var(--border-subtle)',
            boxShadow:  '0 32px 100px rgba(0,0,0,0.6)',
          }}
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-5"
            style={{ background: 'linear-gradient(135deg, #1b1938 0%, #13121f 100%)', borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(203,183,251,0.15)', border: '1px solid rgba(203,183,251,0.3)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M17.5 1L7.5 13h5l-1 10 10-12h-5l1-10z" fill="#cbb7fb" stroke="#cbb7fb" strokeWidth="0.5" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]" style={{ letterSpacing: '-0.02em' }}>
                  Add another account
                </h2>
                <p className="text-xs text-[var(--text-muted)]">Credentials stay on your machine</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-100"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-overlay)' }}
            >
              <XIcon size={14} />
            </button>
          </div>

          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            {/* Provider presets */}
            <div>
              <label className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wider block mb-2">Provider</label>
              <div className="grid grid-cols-4 gap-1.5">
                {Object.entries(PRESETS).map(([name, vals]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, ...vals }))}
                    className="py-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-100"
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
              <Field label="Name" value={form.name}     onChange={v => setForm(f => ({ ...f, name: v }))}     placeholder="Your Name" />
              <Field label="Email" value={form.email}   onChange={v => setForm(f => ({ ...f, email: v }))}   placeholder="you@gmail.com" type="email" />
            </div>

            <Field
              label="App Password"
              hint="not your main password"
              value={form.password}
              onChange={v => setForm(f => ({ ...f, password: v }))}
              placeholder="xxxx xxxx xxxx xxxx"
              type="password"
              mono
            />

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-100"
                style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all duration-100 disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#1a0617' }}
              >
                {loading ? 'Connecting…' : 'Add Account'}
              </button>
            </div>

            <p className="text-[11px] text-center text-[var(--text-disabled)]">
              Gmail requires an App Password — generate one at myaccount.google.com/apppasswords
            </p>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Tiny reusable field ──────────────────────────────────────────────────────

function Field({
  label, hint, value, onChange, placeholder, type = 'text', mono = false,
}: {
  label: string; hint?: string; value: string
  onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean
}) {
  return (
    <div>
      <label className="text-[11px] text-[var(--text-muted)] font-medium uppercase tracking-wider block mb-1.5">
        {label}
        {hint && <span className="ml-1.5 normal-case font-normal text-[var(--text-disabled)]">({hint})</span>}
      </label>
      <input
        required
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg text-sm text-[var(--text-primary)] bg-[var(--bg-overlay)] outline-none transition-all ${mono ? 'font-mono' : ''}`}
        style={{ border: '1px solid var(--border-subtle)' }}
        onFocus={e => (e.target.style.borderColor = 'var(--border-accent)')}
        onBlur={e  => (e.target.style.borderColor = 'var(--border-subtle)')}
      />
    </div>
  )
}
