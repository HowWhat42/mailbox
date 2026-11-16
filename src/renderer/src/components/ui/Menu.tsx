import { useEffect, useRef, useState } from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { Popover, type Anchor } from './Popover'

export type MenuEntry =
  | {
      label: string
      icon?: LucideIcon
      hint?: string
      danger?: boolean
      checked?: boolean
      disabled?: boolean
      swatch?: string
      onSelect: () => void
    }
  | 'separator'

/** Keyboard-navigable menu: ↑ ↓ to move, Enter to pick, Escape to close. */
export function Menu({
  anchor,
  items,
  onClose,
  align,
  minWidth = 200
}: {
  anchor: Anchor
  items: MenuEntry[]
  onClose: () => void
  align?: 'start' | 'end'
  minWidth?: number
}) {
  const actionable = items.flatMap((it, i) => (it !== 'separator' && !it.disabled ? [i] : []))
  const [active, setActive] = useState(-1)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.focus()
  }, [])

  const pick = (i: number): void => {
    const it = items[i]
    if (it === 'separator' || it.disabled) return
    onClose()
    it.onSelect()
  }

  return (
    <Popover anchor={anchor} onClose={onClose} align={align}>
      <div
        ref={list}
        role="menu"
        tabIndex={-1}
        style={{ minWidth }}
        className="max-h-[60vh] overflow-y-auto outline-none"
        onKeyDown={(e) => {
          const pos = actionable.indexOf(active)
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive(actionable[(pos + 1) % actionable.length])
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive(actionable[(pos - 1 + actionable.length) % actionable.length])
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault()
            pick(active)
          }
        }}
      >
        {items.map((it, i) =>
          it === 'separator' ? (
            <div key={i} className="mx-1 my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              role="menuitem"
              disabled={it.disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] disabled:opacity-40 ${
                active === i ? 'bg-hover' : ''
              } ${it.danger ? 'text-danger' : 'text-fg'}`}
            >
              {it.swatch && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: it.swatch }} />}
              {it.icon && <it.icon size={14} strokeWidth={1.75} className={it.danger ? '' : 'text-muted'} />}
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <kbd className="text-[11px] text-muted">{it.hint}</kbd>}
              {it.checked && <Check size={14} className="text-accent" />}
            </button>
          )
        )}
      </div>
    </Popover>
  )
}
