# Superhuman Clone

A private, self-hostable email client that recreates Superhuman's aesthetic and keyboard-first experience. Connects to Gmail through Google OAuth or to your own IMAP/SMTP accounts.

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Vite + React + TypeScript | Sub-millisecond HMR, no SSR overhead |
| State | Zustand | Minimal, synchronous, no boilerplate |
| Local DB | Dexie (IndexedDB) | Local-first cache, instant load |
| Search | MiniSearch | 200KB, sub-5ms full-text search |
| Animations | Framer Motion | Spring physics, no janky transitions |
| Icons | Phosphor Icons | Light-weight, consistent stroke |
| Backend | Fastify + Node.js | Fastest Node HTTP framework |
| Gmail | Google OAuth + Gmail API | No app password needed for Gmail accounts |
| IMAP | node-imap + mailparser | Battle-tested IMAP bridge |
| SMTP | nodemailer | Universal mailer |
| Fonts | Geist / Geist Mono | Closest public match to Superhuman's typography feel |

## Architecture

```
superhuman-clone/
├── client/               # Vite + React SPA
│   └── src/
│       ├── components/   # UI components (AppLayout, Sidebar, EmailList, etc.)
│       ├── store/        # Zustand stores (emailStore, uiStore)
│       ├── db/           # Dexie IndexedDB schema + helpers
│       ├── hooks/        # useKeyboard, useVirtualList
│       ├── lib/          # API client, MiniSearch wrapper, utils
│       └── types/        # Shared TypeScript interfaces
└── server/               # Fastify Gmail API + IMAP/SMTP bridge
    └── src/
        ├── routes/       # /accounts, /emails, /search, /sync
        └── services/     # gmail.ts, imap.ts, smtp.ts, sync.ts (cache + polling)
```

**Local-first flow:** On load the UI reads from IndexedDB instantly (0ms), then a background sync fetches from the Gmail API or IMAP and merges updates. All mutations (archive, delete, star, read) apply optimistically to the local store first, then flush to the server.

## 10-Step Setup

### Prerequisites
- Node.js ≥ 20
- A Google Cloud OAuth client for Gmail, or an email account with IMAP/SMTP access and an **App Password** (not your main password)

---

**Step 1 — Clone / copy the project**
```bash
cd superhuman-clone
```

**Step 2 — Install all dependencies**
```bash
npm install
```

**Step 3 — Create your `.env` file**
```bash
cp .env.example .env
```

**Step 4 — Fill in your credentials**

For Gmail, OAuth is the recommended path. In Google Cloud Console:

1. Create or select a project.
2. Enable the Gmail API.
3. Configure the OAuth consent screen. In development, add your Gmail address as a test user.
4. Create an OAuth client ID with application type **Web application**.
5. Add this exact authorized redirect URI:

```text
http://127.0.0.1:3001/api/auth/google/callback
```

Then add the OAuth credentials to `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:3001/api/auth/google/callback
```

The app requests Gmail modify/send permissions so it can read, triage, archive, label, and send mail through the Gmail API.

For IMAP/SMTP instead, open `.env` and set your server details. For Gmail app-password mode:

```env
ENABLE_DEFAULT_IMAP_ACCOUNT=true
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_TLS=true
IMAP_USER=you@gmail.com
IMAP_PASS=your_16_char_app_password

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_16_char_app_password
SMTP_FROM_NAME=Your Name
```

> **Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), select "Mail" + your device, and copy the 16-character password.
> 
> **Google Workspace:** Same as above; ensure IMAP is enabled in Gmail settings.
>
> **Fastmail:** Settings → Privacy & Security → Third-party apps → Generate App Password.
>
> **iCloud:** appleid.apple.com → Sign-In and Security → App-Specific Passwords.

**Step 5 — Start the server**
```bash
npm run dev --workspace=server
# Server starts on http://localhost:3001
```

**Step 6 — Start the client** (new terminal)
```bash
npm run dev --workspace=client
# Client starts on http://localhost:3000
```

**Step 7 — Open the app**

Navigate to [http://localhost:3000](http://localhost:3000).

If you pre-filled `.env`, your inbox starts loading immediately. Otherwise the setup screen appears — enter your credentials there.

For Gmail OAuth, click **Connect Gmail with Google**. If the app says OAuth setup is needed, copy the redirect URI it shows into your Google Cloud OAuth client, add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env`, then restart the server.

**Step 8 — Wait for initial sync**

The first sync fetches your latest 200 emails from the Gmail API or IMAP. The inbox renders as soon as the first batch arrives. Subsequent syncs run every 30 seconds in the background.

**Step 9 — Start using keyboard shortcuts**

Press `?` to see all shortcuts. Press `J`/`K` to move one email at a time, `Shift+J`/`Shift+K` to jump through the list, and `Space`/`Shift+Space` to scroll the email preview.

**Step 10 — (Optional) Production build**
```bash
npm run build
npm start --workspace=server   # serves API on :3001
# Serve client/dist/ with any static host (nginx, caddy, etc.)
```

---

## Keyboard Shortcuts

### Navigation
| Key | Action |
|-----|--------|
| `J` | Next email |
| `K` | Previous email |
| `Shift+J` | Jump down email list |
| `Shift+K` | Jump up email list |
| `Space` | Scroll email preview down |
| `Shift+Space` | Scroll email preview up |
| `Enter` | Open focused email |
| `U` | Back to inbox / deselect |
| `G` `I` | Go to Inbox |
| `G` `S` | Go to Starred |
| `G` `T` | Go to Sent |
| `G` `D` | Go to Drafts |

### Actions
| Key | Action |
|-----|--------|
| `E` | Archive |
| `#` | Delete |
| `S` | Star / Unstar |
| `!` | Mark as spam |
| `M` | Mute thread (archive silently) |
| `H` | Snooze |
| `Shift+U` | Mark as unread |
| `⌘Z` / `Ctrl+Z` | Undo last action |

### Compose
| Key | Action |
|-----|--------|
| `C` | Compose new email |
| `R` | Reply |
| `A` | Reply all |
| `F` | Forward |
| `⌘Enter` | Send (while composing) |

### Search & Palettes
| Key | Action |
|-----|--------|
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Search |
| `?` | Keyboard shortcuts overlay |

---

## Connecting Multiple Accounts

Multiple accounts can be added from the account dialog. Gmail accounts use **Connect Gmail with Google**; IMAP accounts can also be added by calling the API directly:

```bash
curl -X POST http://localhost:3001/api/accounts \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Work",
    "email": "work@company.com",
    "password": "app_password",
    "imapHost": "imap.gmail.com",
    "imapPort": 993,
    "imapTls": true,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpSecure": false
  }'
```

---

## Performance Features

- **Virtualized list** — only renders visible rows. 10,000 emails = same frame rate as 10.
- **Optimistic updates** — archive/delete/star apply instantly; IMAP sync happens behind the scenes.
- **5-second undo** — after archive or delete, a toast appears with an Undo button. Cancel within 5s and the action is rolled back locally and on the server.
- **Local search index** — MiniSearch indexes all cached emails client-side. Search results appear as you type with no network round-trip.
- **Background sync** — IMAP is polled every 30 seconds. New emails appear without a manual refresh.
- **IndexedDB cache** — emails persist across sessions. The inbox loads from cache instantly on subsequent visits.

---

## Design System

Based on the official Superhuman DESIGN.md specification:
- **Background**: `#0d0c1a` (deeper than mysteria for the app shell)
- **Accent**: `#cbb7fb` (Lavender Glow)
- **Text**: `#e8e6f0` / `rgba(232,230,240,0.65)` / `rgba(232,230,240,0.38)`
- **Font**: Geist (closest publicly available match to the custom Super Sans VF variable font)
- **Borders**: 1px `rgba(255,255,255,0.07)` / `rgba(255,255,255,0.13)`
- **Radius**: 8px (small), 12px (medium), 16px (large)

---

## Limitations & Notes

- **Single user** — no multi-tenant auth. Run it locally; don't expose to the internet without adding authentication.
- **Google verification** — using Gmail OAuth outside your own test users may require Google app verification because the app requests Gmail read/modify/send scopes.
- **App passwords still work for IMAP** — Gmail/Google Workspace can also be connected with app passwords if IMAP is enabled in Gmail settings.
- **Snooze resurface** — snooze stores the target time in IndexedDB. A background `setInterval` resurfaces emails on the client. For reliable server-side resurface, add a cron job.
- **Attachments** — metadata is shown; download links require adding a `/api/emails/:id/attachments/:index` route.
- **Search** — local MiniSearch covers cached emails. For full historical search across all mail, the server-side `/search` endpoint does a naive substring match against the warm cache.
