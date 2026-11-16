import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pop-in pointer-events-auto flex max-w-[540px] items-center gap-3 rounded-xl glass py-2 pl-3.5 pr-2 text-[13px]">
          {t.tone === 'error' ? (
            <CircleAlert size={15} className="shrink-0 text-danger" />
          ) : (
            <CheckCircle2 size={15} className="shrink-0 text-accent" />
          )}
          <span className={`whitespace-pre-line ${t.tone === 'error' ? 'text-danger' : 'text-fg'}`}>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
              className="ml-1 h-7 rounded-md px-2.5 text-[12.5px] font-semibold text-accent hover:bg-accent-soft"
            >
              {t.action.label}
              <kbd className="ml-1.5 text-[11px] font-normal text-muted">Z</kbd>
            </button>
          )}
          <button
            onClick={() => dismiss(t.id)}
            className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            aria-label="Fermer"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
