import { useEffect, useRef, useState } from 'react'
import { PanelLeft, Search, X } from 'lucide-react'
import type { MailView } from '@shared/types'
import { api, useStore } from '../store'
import logo from '../assets/logo.png'
import { useLayout } from '../lib/layout'

function SearchBox() {
  const view = useStore((s) => s.view)
  const [value, setValue] = useState(view.type === 'search' ? view.query : '')
  const previous = useRef<MailView>(view)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Leaving search (sidebar click, shortcut…) clears the box; remember where to go back to.
  const [seenView, setSeenView] = useState(view)
  if (view !== seenView) {
    setSeenView(view)
    if (view.type !== 'search') setValue('')
  }
  useEffect(() => {
    if (view.type !== 'search') previous.current = view
  }, [view])

  const run = (q: string): void => {
    setValue(q)
    clearTimeout(timer.current)
    const { setView, view: now } = useStore.getState()
    // Clearing restores the previous view right away; only typing is debounced.
    if (!q.trim()) {
      if (now.type === 'search') setView(previous.current)
      return
    }
    timer.current = setTimeout(() => setView({ type: 'search', query: q.trim() }), 120)
  }

  return (
    <div className="no-drag relative flex h-8 w-full max-w-[560px] items-center">
      <Search size={14} className="pointer-events-none absolute left-3 z-10 text-muted" />
      <input
        id="search-input"
        value={value}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            run('')
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Enter' || e.key === 'ArrowDown') {
            ;(e.target as HTMLInputElement).blur()
            useStore.getState().move(1)
          }
        }}
        placeholder="Rechercher"
        className="h-full w-full rounded-lg border border-line bg-surface pl-9 backdrop-blur-md pr-9 text-[13px] text-fg placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none"
      />
      {value ? (
        <button onClick={() => run('')} aria-label="Effacer la recherche" className="absolute right-2.5 text-muted hover:text-fg">
          <X size={14} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 text-[11px] text-faint">/</kbd>
      )}
    </div>
  )
}

export function TitleBar() {
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const layout = useLayout()
  // Room for the native window buttons: on the right on Windows, the traffic lights on the left on macOS.
  const mac = api.app.platform === 'darwin'
  const left = mac ? Math.max(layout.drawer ? 0 : layout.sidebarWidth, 120) : layout.drawer ? 52 : layout.sidebarWidth
  const cols = `${left}px 1fr ${mac ? 16 : 140}px`
  return (
    <header className="drag relative grid h-12 shrink-0 items-center" style={{ gridTemplateColumns: cols }}>
      <div className={`flex items-center gap-2 ${mac ? 'pl-[78px]' : layout.rail ? 'justify-center' : 'pl-3'}`}>
        <button
          onClick={toggleSidebar}
          aria-label="Afficher ou masquer la barre latérale"
          title="Barre latérale (Ctrl \)"
          className="no-drag grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
        {!layout.rail && !layout.drawer && (
          <span className="flex min-w-0 items-center gap-2">
            <img src={logo} alt="" className="size-[18px] shrink-0" draggable={false} />
            <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">Mailbox</span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 justify-center px-2 sm:px-4">
        <SearchBox />
      </div>
      <div />
    </header>
  )
}
