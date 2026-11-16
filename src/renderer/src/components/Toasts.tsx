import { X } from 'lucide-react'
import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pop-in pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-lg px-3.5 py-2.5 text-[13px] shadow-pop ${
            t.tone === 'error' ? 'bg-raised text-danger' : 'bg-raised text-fg'
          }`}
        >
          <span className="whitespace-pre-line">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="mt-0.5 text-muted hover:text-fg" aria-label="Fermer">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
