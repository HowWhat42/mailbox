import { useEffect, useRef } from 'react'
import { useStore } from '../../store'

/** Renders the pending in-app confirmation, if any. */
export function DialogHost() {
  const dialog = useStore((s) => s.dialog)
  const confirmBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmBtn.current?.focus()
  }, [dialog])

  if (!dialog) return null
  const danger = dialog.tone === 'danger'

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && dialog.resolve(false)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') dialog.resolve(false)
      }}
    >
      <div role="alertdialog" aria-label={dialog.title} className="pop-in w-full max-w-[400px] rounded-xl glass p-5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{dialog.title}</h2>
        {dialog.body && <p className="mt-2 text-[13px] leading-relaxed text-fg-2">{dialog.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => dialog.resolve(false)} className="h-8 rounded-md border border-line px-3.5 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            {dialog.cancelLabel ?? 'Annuler'}
          </button>
          <button
            ref={confirmBtn}
            onClick={() => dialog.resolve(true)}
            className={`h-8 rounded-md px-3.5 text-[13px] font-medium ${danger ? 'bg-danger text-white' : 'btn-primary'}`}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
