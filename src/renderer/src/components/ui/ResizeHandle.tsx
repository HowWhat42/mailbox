import { useRef, useState } from 'react'

/**
 * Drag handle on the right edge of a pane (the pane must be `relative`). Drag to resize,
 * arrow keys for 16 px steps, double-click to go back to the default width.
 * Starts from the pane's rendered width, so a pane still on its default (fluid) width works too.
 */
export function ResizeHandle({
  label,
  min,
  max,
  onChange,
  onReset
}: {
  label: string
  min: number
  max: number
  onChange: (width: number) => void
  onReset: () => void
}) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const clamp = (w: number): number => Math.round(Math.min(max, Math.max(min, w)))
  const paneWidth = (el: HTMLElement): number => el.parentElement?.getBoundingClientRect().width ?? min

  const stop = (): void => {
    start.current = null
    setDragging(false)
    delete document.body.dataset.resizing
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Glisser pour redimensionner · double-clic pour réinitialiser"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, width: paneWidth(e.currentTarget) }
        setDragging(true)
        // Global: no width transitions, no text selection, resize cursor everywhere while dragging.
        document.body.dataset.resizing = ''
      }}
      onPointerMove={(e) => {
        if (start.current) onChange(clamp(start.current.width + e.clientX - start.current.x))
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        onChange(clamp(paneWidth(e.currentTarget) + (e.key === 'ArrowRight' ? 16 : -16)))
      }}
      className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <span
        className={`absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full transition-colors ${dragging ? 'bg-accent' : 'bg-transparent group-hover:bg-line-strong group-focus-visible:bg-accent'}`}
      />
    </div>
  )
}
