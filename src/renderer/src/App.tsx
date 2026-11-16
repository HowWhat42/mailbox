import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ThreadList } from './components/ThreadList'
import { Reader } from './components/Reader'
import { Composer } from './components/Composer'
import { CommandPalette } from './components/CommandPalette'
import { AccountSetup } from './components/AccountSetup'
import { Settings } from './components/Settings'
import { Toasts } from './components/Toasts'
import { CalendarView } from './views/CalendarView'
import { useMailShortcuts } from './lib/shortcuts'

export function App() {
  const ready = useStore((s) => s.ready)
  const mode = useStore((s) => s.mode)
  const composer = useStore((s) => s.composer)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const setupOpen = useStore((s) => s.setupOpen)
  const settingsOpen = useStore((s) => s.settingsOpen)

  useEffect(() => {
    void useStore.getState().init()
  }, [])
  useMailShortcuts()

  if (!ready) return <div className="h-full bg-bg" />

  return (
    <div className="flex h-full bg-bg text-fg">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {mode === 'mail' ? (
          <div className="flex min-h-0 flex-1">
            <ThreadList />
            <Reader />
          </div>
        ) : (
          <CalendarView />
        )}
      </main>
      {composer && <Composer key={composer.key} draft={composer} />}
      {paletteOpen && <CommandPalette />}
      {setupOpen && <AccountSetup />}
      {settingsOpen && <Settings />}
      <Toasts />
    </div>
  )
}
