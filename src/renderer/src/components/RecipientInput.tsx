import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Address } from '@shared/types'
import { api } from '../store'
import { displayName } from '../lib/format'
import { Avatar } from './Avatar'
import { Popover } from './ui/Popover'

const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/

export function isValidAddress(a: Address): boolean {
  return EMAIL.test(a.address)
}

/** "Name <a@b.c>", "a@b.c", or several separated by , ; or newlines. */
export function parseAddresses(text: string): Address[] {
  return text
    .split(/[,;\n]+(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
      return m ? { name: m[1].trim(), address: m[2].trim() } : { name: '', address: part.replace(/^mailto:/i, '') }
    })
}

export function RecipientInput({
  value,
  onChange,
  autoFocus,
  ariaLabel
}: {
  value: Address[]
  onChange: (next: Address[]) => void
  autoFocus?: boolean
  ariaLabel: string
}) {
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<Address[]>([])
  const [active, setActive] = useState(0)
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    const q = text.trim()
    if (!q) return
    const t = setTimeout(() => {
      void api.mail.contacts(q).then((list) => {
        const taken = new Set(value.map((v) => v.address.toLowerCase()))
        setSuggestions(list.filter((c) => !taken.has(c.address.toLowerCase())))
        setActive(0)
      })
    }, 90)
    return () => clearTimeout(t)
  }, [text, value])

  const add = (list: Address[]): void => {
    const taken = new Set(value.map((v) => v.address.toLowerCase()))
    const fresh = list.filter((a) => a.address && !taken.has(a.address.toLowerCase()))
    if (fresh.length) onChange([...value, ...fresh])
    setText('')
    setSuggestions([])
  }

  const commit = (): boolean => {
    if (suggestions[active] && text.trim()) {
      add([suggestions[active]])
      return true
    }
    if (text.trim()) {
      add(parseAddresses(text))
      return true
    }
    return false
  }

  return (
    // Clicking the field's empty space focuses the text input (keyboard users tab straight to it).
    <div ref={setBox} role="presentation" className="flex min-h-9 flex-1 flex-wrap items-center gap-1 py-1" onClick={() => input.current?.focus()}>
      {value.map((a, i) => {
        const valid = isValidAddress(a)
        return (
          <span
            key={a.address + i}
            title={a.name ? `${a.name} <${a.address}>` : a.address}
            className={`flex h-7 items-center gap-1.5 rounded-lg border pl-1 pr-1 text-[12.5px] ${
              valid ? 'border-line bg-raised text-fg' : 'border-danger/50 bg-danger/10 text-danger'
            }`}
          >
            <Avatar name={displayName(a)} seed={a.address} size={20} />
            <span className="max-w-[220px] truncate">{a.name || a.address}</span>
            <button
              type="button"
              aria-label={`Retirer ${a.address}`}
              onClick={(e) => {
                e.stopPropagation()
                onChange(value.filter((_, j) => j !== i))
              }}
              className="grid size-5 place-items-center rounded text-muted hover:bg-hover hover:text-fg"
            >
              <X size={11} />
            </button>
          </span>
        )
      })}
      <input
        ref={input}
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value.trim()) setSuggestions([])
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (/[,;\n]/.test(pasted) || EMAIL.test(pasted.trim())) {
            e.preventDefault()
            add(parseAddresses(text + pasted))
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length) {
            e.preventDefault()
            setActive((active + 1) % suggestions.length)
          } else if (e.key === 'ArrowUp' && suggestions.length) {
            e.preventDefault()
            setActive((active - 1 + suggestions.length) % suggestions.length)
          } else if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && text.trim())) {
            if (commit()) e.preventDefault()
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1))
          } else if (e.key === 'Escape' && suggestions.length) {
            e.stopPropagation()
            setSuggestions([])
          }
        }}
        onBlur={() => {
          // Typed-but-not-validated text still counts as a recipient.
          if (text.trim()) add(parseAddresses(text))
        }}
        className="h-7 min-w-[160px] flex-1 bg-transparent text-[13px] text-fg placeholder:text-faint focus:outline-none"
        placeholder={value.length ? '' : 'Nom ou adresse'}
      />
      {suggestions.length > 0 && box && (
        <Popover anchor={box} onClose={() => setSuggestions([])} offset={2}>
          <div role="presentation" className="w-[340px]" onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((c, i) => (
              <button
                key={c.address}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => add([c])}
                className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === active ? 'bg-hover' : ''}`}
              >
                <Avatar name={displayName(c)} seed={c.address} size={26} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-fg">{c.name || c.address}</span>
                  {c.name && <span className="block truncate text-[11.5px] text-muted">{c.address}</span>}
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
