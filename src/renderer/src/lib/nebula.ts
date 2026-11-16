/**
 * Paints the app backdrop: a low-resolution nebula with ordered (Bayer) dithering,
 * meant to be upscaled with `image-rendering: pixelated` under a 1px pixel grid.
 * Generated once at startup, so there is no image asset to ship.
 */

const W = 320
const H = 180

/** Night palette for an accent, darkest first: black → deep accent → accent → pale accent. */
function rampFor(accent: string): [number, number, number][] {
  const n = parseInt(accent.slice(1), 16)
  const a = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const out: [number, number, number][] = []
  for (let i = 0; i < 9; i++) {
    const t = i / 8
    const mix = (to: number[], k: number, from: number[]): [number, number, number] =>
      from.map((v, j) => Math.round(v + (to[j] - v) * k)) as [number, number, number]
    // Dark stops lean a little blue so the deep end reads as night, not mud.
    const deep = [Math.round(a[0] * 0.55), Math.round(a[1] * 0.55), Math.min(255, Math.round(a[2] * 0.75 + 25))]
    out.push(t < 0.75 ? mix(t < 0.4 ? deep : a, t < 0.4 ? (t / 0.4) ** 1.6 : (t - 0.4) / 0.35, t < 0.4 ? [0, 0, 0] : deep) : mix([255, 255, 255], ((t - 0.75) / 0.25) * 0.55, a))
  }
  return out
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
].map((row) => row.map((v) => (v + 0.5) / 16))

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth value noise on a coarse lattice, summed over a few octaves. */
function makeNoise(random: () => number): (x: number, y: number) => number {
  const size = 64
  const lattice = Array.from({ length: size * size }, random)
  const at = (x: number, y: number): number => lattice[((y % size) + size) % size * size + (((x % size) + size) % size)]
  const smooth = (t: number): number => t * t * (3 - 2 * t)
  const value = (x: number, y: number): number => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const tx = smooth(x - xi)
    const ty = smooth(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx
    return a + (b - a) * ty
  }
  return (x, y) => {
    let sum = 0
    let amp = 0.55
    let freq = 1
    for (let o = 0; o < 5; o++) {
      sum += value(x * freq, y * freq) * amp
      amp *= 0.5
      freq *= 2.05
    }
    return sum
  }
}

export function paintNebula(accent = '#8f86f0', seed = 7): string {
  const RAMP = rampFor(accent)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const random = rng(seed)
  const noise = makeNoise(random)

  // Light pools, mostly toward the lower right where the content panel ends.
  const pools = [
    { x: 0.86, y: 0.95, r: 0.55, k: 1.0 },
    { x: 0.62, y: 1.05, r: 0.4, k: 0.7 },
    { x: 1.02, y: 0.55, r: 0.35, k: 0.55 },
    { x: 0.08, y: 0.98, r: 0.28, k: 0.35 }
  ]
  const stars = new Set<number>()
  for (let i = 0; i < 260; i++) stars.add(Math.floor(random() * W * H))

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W
      const v = y / H
      let light = 0
      for (const p of pools) {
        const dx = (u - p.x) * 1.7
        const dy = v - p.y
        light += p.k * Math.exp(-(dx * dx + dy * dy) / (p.r * p.r))
      }
      // Filaments: noise carves the glow into clouds instead of round blobs.
      const n = noise(u * 5 + 3, v * 3)
      const level = Math.max(0, Math.min(1, light * (0.25 + n * 1.25) - 0.08))
      const scaled = level * (RAMP.length - 1)
      const base = Math.floor(scaled)
      const pick = scaled - base > BAYER[y % 4][x % 4] ? Math.min(base + 1, RAMP.length - 1) : base
      let [r, g, b] = RAMP[pick]
      const i = y * W + x
      if (stars.has(i) && random() < 0.6) {
        const s = 120 + Math.floor(random() * 135)
        ;[r, g, b] = [s, s, Math.min(255, s + 30)]
      }
      img.data[i * 4] = r
      img.data[i * 4 + 1] = g
      img.data[i * 4 + 2] = b
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export function installNebula(accent?: string): void {
  try {
    document.documentElement.style.setProperty('--nebula', `url(${paintNebula(accent)})`)
  } catch {
    // No canvas (very unlikely): the backdrop just stays black.
  }
}
