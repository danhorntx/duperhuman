import { MagnifyingGlassIcon, KeyboardIcon, ArrowClockwiseIcon } from '@phosphor-icons/react'
import { useEmailStore, selectActiveState } from '@/store/emailStore'
import { useUiStore } from '@/store/uiStore'
import { useLabelsStore } from '@/store/labelsStore'
import { formatShortcut } from '@/lib/utils'

export function TopBar() {
  const { activeFolder, isLoading } = useEmailStore(selectActiveState)
  const triggerSync = useEmailStore(s => s.triggerSync)
  const openCommandPalette = useUiStore(s => s.openCommandPalette)
  const openShortcuts = useUiStore(s => s.openShortcuts)
  const labels = useLabelsStore(s => s.labels)

  const folderLabel =
    activeFolder === 'snoozed'
      ? 'Snoozed'
      : typeof activeFolder === 'object' && activeFolder.kind === 'label'
      ? (labels.find(l => l.id === activeFolder.id)?.name ?? 'Label')
      : (activeFolder as string).charAt(0).toUpperCase() + (activeFolder as string).slice(1)

  return (
    <header
      className="topbar-drag-region flex items-center gap-3 px-4 h-11 flex-shrink-0 border-b border-[var(--border-subtle)]"
      style={{ background: 'var(--bg-elevated)' }}
    >
      {/* Folder name */}
      <h1 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight min-w-[80px]">
        {folderLabel}
      </h1>

      {/* Search trigger */}
      <button
        onClick={openCommandPalette}
        className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-[var(--text-muted)] transition-colors duration-100 hover:bg-[var(--bg-hover)] max-w-xs"
        style={{ border: '1px solid var(--border-subtle)' }}
      >
        <MagnifyingGlassIcon size={13} weight="regular" />
        <span>Search</span>
        <span className="ml-auto flex items-center gap-0.5">
          <kbd>{formatShortcut('cmd+k')}</kbd>
        </span>
      </button>

      <div className="flex items-center gap-1 ml-auto">
        {/* Sync button */}
        <button
          onClick={() => triggerSync()}
          className="p-1.5 rounded-lg transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
          title="Sync now"
          aria-label="Sync now"
        >
          <ArrowClockwiseIcon
            size={14}
            weight="regular"
            className={isLoading ? 'animate-spin' : ''}
          />
        </button>

        {/* Shortcuts */}
        <button
          onClick={openShortcuts}
          className="p-1.5 rounded-lg transition-colors duration-100 hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-muted)' }}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <KeyboardIcon size={14} weight="regular" />
        </button>
      </div>
    </header>
  )
}
