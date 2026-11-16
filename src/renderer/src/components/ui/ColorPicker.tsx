import { useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'
import { Popover } from './Popover'

type Hsv = { h: number; s: number; v: number }

const isHex = (v: string): boolean => /^#[0-9a-f]{6}$/i.test(v)

function hexToHsv(hex: string): Hsv {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return `#${[f(5), f(3), f(1)]
    .map((x) =>
      Math.round(x * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

const clamp = (x: number): number => Math.min(1, Math.max(0, x))

/** Drag on an element, reporting the pointer position as fractions of its box (0…1). */
function useDrag(onMove: (x: number, y: number) => void): (e: React.PointerEvent<HTMLElement>) => void {
  return (e) => {
    const el = e.currentTarget
    const box = el.getBoundingClientRect()
    const report = (ev: PointerEvent | React.PointerEvent): void =>
      onMove(clamp((ev.clientX - box.left) / box.width), clamp((ev.clientY - box.top) / box.height))
    el.setPointerCapture(e.pointerId)
    report(e)
    const move = (ev: PointerEvent): void => report(ev)
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

/**
 * Colour field: a swatch that opens a picker (saturation / brightness square, hue bar, hex code).
 * Changes are reported live, a few times per second at most while dragging.
 */
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(isHex(value) ? value : '#8f86f0'))
  const [text, setText] = useState(value)
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hex = hsvToHex(hsv)

  useEffect(() => () => clearTimeout(pending.current), [])

  const emit = (next: Hsv, immediate = false): void => {
    setHsv(next)
    const h = hsvToHex(next)
    setText(h)
    clearTimeout(pending.current)
    if (immediate) onChange(h)
    else pending.current = setTimeout(() => onChange(h), 80)
  }

  const area = useDrag((x, y) => emit({ ...hsv, s: x, v: 1 - y }))
  const hue = useDrag((x) => emit({ ...hsv, h: x * 359.9 }))

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          if (isHex(value)) setHsv(hexToHsv(value))
          setText(value)
          setAnchor(e.currentTarget)
        }}
        aria-label={label}
        title="Choisir une couleur"
        className="flex h-8 items-center gap-2 rounded-md border border-line bg-panel pl-1 pr-2.5 text-[12.5px] text-fg-2 hover:border-line-strong hover:text-fg"
      >
        <span
          className="size-6 rounded-[5px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
          style={{ background: isHex(value) ? value : 'transparent' }}
        />
        <span className="tnum uppercase">{isHex(value) ? value : '—'}</span>
        <Pipette size={13} className="text-muted" />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} className="!p-0">
          <div role="dialog" aria-label={label} className="w-60 space-y-3 p-3">
            <div
              role="slider"
              tabIndex={0}
              aria-label="Saturation et luminosité"
              aria-valuetext={hex}
              aria-valuenow={Math.round(hsv.s * 100)}
              onPointerDown={area}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.02
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
                if (!d) return
                e.preventDefault()
                emit({ ...hsv, s: clamp(hsv.s + d[0]), v: clamp(hsv.v + d[1]) })
              }}
              className="relative h-36 cursor-crosshair touch-none rounded-lg"
              style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
            >
              <span
                className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
                style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
              />
            </div>
            <div
              role="slider"
              tabIndex={0}
              aria-label="Teinte"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              onPointerDown={hue}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
                if (!d) return
                e.preventDefault()
                emit({ ...hsv, h: (hsv.h + d * (e.shiftKey ? 15 : 3) + 360) % 360 })
              }}
              className="relative h-3 cursor-pointer touch-none rounded-full"
              style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            >
              <span
                className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
                style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="size-8 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" style={{ background: hex }} />
              <input
                value={text}
                onChange={(e) => {
                  const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
                  setText(v)
                  if (isHex(v)) emit(hexToHsv(v.toLowerCase()), true)
                }}
                aria-label="Code couleur"
                spellCheck={false}
                maxLength={7}
                className="tnum h-8 min-w-0 flex-1 rounded-md border border-line bg-panel px-2.5 text-[13px] uppercase text-fg focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:outline-none"
              />
            </div>
            {!isHex(text) && <p className="text-[12px] text-danger">Format #RRGGBB</p>}
          </div>
        </Popover>
      )}
    </>
  )
}
