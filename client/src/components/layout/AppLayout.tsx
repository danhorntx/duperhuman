import { useState, useEffect } from 'react'
import { Sidebar }         from './Sidebar'
import { TopBar }          from './TopBar'
import { EmailList }       from '@/components/email/EmailList'
import { EmailThread }     from '@/components/email/EmailThread'
import { CommandPalette }  from '@/components/command/CommandPalette'
import { ComposeWindow }   from '@/components/email/EmailCompose'
import { ShortcutsOverlay } from '@/components/overlays/ShortcutsOverlay'
import { SnoozeModal }     from '@/components/overlays/SnoozeModal'
import { ToastStack }      from '@/components/ui/Toast'
import { AddAccountModal } from '@/components/account/AddAccountModal'
import { SearchView }      from '@/components/search/SearchView'
import { LabelManager }    from '@/components/labels/LabelManager'
import { LabelDialog }     from '@/components/labels/LabelDialog'
import { useUiStore }      from '@/store/uiStore'

export function AppLayout() {
  const [showAddAccount, setShowAddAccount] = useState(false)
  const view       = useUiStore(s => s.view)
  const openMail   = useUiStore(s => s.openMailView)

  // Esc returns to mail view from any sub-view
  useEffect(() => {
    if (view === 'mail') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openMail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, openMail])

  return (
    <>
      <div className="app-shell">
        <Sidebar onAddAccount={() => setShowAddAccount(true)} />

        <div className="main-area flex-col">
          {view === 'mail' && (
            <>
              <TopBar />
              <div className="flex flex-1 overflow-hidden">
                <div className="email-list-pane">
                  <EmailList />
                </div>
                <div className="email-thread-pane">
                  <EmailThread />
                </div>
              </div>
            </>
          )}
          {view === 'search'        && <SearchView />}
          {view === 'label-manager' && <LabelManager />}
        </div>
      </div>

      {/* Global overlays */}
      <CommandPalette />
      <ComposeWindow />
      <ShortcutsOverlay />
      <SnoozeModal />
      <LabelDialog />
      <ToastStack />

      {showAddAccount && (
        <AddAccountModal onClose={() => setShowAddAccount(false)} />
      )}
    </>
  )
}
