import { create } from 'zustand'
import { db } from '@/db/db'
import { emails as emailsApi } from '@/lib/api'
import { buildIndex, addToIndex } from '@/lib/search'
import { useLabelsStore } from '@/store/labelsStore'
import { useUiStore } from '@/store/uiStore'
import { invalidateContactCache, upsertContactsFromEmails } from '@/lib/contacts'
import { resurfaceDueSnoozes } from '@/lib/localWorkflow'
import type { Email, ActiveFolder, Account } from '@/types/email'

// ─── Per-account view state ───────────────────────────────────────────────────

export interface AccountViewState {
  emails:        Email[]
  selectedId:    string | null
  focusedIndex:  number
  activeFolder:  ActiveFolder
  isLoading:     boolean      // serving local cache → first paint
  isSyncing:     boolean      // background fetch from IMAP in progress
  hasSyncedOnce: Record<string, boolean>   // folderKey → ever fetched from server
  pendingArchive: Map<string, Email>
  pendingDelete:  Map<string, Email>
}

function defaultAccountState(): AccountViewState {
  return {
    emails:        [],
    selectedId:    null,
    focusedIndex:  0,
    activeFolder:  'INBOX',
    isLoading:     false,
    isSyncing:     false,
    hasSyncedOnce: {},
    pendingArchive: new Map(),
    pendingDelete:  new Map(),
  }
}

// Pull a deep batch on first sync of a folder, smaller delta after.
const FIRST_SYNC_LIMIT = 500
const DELTA_SYNC_LIMIT = 100

function folderKey(f: ActiveFolder): string {
  if (typeof f === 'object') return `label:${f.id}`
  return String(f)
}

// ─── Store shape ──────────────────────────────────────────────────────────────

interface EmailStore {
  accounts:        Account[]
  activeAccountId: string | null
  accountStates:   Record<string, AccountViewState>
  syncProgress:    number | null

  // Account management
  setAccounts:      (accounts: Account[]) => void
  addAccount:       (account: Account)    => void
  removeAccount:    (id: string)          => Promise<void>
  setActiveAccount: (id: string)          => void

  // Convenience: active account object
  getActiveAccount: () => Account | null

  // Per-account view actions (operate on active account unless id provided)
  setActiveFolder:  (folder: ActiveFolder) => void
  loadEmails:       ()  => Promise<void>
  selectEmail:      (id: string | null) => void
  focusIndex:       (index: number)     => void
  focusNext:        ()  => void
  focusPrev:        ()  => void
  openFocused:      ()  => void

  loadMore:    () => Promise<number>   // returns # of new emails fetched

  // Apply / remove a label on a single email (by label id, not name)
  applyLabel:  (labelId: string, emailId?: string) => Promise<void>
  removeLabel: (labelId: string, emailId?: string) => Promise<void>

  archiveEmail: (id?: string) => Promise<void>
  deleteEmail:  (id?: string) => Promise<void>
  starEmail:    (id?: string) => Promise<void>
  markRead:     (id: string, read: boolean) => Promise<void>
  markUnread:   (id?: string) => Promise<void>
  markSpam:     (id?: string) => Promise<void>
  muteThread:   (id?: string) => Promise<void>
  snoozeEmail:  (id: string, until: number) => Promise<void>
  undoLast:     () => Promise<void>
  triggerSync:  () => Promise<void>
  processLocalWorkflow: () => Promise<void>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read the active account's view state (never null). */
function getAS(s: Pick<EmailStore, 'activeAccountId' | 'accountStates'>): AccountViewState {
  return s.accountStates[s.activeAccountId ?? ''] ?? defaultAccountState()
}

/** Produce an updated accountStates record patching only the active account. */
function patchAS(
  s: Pick<EmailStore, 'activeAccountId' | 'accountStates'>,
  patch: Partial<AccountViewState>,
): Record<string, AccountViewState> {
  const id = s.activeAccountId
  if (!id) return s.accountStates
  const prev = s.accountStates[id] ?? defaultAccountState()
  return { ...s.accountStates, [id]: { ...prev, ...patch } }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useEmailStore = create<EmailStore>((set, get) => ({
  accounts:        [],
  activeAccountId: null,
  accountStates:   {},
  syncProgress:    null,

  // ─── Account management ──────────────────────────────────────────────────

  setAccounts: (accounts) => {
    set(s => {
      // Seed per-account state for any new accounts
      const states = { ...s.accountStates }
      for (const a of accounts) {
        if (!states[a.id]) states[a.id] = defaultAccountState()
      }
      return {
        accounts,
        accountStates: states,
        activeAccountId: s.activeAccountId ?? accounts[0]?.id ?? null,
      }
    })
  },

  addAccount: (account) => {
    set(s => {
      const exists = s.accounts.find(a => a.id === account.id)
      if (exists) return {}
      return {
        accounts:      [...s.accounts, account],
        accountStates: { ...s.accountStates, [account.id]: defaultAccountState() },
        activeAccountId: s.activeAccountId ?? account.id,
      }
    })
  },

  removeAccount: async (id) => {
    await db.emails.where('accountId').equals(id).delete()
    set(s => {
      const accounts = s.accounts.filter(a => a.id !== id)
      const { [id]: _, ...states } = s.accountStates
      const activeId = s.activeAccountId === id
        ? (accounts[0]?.id ?? null)
        : s.activeAccountId
      return { accounts, accountStates: states, activeAccountId: activeId }
    })
  },

  setActiveAccount: (id) => {
    set(s => {
      if (!s.accountStates[id]) {
        return { activeAccountId: id, accountStates: { ...s.accountStates, [id]: defaultAccountState() } }
      }
      return { activeAccountId: id }
    })
    // Kick off a load if the account has no emails yet
    const state = get().accountStates[id]
    if (!state || state.emails.length === 0) get().loadEmails()
  },

  getActiveAccount: () => {
    const { accounts, activeAccountId } = get()
    return accounts.find(a => a.id === activeAccountId) ?? null
  },

  // ─── Folder / load ───────────────────────────────────────────────────────

  setActiveFolder: (folder) => {
    set(s => ({ accountStates: patchAS(s, { activeFolder: folder, focusedIndex: 0, selectedId: null }) }))
    get().loadEmails()
  },

  loadEmails: async () => {
    const account = get().getActiveAccount()
    if (!account) return

    const { activeFolder } = getAS(get())
    set(s => ({ accountStates: patchAS(s, { isLoading: true }) }))

    try {
      // 1. Serve from IndexedDB first (instant)
      let local: Email[] = []
      const aid = account.id
      await get().processLocalWorkflow()

      // NOTE: Dexie 3.x doesn't reliably match booleans through compound
      // indexes (queries like `.equals([aid, 1])` won't match stored
      // `true`/`false`). All flag-based queries fall back to an
      // accountId index + JS filter, which is fast enough at our scale
      // (typically <2k rows per account) and never silently misses.
      if (activeFolder === 'INBOX') {
        local = await db.emails
          .where('[accountId+folder]').equals([aid, 'INBOX'])
          .filter(e => !e.isArchived && !e.isTrashed && !e.isSpam)
          .reverse().sortBy('date')
      } else if (activeFolder === 'Starred') {
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => !!e.isStarred && !e.isTrashed && !e.isSpam)
          .reverse().sortBy('date')
      } else if (activeFolder === 'Drafts') {
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => (!!e.isDraft || e.folder.toLowerCase().includes('draft')) && !e.isTrashed)
          .reverse().sortBy('date')
      } else if (activeFolder === 'Trash') {
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => !!e.isTrashed || e.folder.toLowerCase().includes('trash'))
          .reverse().sortBy('date')
      } else if (activeFolder === 'Spam') {
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => !!e.isSpam || e.folder.toLowerCase().includes('spam'))
          .reverse().sortBy('date')
      } else if (activeFolder === 'snoozed') {
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => (e.snoozedUntil ?? 0) > 0)
          .reverse().sortBy('date')
      } else if (typeof activeFolder === 'object' && activeFolder.kind === 'label') {
        const labelId = activeFolder.id
        local = await db.emails
          .where('accountId').equals(aid)
          .filter(e => e.labels.includes(labelId) && !e.isTrashed && !e.isSpam)
          .reverse().sortBy('date')
      } else {
        local = await db.emails
          .where('[accountId+folder]').equals([aid, activeFolder as string])
          .reverse().sortBy('date')
      }

      set(s => ({ accountStates: patchAS(s, { emails: local, isLoading: false }) }))
      buildIndex(local)

      // 2. Background sync from server (non-recursive)
      await get().triggerSync()
    } catch (err) {
      console.error('loadEmails', err)
      set(s => ({ accountStates: patchAS(s, { isLoading: false }) }))
    }
  },

  triggerSync: async () => {
    const account = get().getActiveAccount()
    if (!account) return

    // Snapshot folder + account at sync start. If the user navigates away
    // before the IMAP fetch returns, we still write to Dexie but DON'T
    // overwrite the now-current view with stale results.
    const startState  = getAS(get())
    const startFolder = startState.activeFolder
    const accountId   = account.id
    const fkey        = folderKey(startFolder)

    // Already syncing this folder for this account — skip duplicate.
    if (startState.isSyncing) return

    const fetchFolder =
      startFolder === 'snoozed'
        ? 'INBOX'
        : (typeof startFolder === 'object' ? 'INBOX' : (startFolder as string))

    const isFirstSync = !startState.hasSyncedOnce[fkey]
    const limit       = isFirstSync ? FIRST_SYNC_LIMIT : DELTA_SYNC_LIMIT

    set(s => ({ accountStates: patchAS(s, { isSyncing: true }) }))

    try {
      console.log(`[sync] ${accountId} ${fetchFolder} limit=${limit} firstSync=${isFirstSync}`)
      const serverEmailsRaw = await emailsApi.list(accountId, fetchFolder, limit)
      console.log(`[sync] ${accountId} ${fetchFolder} → ${serverEmailsRaw.length} emails`)

      // Mark this folder as having been synced so future hits use the
      // cheaper delta fetch.
      const markSynced = (s: AccountViewState): Partial<AccountViewState> => ({
        hasSyncedOnce: { ...s.hasSyncedOnce, [fkey]: true },
      })

      if (serverEmailsRaw.length === 0) {
        set(s => ({ accountStates: patchAS(s, { ...markSynced(getAS(s)), isSyncing: false }) }))
        return
      }

      // Auto-tag with custom labels via the rule engine
      const tag = useLabelsStore.getState().tagEmail

      // Preserve client-only state across syncs. The IMAP server doesn't know
      // about manually-applied labels, snooze, or local archive/trash state,
      // so a fresh server fetch would otherwise wipe them. Merge with the
      // local Dexie row (or the in-memory copy) before persisting.
      const ids = serverEmailsRaw.map(e => e.id)
      const localRows = await db.emails.bulkGet(ids)
      const localById = new Map<string, Email>()
      localRows.forEach(r => { if (r) localById.set(r.id, r) })

      const serverEmails = serverEmailsRaw.map(raw => {
        const tagged = tag(raw)
        const prior  = localById.get(raw.id)
        if (!prior) return tagged
        return {
          ...tagged,
          // Union of auto-tagged labels and any user-applied labels
          labels: Array.from(new Set([...(tagged.labels ?? []), ...(prior.labels ?? [])])),
          // Sticky client-side flags (server fetch never resets them)
          isArchived:   prior.isArchived || tagged.isArchived,
          isTrashed:    prior.isTrashed  || tagged.isTrashed,
          isSpam:       prior.isSpam     || tagged.isSpam,
          isMuted:      prior.isMuted    || tagged.isMuted,
          snoozedUntil: prior.snoozedUntil ?? tagged.snoozedUntil,
          // Preserve client-side read state ONLY if user marked it locally
          // and server hasn't seen the change yet
          isRead:       tagged.isRead || prior.isRead,
        }
      })

      await db.emails.bulkPut(serverEmails)
      await upsertContactsFromEmails(serverEmails)
      serverEmails.forEach(addToIndex)
      invalidateContactCache()

      // Only update the visible emails array if the user is still on the
      // folder + account we synced. Otherwise just persist to Dexie and
      // let the next loadEmails pick it up.
      const nowState  = getAS(get())
      const sameFolder = JSON.stringify(nowState.activeFolder) === JSON.stringify(startFolder)
      const sameAccount = get().activeAccountId === accountId

      if (sameFolder && sameAccount) {
        const serverIds = new Set(serverEmails.map(s => s.id))
        let merged = [
          ...serverEmails,
          ...nowState.emails.filter(e => !serverIds.has(e.id)),
        ].sort((a, b) => b.date - a.date)

        // For "virtual" folders (custom labels, snoozed) the server fetch is
        // always INBOX — re-apply the view filter so the merge doesn't dump
        // the entire inbox into a label view.
        if (typeof startFolder === 'object' && startFolder.kind === 'label') {
          const labelId = startFolder.id
          merged = merged.filter(e => e.labels.includes(labelId) && !e.isTrashed && !e.isSpam)
        } else if (startFolder === 'snoozed') {
          merged = merged.filter(e => (e.snoozedUntil ?? 0) > 0)
        } else if (startFolder === 'Starred') {
          merged = merged.filter(e => !!e.isStarred && !e.isTrashed && !e.isSpam)
        } else if (startFolder === 'INBOX') {
          merged = merged.filter(e => !e.isArchived && !e.isTrashed && !e.isSpam)
        }
        // Other folders (Sent, Drafts, Trash, Spam) match by `folder` field
        // already because we fetched from that folder; no extra filter needed.

        set(s => ({
          accountStates: patchAS(s, {
            emails:    merged,
            isLoading: false,
            isSyncing: false,
            hasSyncedOnce: { ...nowState.hasSyncedOnce, [fkey]: true },
          }),
        }))
      } else {
        set(s => ({ accountStates: patchAS(s, { isSyncing: false }) }))
      }
    } catch (err) {
      console.error('[sync] failed', err)
      set(s => ({ accountStates: patchAS(s, { isSyncing: false }) }))
    }
  },

  processLocalWorkflow: async () => {
    const account = get().getActiveAccount()
    if (!account) return
    const surfaced = await resurfaceDueSnoozes(account.id)
    if (surfaced.length === 0) return
    const state = getAS(get())
    if (state.activeFolder !== 'INBOX') return
    const existing = new Set(state.emails.map(e => e.id))
    const merged = [
      ...surfaced.filter(e => !existing.has(e.id)),
      ...state.emails,
    ].filter(e => !e.isTrashed && !e.isSpam).sort((a, b) => b.date - a.date)
    set(s => ({ accountStates: patchAS(s, { emails: merged }) }))
  },

  loadMore: async () => {
    const account = get().getActiveAccount()
    if (!account) return 0
    const startState = getAS(get())
    if (startState.isSyncing) return 0

    const startFolder = startState.activeFolder
    const fetchFolder =
      startFolder === 'snoozed'
        ? 'INBOX'
        : (typeof startFolder === 'object' ? 'INBOX' : (startFolder as string))

    set(s => ({ accountStates: patchAS(s, { isSyncing: true }) }))
    try {
      const offset = startState.emails.length
      const more   = await emailsApi.list(account.id, fetchFolder, FIRST_SYNC_LIMIT, offset)
      console.log(`[loadMore] ${account.id} ${fetchFolder} offset=${offset} → ${more.length}`)
      if (more.length === 0) {
        set(s => ({ accountStates: patchAS(s, { isSyncing: false }) }))
        return 0
      }
      const tag = useLabelsStore.getState().tagEmail
      // Merge with local rows so loaded-older mail keeps any prior labels /
      // archive state we already wrote (same reasoning as triggerSync).
      const ids = more.map(e => e.id)
      const localRows = await db.emails.bulkGet(ids)
      const localById = new Map<string, Email>()
      localRows.forEach(r => { if (r) localById.set(r.id, r) })

      const tagged = more.map(raw => {
        const t = tag(raw)
        const prior = localById.get(raw.id)
        if (!prior) return t
        return {
          ...t,
          labels:       Array.from(new Set([...(t.labels ?? []), ...(prior.labels ?? [])])),
          isArchived:   prior.isArchived || t.isArchived,
          isTrashed:    prior.isTrashed  || t.isTrashed,
          isSpam:       prior.isSpam     || t.isSpam,
          isMuted:      prior.isMuted    || t.isMuted,
          snoozedUntil: prior.snoozedUntil ?? t.snoozedUntil,
          isRead:       t.isRead || prior.isRead,
        }
      })
      await db.emails.bulkPut(tagged)
      await upsertContactsFromEmails(tagged)
      tagged.forEach(addToIndex)

      const nowState   = getAS(get())
      const sameFolder = JSON.stringify(nowState.activeFolder) === JSON.stringify(startFolder)
      if (sameFolder) {
        const haveIds = new Set(nowState.emails.map(e => e.id))
        let fresh     = tagged.filter(e => !haveIds.has(e.id))

        // Apply the same view filter as triggerSync — load-more on a label
        // view shouldn't bring in unlabeled INBOX emails.
        if (typeof startFolder === 'object' && startFolder.kind === 'label') {
          const labelId = startFolder.id
          fresh = fresh.filter(e => e.labels.includes(labelId) && !e.isTrashed && !e.isSpam)
        } else if (startFolder === 'snoozed') {
          fresh = fresh.filter(e => (e.snoozedUntil ?? 0) > 0)
        } else if (startFolder === 'Starred') {
          fresh = fresh.filter(e => !!e.isStarred && !e.isTrashed && !e.isSpam)
        } else if (startFolder === 'INBOX') {
          fresh = fresh.filter(e => !e.isArchived && !e.isTrashed && !e.isSpam)
        }

        const merged  = [...nowState.emails, ...fresh].sort((a, b) => b.date - a.date)
        set(s => ({ accountStates: patchAS(s, { emails: merged, isSyncing: false }) }))
        return fresh.length
      }
      set(s => ({ accountStates: patchAS(s, { isSyncing: false }) }))
      return 0
    } catch (err) {
      console.error('[loadMore] failed', err)
      set(s => ({ accountStates: patchAS(s, { isSyncing: false }) }))
      return 0
    }
  },

  // ─── Labels ──────────────────────────────────────────────────────────────

  applyLabel: async (labelId, emailId) => {
    const { emails, selectedId, focusedIndex } = getAS(get())
    const targetId = emailId ?? selectedId ?? emails[focusedIndex]?.id
    const target = emails.find(e => e.id === targetId)
    if (!target || target.labels.includes(labelId)) return
    const nextLabels = [...target.labels, labelId]
    set(s => ({ accountStates: patchAS(s, {
      emails: emails.map(e => e.id === targetId ? { ...e, labels: nextLabels } : e),
    }) }))
    await db.emails.update(targetId!, { labels: nextLabels })
  },

  removeLabel: async (labelId, emailId) => {
    const { emails, selectedId, focusedIndex } = getAS(get())
    const targetId = emailId ?? selectedId ?? emails[focusedIndex]?.id
    const target = emails.find(e => e.id === targetId)
    if (!target || !target.labels.includes(labelId)) return
    const nextLabels = target.labels.filter(l => l !== labelId)
    set(s => ({ accountStates: patchAS(s, {
      emails: emails.map(e => e.id === targetId ? { ...e, labels: nextLabels } : e),
    }) }))
    await db.emails.update(targetId!, { labels: nextLabels })
  },

  // ─── Navigation ──────────────────────────────────────────────────────────

  selectEmail: (id) => {
    set(s => ({ accountStates: patchAS(s, { selectedId: id }) }))
  },

  focusIndex: (index) => {
    const { emails } = getAS(get())
    const clamped = Math.max(0, Math.min(index, emails.length - 1))
    const id      = emails[clamped]?.id ?? null
    set(s => ({ accountStates: patchAS(s, { focusedIndex: clamped, selectedId: id }) }))
  },

  focusNext: () => {
    const { focusedIndex, emails } = getAS(get())
    const next = Math.min(focusedIndex + 1, emails.length - 1)
    const id   = emails[next]?.id ?? null
    // Auto-select for instant preview. mark-as-read is gated by a dwell timer
    // applied by the EmailList consumer so rapid j/k scrolling doesn't burn
    // through unread state.
    set(s => ({ accountStates: patchAS(s, { focusedIndex: next, selectedId: id }) }))
  },

  focusPrev: () => {
    const { focusedIndex, emails } = getAS(get())
    const next = Math.max(0, focusedIndex - 1)
    const id   = emails[next]?.id ?? null
    set(s => ({ accountStates: patchAS(s, { focusedIndex: next, selectedId: id }) }))
  },

  openFocused: () => {
    // Selection now happens automatically on focus change, so Enter just
    // forces the focused row to be selected (idempotent in the common case)
    // and immediately marks it read — bypassing the read-dwell timer.
    const { emails, focusedIndex } = getAS(get())
    const email = emails[focusedIndex]
    if (!email) return
    set(s => ({ accountStates: patchAS(s, { selectedId: email.id }) }))
    if (!email.isRead) get().markRead(email.id, true)
  },

  // ─── Optimistic mutations ─────────────────────────────────────────────────

  archiveEmail: async (id) => {
    const { emails, selectedId, focusedIndex, pendingArchive } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    const target = emails.find(e => e.id === targetId)
    if (!target) return

    const pending = new Map(pendingArchive)
    pending.set(targetId!, target)
    const updated = emails.filter(e => e.id !== targetId)
    // Keep the cursor on the same row index — that means the email below
    // the archived one slides up into the focus position. Auto-select it
    // so the reading pane immediately shows the next email (Superhuman's
    // "keep moving" feel).
    const newIndex = Math.min(focusedIndex, updated.length - 1)
    const newSelectedId = updated[newIndex]?.id ?? null
    set(s => ({ accountStates: patchAS(s, {
      emails: updated,
      pendingArchive: pending,
      focusedIndex: newIndex,
      selectedId: newSelectedId,
    }) }))

    await db.emails.update(targetId!, { isArchived: true })
    try {
      await emailsApi.archive([targetId!])
    } catch (err) {
      const current = getAS(get())
      const restored = [{ ...target, isArchived: false }, ...current.emails].sort((a, b) => b.date - a.date)
      const nextPending = new Map(getAS(get()).pendingArchive)
      nextPending.delete(targetId!)
      set(s => ({ accountStates: patchAS(s, { emails: restored, pendingArchive: nextPending }) }))
      await db.emails.update(targetId!, { isArchived: false })
      useUiStore.getState().toast('Archive failed — restored locally')
      console.error(err)
    }
  },

  deleteEmail: async (id) => {
    const { emails, selectedId, focusedIndex, pendingDelete } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    const target = emails.find(e => e.id === targetId)
    if (!target) return

    const pending = new Map(pendingDelete)
    pending.set(targetId!, target)
    const updated = emails.filter(e => e.id !== targetId)
    const newIndex = Math.min(focusedIndex, updated.length - 1)
    const newSelectedId = updated[newIndex]?.id ?? null
    set(s => ({ accountStates: patchAS(s, {
      emails: updated,
      pendingDelete: pending,
      focusedIndex: newIndex,
      selectedId: newSelectedId,
    }) }))

    await db.emails.update(targetId!, { isTrashed: true })
    try {
      await emailsApi.trash([targetId!])
    } catch (err) {
      const current = getAS(get())
      const restored = [{ ...target, isTrashed: false }, ...current.emails].sort((a, b) => b.date - a.date)
      const nextPending = new Map(getAS(get()).pendingDelete)
      nextPending.delete(targetId!)
      set(s => ({ accountStates: patchAS(s, { emails: restored, pendingDelete: nextPending }) }))
      await db.emails.update(targetId!, { isTrashed: false })
      useUiStore.getState().toast('Delete failed — restored locally')
      console.error(err)
    }
  },

  undoLast: async () => {
    const { emails, pendingArchive, pendingDelete } = getAS(get())
    const [archiveEntry] = [...pendingArchive.entries()].slice(-1)
    const [deleteEntry]  = [...pendingDelete.entries()].slice(-1)

    if (archiveEntry) {
      const [id, email] = archiveEntry
      const newPending  = new Map(pendingArchive)
      newPending.delete(id)
      const updated = [{ ...email, isArchived: false }, ...emails].sort((a, b) => b.date - a.date)
      set(s => ({ accountStates: patchAS(s, { emails: updated, pendingArchive: newPending }) }))
      await db.emails.update(id, { isArchived: false })
      try { await emailsApi.restore([id]) } catch (err) { useUiStore.getState().toast('Undo failed on mail server'); console.error(err) }
    } else if (deleteEntry) {
      const [id, email] = deleteEntry
      const newPending  = new Map(pendingDelete)
      newPending.delete(id)
      const updated = [{ ...email, isTrashed: false }, ...emails].sort((a, b) => b.date - a.date)
      set(s => ({ accountStates: patchAS(s, { emails: updated, pendingDelete: newPending }) }))
      await db.emails.update(id, { isTrashed: false })
      try { await emailsApi.restore([id]) } catch (err) { useUiStore.getState().toast('Undo failed on mail server'); console.error(err) }
    }
  },

  starEmail: async (id) => {
    const { emails, selectedId, focusedIndex } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    const target   = emails.find(e => e.id === targetId)
    if (!target) return
    const starred  = !target.isStarred
    set(s => ({ accountStates: patchAS(s, {
      emails: emails.map(e => e.id === targetId ? { ...e, isStarred: starred } : e),
    }) }))
    await db.emails.update(targetId!, { isStarred: starred })
    try {
      await emailsApi.star([targetId!], starred)
    } catch (err) {
      set(s => ({ accountStates: patchAS(s, {
        emails: getAS(s).emails.map(e => e.id === targetId ? { ...e, isStarred: !starred } : e),
      }) }))
      await db.emails.update(targetId!, { isStarred: !starred })
      useUiStore.getState().toast('Star update failed')
      console.error(err)
    }
  },

  markRead: async (id, read) => {
    const { emails } = getAS(get())
    set(s => ({ accountStates: patchAS(s, {
      emails: emails.map(e => e.id === id ? { ...e, isRead: read } : e),
    }) }))
    const previous = emails.find(e => e.id === id)?.isRead
    await db.emails.update(id, { isRead: read })
    try {
      await emailsApi.markRead([id], read)
    } catch (err) {
      if (previous !== undefined) {
        set(s => ({ accountStates: patchAS(s, {
          emails: getAS(s).emails.map(e => e.id === id ? { ...e, isRead: previous } : e),
        }) }))
        await db.emails.update(id, { isRead: previous })
      }
      useUiStore.getState().toast('Read state update failed')
      console.error(err)
    }
  },

  markUnread: async (id) => {
    const { selectedId, focusedIndex, emails } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    if (targetId) await get().markRead(targetId, false)
  },

  markSpam: async (id) => {
    const { emails, selectedId, focusedIndex } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    if (!targetId) return
    const updated = emails.filter(e => e.id !== targetId)
    const newIndex = Math.min(focusedIndex, updated.length - 1)
    set(s => ({ accountStates: patchAS(s, {
      emails: updated,
      focusedIndex: newIndex,
      selectedId: updated[newIndex]?.id ?? null,
    }) }))
    const target = emails.find(e => e.id === targetId)
    await db.emails.update(targetId, { isSpam: true })
    try {
      await emailsApi.spam([targetId])
    } catch (err) {
      if (target) {
        set(s => ({ accountStates: patchAS(s, { emails: [{ ...target, isSpam: false }, ...getAS(s).emails].sort((a, b) => b.date - a.date) }) }))
        await db.emails.update(targetId, { isSpam: false })
      }
      useUiStore.getState().toast('Spam move failed')
      console.error(err)
    }
  },

  muteThread: async (id) => {
    const { emails, selectedId, focusedIndex } = getAS(get())
    const targetId = id ?? selectedId ?? emails[focusedIndex]?.id
    const target   = emails.find(e => e.id === targetId)
    if (!target) return
    const updated = emails.filter(e => e.threadId !== target.threadId)
    const newIndex = Math.min(focusedIndex, updated.length - 1)
    set(s => ({ accountStates: patchAS(s, {
      emails: updated,
      focusedIndex: newIndex,
      selectedId: updated[newIndex]?.id ?? null,
    }) }))
    await db.emails.where('threadId').equals(target.threadId).modify({ isMuted: true, isArchived: true })
    try { await emailsApi.mute(target.threadId) } catch (err) { useUiStore.getState().toast('Mute failed on mail server'); console.error(err) }
  },

  snoozeEmail: async (id, until) => {
    const { emails, focusedIndex } = getAS(get())
    const updated = emails.filter(e => e.id !== id)
    const newIndex = Math.min(focusedIndex, updated.length - 1)
    set(s => ({ accountStates: patchAS(s, {
      emails: updated,
      focusedIndex: newIndex,
      selectedId: updated[newIndex]?.id ?? null,
    }) }))
    const target = emails.find(e => e.id === id)
    await db.emails.update(id, { snoozedUntil: until, isArchived: true })
    try {
      await emailsApi.snooze([id], until)
    } catch (err) {
      if (target) {
        set(s => ({ accountStates: patchAS(s, { emails: [{ ...target, snoozedUntil: undefined, isArchived: false }, ...getAS(s).emails].sort((a, b) => b.date - a.date) }) }))
        await db.emails.update(id, { snoozedUntil: undefined, isArchived: false })
      }
      useUiStore.getState().toast('Snooze failed')
      console.error(err)
    }
  },
}))

// ─── Selectors (read from active account) ────────────────────────────────────

export const selectActiveState = (s: EmailStore) => getAS(s)

export const selectFocusedEmail = (s: EmailStore): Email | null => {
  const as = getAS(s)
  return as.emails[as.focusedIndex] ?? null
}

export const selectSelectedEmail = (s: EmailStore): Email | null => {
  const as = getAS(s)
  return as.emails.find(e => e.id === as.selectedId) ?? null
}
