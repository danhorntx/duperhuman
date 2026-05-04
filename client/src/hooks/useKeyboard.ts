import { useEffect, useCallback, useRef } from 'react'
import { useEmailStore } from '@/store/emailStore'
import { useUiStore } from '@/store/uiStore'
import { isInputFocused } from '@/lib/utils'

// ─── Two-key sequence state ───────────────────────────────────────────────────
// For Vim-style g+i, g+s etc. We track the first key and reset after 500ms.

let pendingKey: string | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null

function setPending(key: string) {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingKey = key
  pendingTimer = setTimeout(() => { pendingKey = null }, 500)
}

function consumePending(): string | null {
  const k = pendingKey
  pendingKey = null
  if (pendingTimer) clearTimeout(pendingTimer)
  return k
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGlobalKeyboard() {
  const store = useEmailStore()
  // selectedId lives inside per-account state — pull it via selector
  const selectedId = useEmailStore(s => s.accountStates[s.activeAccountId ?? '']?.selectedId ?? null)
  const ui = useUiStore()

  const handler = useCallback((e: KeyboardEvent) => {
    // Let the browser handle shortcuts when a modal / overlay is open
    if (ui.commandPaletteOpen || ui.shortcutsOverlayOpen || ui.composeOpen || ui.snoozeModalOpen || ui.labelDialogOpen) {
      if (e.key === 'Escape') {
        ui.closeCommandPalette()
        ui.closeShortcuts()
        ui.closeCompose()
        ui.closeSnoozeModal()
        ui.closeLabelDialog()
        ui.setSearchMode(false)
      }
      return
    }

    // Cmd/Ctrl+K → command palette
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      ui.openCommandPalette()
      return
    }

    // Cmd/Ctrl+Z → undo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault()
      store.undoLast()
      return
    }

    // Block single-key shortcuts when typing in an input
    if (isInputFocused()) return

    const key = e.key

    // ─── Two-key sequences ────────────────────────────────────────────────
    const prev = consumePending()
    if (prev === 'g') {
      switch (key) {
        case 'i': store.setActiveFolder('INBOX'); return
        case 's': store.setActiveFolder('Starred'); return
        case 't': store.setActiveFolder('Sent'); return
        case 'd': store.setActiveFolder('Drafts'); return
        case 'e': store.setActiveFolder('Trash'); return
        default: break
      }
    }

    // ─── Single key shortcuts ─────────────────────────────────────────────
    switch (key) {
      // Navigation
      case 'j': store.focusNext(); break
      case 'k': store.focusPrev(); break
      case 'Enter': store.openFocused(); break
      case 'u': store.selectEmail(null); break

      // Actions
      case 'e': {
        e.preventDefault()
        store.archiveEmail()
        ui.toast('Archived', { action: { label: 'Undo', fn: () => store.undoLast() } })
        break
      }
      case '#': {
        e.preventDefault()
        store.deleteEmail()
        ui.toast('Deleted', { action: { label: 'Undo', fn: () => store.undoLast() } })
        break
      }
      case 's': store.starEmail(); break
      case '!': store.markSpam(); break
      case 'm': {
        store.muteThread()
        ui.toast('Thread muted and archived')
        break
      }
      case 'h': ui.openSnoozeModal(); break
      case 'l': {
        e.preventDefault()
        ui.openLabelDialog()
        break
      }

      case 'U': {   // Shift+U
        e.preventDefault()
        store.markUnread()
        ui.toast('Marked as unread')
        break
      }

      // Compose
      case 'c': ui.openCompose(); break
      case 'r': {
        const sel = selectedId
        if (sel) ui.openCompose({ replyToId: sel })
        break
      }
      case 'a': {
        const sel = selectedId
        if (sel) ui.openCompose({ replyToId: sel })
        break
      }
      case 'f': {
        const sel = selectedId
        if (sel) ui.openCompose({ forwardId: sel })
        break
      }

      // Search
      case '/': {
        e.preventDefault()
        ui.openCommandPalette()
        break
      }

      // Help
      case '?': ui.openShortcuts(); break

      // g prefix
      case 'g': setPending('g'); break

      default: break
    }
  }, [store, ui])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])
}

// ─── Per-component shortcut binding ──────────────────────────────────────────

type KeyMap = Record<string, (e: KeyboardEvent) => void>

export function useKeyMap(map: KeyMap, active = true) {
  const ref = useRef(map)
  ref.current = map

  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      const fn = ref.current[e.key]
      if (fn) fn(e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active])
}
