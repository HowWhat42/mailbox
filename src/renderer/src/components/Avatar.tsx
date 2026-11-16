import { avatarColor, initials } from '../lib/format'

export function Avatar({ name, seed, size = 32 }: { name: string; seed: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ background: avatarColor(seed.toLowerCase()), width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  )
}
