import { useState } from 'react'
import { Check, ChevronDown, Minus } from 'lucide-react'
import { Menu } from './Menu'

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  color,
  label
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  color?: string
  label: string
}) {
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors ${
        on ? 'border-transparent text-white' : 'border-line-strong hover:border-muted'
      }`}
      style={on ? { background: color ?? 'var(--primary-bg)', boxShadow: color ? undefined : 'var(--primary-shadow)', color: '#fff' } : undefined}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  )
}

export interface Option<T extends string> {
  value: T
  label: string
  hint?: string
  swatch?: string
}

/** Dropdown select rendered by the app (no native <select>). */
export function Select<T extends string>({
  value,
  options,
  onChange,
  className = '',
  disabled,
  ariaLabel
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  className?: string
  disabled?: boolean
  ariaLabel: string
}) {
  // The open menu's anchor lives in state: reading a ref during render is unreliable.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={`flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-left text-[13px] text-fg hover:border-line-strong disabled:opacity-60 ${className}`}
      >
        {current?.swatch && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: current.swatch }} />}
        <span className="min-w-0 flex-1 truncate">{current?.label ?? '—'}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          onClose={() => setAnchor(null)}
          minWidth={anchor.offsetWidth}
          items={options.map((o) => ({ label: o.label, hint: o.hint, swatch: o.swatch, checked: o.value === value, onSelect: () => onChange(o.value) }))}
        />
      )}
    </>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center gap-2.5 text-[12.5px] text-fg-2">
      <span className={`relative h-[18px] w-8 rounded-full transition-colors ${checked ? 'btn-primary' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-4' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}
