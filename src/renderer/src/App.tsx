import { useEffect } from 'react'
import { useStore } from './store'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ThreadList } from './components/ThreadList'
import { Reader } from './components/Reader'
import { Composer } from './components/Composer'
import { CommandPalette } from './components/CommandPalette'
import { AccountSetup } from './components/AccountSetup'
import { SettingsView } from './views/SettingsView'
import { Toasts } from './components/Toasts'
import { MovePicker } from './components/MovePicker'
import { DialogHost } from './components/ui/DialogHost'
import { CalendarView } from './views/CalendarView'
import { useMailShortcuts } from './lib/shortcuts'
import { useLayout } from './lib/layout'

export function App() {
  const ready = useStore((s) => s.ready)
  const mode = useStore((s) => s.mode)
  const composer = useStore((s) => s.composer)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const setupOpen = useStore((s) => s.setupOpen)
  const selected = useStore((s) => s.selected)
  const drawerOpen = useStore((s) => s.drawerOpen)
  const layout = useLayout()

  useEffect(() => {
    void useStore.getState().init()
  }, [])
  useMailShortcuts()

  if (!ready) return <div className="h-full bg-shell" />

  return (
    <div className="relative flex h-full flex-col bg-shell text-fg">
      <div className="backdrop" aria-hidden />
      <TitleBar />
      <div className="relative flex min-h-0 flex-1">
        {!layout.drawer && <Sidebar />}
        <main className={`min-w-0 flex-1 pb-2 pr-2 ${layout.drawer ? 'pl-2' : ''}`}>
          <div className="panel flex h-full overflow-hidden rounded-xl">
            {mode === 'mail' ? (
              layout.single ? (
                // Narrow window: one pane at a time, the reader/composer replaces the list.
                composer ? (
                  <Composer key={composer.key} />
                ) : selected ? (
                  <Reader />
                ) : (
                  <ThreadList />
                )
              ) : (
                <>
                  <ThreadList />
                  {composer ? <Composer key={composer.key} /> : <Reader />}
                </>
              )
            ) : mode === 'calendar' ? (
              <CalendarView />
            ) : (
              <SettingsView />
            )}
          </div>
        </main>
      </div>
      {layout.drawer && drawerOpen && (
        <div role="presentation" className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().setDrawer(false)}>
          <div className="pop-in flex h-full w-[260px] flex-col rounded-r-xl border-r border-line bg-surface-solid pt-3 shadow-pop">
            <Sidebar forceExpanded />
          </div>
        </div>
      )}
      {paletteOpen && <CommandPalette />}
      {setupOpen && <AccountSetup />}
      <MovePicker />
      <DialogHost />
      <Toasts />
    </div>
  )
}
