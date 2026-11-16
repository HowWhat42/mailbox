import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type Anchor = HTMLElement | { x: number; y: number }

function rectOf(anchor: Anchor): { left: number; top: number; right: number; bottom: number } {
  if ('getBoundingClientRect' in anchor) return anchor.getBoundingClientRect()
  return { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
}

/**
 * Floating layer anchored to an element (dropdowns) or a point (context menus).
 * Flips above / shifts left when it would overflow the window.
 */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  offset = 6,
  className = ''
}: {
  anchor: Anchor
  onClose: () => void
  children: React.ReactNode
  align?: 'start' | 'end'
  offset?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = rectOf(anchor)
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = align === 'end' ? r.right - w : r.left
    let top = r.bottom + offset
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - offset)
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8)
    setPos({ left, top })
  }, [anchor, align, offset])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor instanceof HTMLElement && anchor.contains(e.target as Node))) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onBlur = (): void => onClose()
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={`pop-in fixed z-[70] rounded-lg border border-line glass p-1 ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body
  )
}
