import type { AppSettings } from '@shared/types'
import { installNebula } from './nebula'

export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Nuit', hex: '#8f86f0' },
  { name: 'Azur', hex: '#5b8cff' },
  { name: 'Lagon', hex: '#2dd4bf' },
  { name: 'Menthe', hex: '#4ade80' },
  { name: 'Ambre', hex: '#f5b041' },
  { name: 'Corail', hex: '#fb7c5c' },
  { name: 'Rose', hex: '#f472b6' },
  { name: 'Lilas', hex: '#c084fc' }
]

export function isHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v)
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex([r, g, b]: number[]): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** Hue rotation in HSL: the second stop of the accent gradients. */
function shiftHue(hex: string, degrees: number): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return hex
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + degrees + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255])
}

/** Text colour readable on a solid accent fill. */
function onAccent(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#0b0a14' : '#ffffff'
}

export function resolveTheme(theme: AppSettings['theme']): 'dark' | 'light' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

let lastAccent = ''

/** Pushes the appearance settings into CSS variables / data attributes (main window and reminder window). */
export function applyAppearance(s: Pick<AppSettings, 'theme' | 'accent' | 'backdrop' | 'density'>): 'dark' | 'light' {
  const root = document.documentElement
  const theme = resolveTheme(s.theme)
  const accent = isHex(s.accent) ? s.accent : '#8f86f0'
  root.dataset.theme = theme
  root.dataset.backdrop = s.backdrop
  root.dataset.density = s.density
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-2', shiftHue(accent, 28))
  root.style.setProperty('--accent-fg', onAccent(accent))
  if (accent !== lastAccent) {
    lastAccent = accent
    installNebula(accent)
  }
  return theme
}
