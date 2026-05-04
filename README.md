# Superhuman Clone

A private, self-hostable email client that recreates Superhuman's aesthetic and keyboard-first experience. Connects to your own IMAP/SMTP accounts.

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
└── server/               # Fastify IMAP/SMTP bridge
    └── src/
        ├── routes/       # /accounts, /emails, /search, /sync
        └── services/     # imap.ts, smtp.ts, sync.ts (cache + polling)
```

**Local-first flow:** On load the UI reads from IndexedDB instantly (0ms), then a background sync fetches from IMAP and merges updates. All mutations (archive, delete, star, read) apply optimistically to the local store first, then flush to the server.

## 10-Step Setup

### Prerequisites
- Node.js ≥ 20
- An email account with IMAP/SMTP access and an **App Password** (not your main password)

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

Open `.env` and set your IMAP/SMTP details. For Gmail:

```env
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

**Step 8 — Wait for initial sync**

The first sync fetches your latest 200 emails from IMAP. The inbox renders as soon as the first batch arrives. Subsequent syncs run every 30 seconds in the background.

**Step 9 — Start using keyboard shortcuts**

Press `?` to see all shortcuts. Press `J`/`K` to navigate, `Enter` to open an email.

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

Multiple accounts can be added via the setup screen or by calling the API directly:

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
- **App passwords required** — OAuth flows for Gmail/Google Workspace are not included but can be added by wiring up `nodemailer-google-oauth2`.
- **Snooze resurface** — snooze stores the target time in IndexedDB. A background `setInterval` resurfaces emails on the client. For reliable server-side resurface, add a cron job.
- **Attachments** — metadata is shown; download links require adding a `/api/emails/:id/attachments/:index` route.
- **Search** — local MiniSearch covers cached emails. For full historical search across all mail, the server-side `/search` endpoint does a naive substring match against the warm cache.
