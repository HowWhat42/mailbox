import { useEffect, useState } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { api, useStore } from '../store'
import { avatarColor } from '../lib/format'
import { Popover, type Anchor } from './ui/Popover'
import type { ThreadSummary } from '@shared/types'

/**
 * Labels of a conversation: tick to add or remove (applied at once, on the server too), type to
 * filter, Enter to create a new one. Opened from the reader, the thread menu or L.
 */
export function LabelPicker() {
  const picker = useStore((s) => s.labelPicker)
  if (!picker) return null
  // Keyed by conversation: opening it for another one starts fresh.
  return <Picker key={`${picker.thread.accountId}|${picker.thread.threadId}`} thread={picker.thread} anchor={picker.anchor} />
}

function Picker({ thread, anchor }: { thread: ThreadSummary; anchor: Anchor }) {
  const close = (): void => useStore.getState().openLabels(null)
  const [known, setKnown] = useState<string[]>([])
  const [current, setCurrent] = useState<string[]>(thread.labels)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  useEffect(() => {
    void api.mail.knownLabels(thread.accountId).then(setKnown)
  }, [thread.accountId])

  const all = [...new Set([...current, ...known])].toSorted((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
  const q = query.trim().toLowerCase()
  const shown = q ? all.filter((l) => l.toLowerCase().includes(q)) : all
  const exact = all.some((l) => l.toLowerCase() === q)
  const rows: { label: string; create?: boolean }[] = [
    ...shown.map((label) => ({ label })),
    ...(q && !exact ? [{ label: query.trim(), create: true }] : [])
  ]

  const toggle = async (label: string): Promise<void> => {
    const on = current.some((l) => l.toLowerCase() === label.toLowerCase())
    const next = on ? current.filter((l) => l.toLowerCase() !== label.toLowerCase()) : [...current, label]
    setCurrent(next)
    if (!known.includes(label)) setKnown([...known, label])
    try {
      await api.mail.setLabels(thread.accountId, thread.threadId, on ? [] : [label], on ? [label] : [])
    } catch (err) {
      setCurrent(current)
      useStore.getState().toast((err as Error).message, 'error')
    }
  }

  return (
    <Popover anchor={anchor} onClose={close} align="end" className="w-72 overflow-hidden !p-0">
      <div role="dialog" aria-label="Libellés">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const row = rows[active]
                if (row) {
                  void toggle(row.label)
                  if (row.create) setQuery('')
                }
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                close()
              }
            }}
            placeholder="Rechercher ou créer un libellé"
            aria-label="Rechercher ou créer un libellé"
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint"
          />
        </div>
        <div role="listbox" aria-label="Libellés" className="max-h-72 overflow-y-auto p-1">
          {rows.length === 0 && <p className="px-3 py-4 text-center text-[12.5px] text-muted">Tapez un nom pour créer un libellé.</p>}
          {rows.map((row, i) => {
            const on = current.some((l) => l.toLowerCase() === row.label.toLowerCase())
            return (
              <button
                key={`${row.create ? '+' : ''}${row.label}`}
                type="button"
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  void toggle(row.label)
                  if (row.create) setQuery('')
                }}
                className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] ${i === active ? 'bg-hover text-fg' : 'text-fg-2'}`}
              >
                {row.create ? (
                  <>
                    <Plus size={14} className="shrink-0 text-accent" />
                    <span className="truncate">
                      Créer « <span className="font-medium text-fg">{row.label}</span> »
                    </span>
                  </>
                ) : (
                  <>
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: avatarColor(row.label) }} />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {on && <Check size={14} className="shrink-0 text-accent" />}
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </Popover>
  )
}
