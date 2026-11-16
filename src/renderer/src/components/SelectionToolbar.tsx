import { useEffect, useState } from 'react'
import { Bold, Italic, Link2, List, ListOrdered, Quote, Underline, type LucideIcon } from 'lucide-react'

function FormatButton({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid size-7 place-items-center rounded-md ${active ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-hover hover:text-fg'}`}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  )
}

/** Formatting bar that floats above the current text selection. */
export function SelectionToolbar({ editor }: { editor: React.RefObject<HTMLDivElement | null> }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [, force] = useState(0)
  const [link, setLink] = useState<{ url: string; range: Range } | null>(null)

  useEffect(() => {
    const onChange = (): void => {
      if (link) return
      const sel = window.getSelection()
      const el = editor.current
      if (!sel || sel.isCollapsed || !sel.rangeCount || !el || !el.contains(sel.anchorNode)) {
        setPos(null)
        return
      }
      const r = sel.getRangeAt(0).getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top })
      force((n) => n + 1)
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [editor, link])

  if (!pos) return null
  const cmd = (name: string, value?: string): void => {
    document.execCommand(name, false, value)
    force((n) => n + 1)
  }
  const state = (name: string): boolean => document.queryCommandState(name)

  return (
    <div
      role="toolbar"
      aria-label="Mise en forme"
      tabIndex={-1}
      className="pop-in fixed z-[65] flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-line glass p-1"
      style={{ left: pos.x, top: pos.y - 8 }}
      onMouseDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      {link ? (
        <input
          autoFocus
          value={link.url}
          onChange={(e) => setLink({ ...link, url: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setLink(null)
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              const url = link.url.trim()
              const sel = window.getSelection()
              sel?.removeAllRanges()
              sel?.addRange(link.range)
              if (/^(https?:\/\/|mailto:)./i.test(url)) document.execCommand('createLink', false, url)
              setLink(null)
            }
          }}
          onBlur={() => setLink(null)}
          placeholder="https://"
          className="h-7 w-60 rounded-md bg-panel px-2 text-[12.5px] text-fg focus:outline-none"
        />
      ) : (
        <>
          <FormatButton icon={Bold} label="Gras (Ctrl B)" active={state('bold')} onClick={() => cmd('bold')} />
          <FormatButton icon={Italic} label="Italique (Ctrl I)" active={state('italic')} onClick={() => cmd('italic')} />
          <FormatButton icon={Underline} label="Souligné (Ctrl U)" active={state('underline')} onClick={() => cmd('underline')} />
          <span className="mx-0.5 h-4 w-px bg-line" />
          <FormatButton
            icon={Link2}
            label="Lien"
            onClick={() => {
              const sel = window.getSelection()
              if (sel?.rangeCount) setLink({ url: 'https://', range: sel.getRangeAt(0).cloneRange() })
            }}
          />
          <FormatButton icon={List} label="Liste à puces" active={state('insertUnorderedList')} onClick={() => cmd('insertUnorderedList')} />
          <FormatButton icon={ListOrdered} label="Liste numérotée" active={state('insertOrderedList')} onClick={() => cmd('insertOrderedList')} />
          <FormatButton icon={Quote} label="Citation" onClick={() => cmd('formatBlock', 'blockquote')} />
        </>
      )}
    </div>
  )
}
