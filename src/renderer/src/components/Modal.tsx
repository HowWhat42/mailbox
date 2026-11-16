import { useEffect, useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'

export function Modal({
  title,
  onClose,
  children,
  width = 520,
  closable = true
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  width?: number
  closable?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  // Latest onClose without re-subscribing: a listener swapped while an event is being
  // dispatched would miss that event (Escape could then do nothing).
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    // Escape works wherever the focus is. Only the modal on top reacts: the last one in the DOM.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !closable || useStore.getState().dialog) return
      const modals = document.querySelectorAll('[data-modal]')
      if (modals[modals.length - 1] !== root.current) return
      e.preventDefault()
      close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closable])

  return (
    <div
      ref={root}
      data-modal
      role="presentation"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => closable && e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-label={title} className="pop-in w-full rounded-xl glass" style={{ maxWidth: width }}>
        <div className="flex h-12 items-center px-5">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em]">{title}</h2>
          {closable && (
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="ml-auto grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export const fieldCls =
  'h-9 w-full rounded-md border border-line bg-panel px-3 text-[13px] text-fg placeholder:text-faint focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none'

export function Label({ text, children, hint }: { text: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] text-fg-2">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted">{hint}</span>}
    </label>
  )
}
