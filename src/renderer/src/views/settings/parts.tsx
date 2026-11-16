/** Building blocks shared by the settings sections. */

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-muted">{description}</p>}
      <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-white/[0.015]">{children}</div>
    </section>
  )
}

export function Row({ label, hint, children, stack }: { label: string; hint?: React.ReactNode; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`flex gap-x-6 gap-y-3 px-4 py-3.5 ${stack ? 'flex-col' : 'flex-col items-start @[560px]:flex-row @[560px]:items-center'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-lg border border-line p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-7 rounded-md px-3 text-[12.5px] ${o.value === value ? 'lit text-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const minutesLabel = (m: number): string =>
  m === 0 ? 'Au début' : m < 60 ? `${m} min avant` : m === 60 ? '1 heure avant' : m === 1440 ? '1 jour avant' : `${m / 60} h avant`

export function timeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
