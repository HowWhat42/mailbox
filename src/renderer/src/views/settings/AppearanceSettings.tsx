import { useState } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { ThemeMode } from '@shared/types'
import { useStore } from '../../store'
import { ACCENTS, isHex } from '../../lib/appearance'
import { Avatar } from '../../components/Avatar'
import { Row, Section, Segmented } from './parts'
import { Select } from '../../components/ui/Controls'
import { MarkerPicker } from './MarkerPicker'

const THEMES: { value: ThemeMode; label: string; icon: typeof Moon }[] = [
  { value: 'dark', label: 'Nuit', icon: Moon },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'system', label: 'Système', icon: Monitor }
]

/** A tiny sample of the UI, so accent and theme changes are visible right here. */
function Preview() {
  return (
    <div className="panel space-y-2 rounded-xl p-3">
      <div className="lit flex items-center gap-3 rounded-lg px-3 py-2.5">
        <Avatar name="Léa Moreau" seed="lea@example.com" size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">Léa Moreau</p>
          <p className="truncate text-[12px] text-fg-2">Point projet jeudi</p>
        </div>
        <span className="size-2 rounded-full bg-accent" />
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary h-8 rounded-lg px-3 text-[12.5px] font-medium">Répondre</button>
        <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent">3 non lus</span>
        <span className="text-[12px] text-accent">Afficher les images</span>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const settings = useStore((s) => s.settings)!
  const update = useStore((s) => s.updateSettings)
  const [hex, setHex] = useState(settings.accent)

  return (
    <>
      <Section title="Thème">
        <div className="grid grid-cols-3 gap-2 p-3">
          {THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => void update({ theme: t.value })}
              aria-pressed={settings.theme === t.value}
              className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-[12.5px] ${settings.theme === t.value ? 'lit border-transparent text-fg' : 'border-line text-fg-2 hover:bg-hover'}`}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Couleur d’accent" description="Sélection, boutons, non-lus, nébuleuse : tout suit cette couleur.">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2.5">
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                onClick={() => {
                  setHex(a.hex)
                  void update({ accent: a.hex })
                }}
                title={a.name}
                aria-label={`Accent ${a.name}`}
                className="group flex flex-col items-center gap-1.5"
              >
                <span
                  className={`grid size-9 place-items-center rounded-full transition-transform group-hover:scale-110 ${settings.accent.toLowerCase() === a.hex ? 'ring-2 ring-fg ring-offset-2 ring-offset-[var(--surface-solid)]' : ''}`}
                  style={{ background: a.hex }}
                >
                  {settings.accent.toLowerCase() === a.hex && <Check size={15} strokeWidth={3} className="text-black/70" />}
                </span>
                <span className="text-[11px] text-muted">{a.name}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-fg-2">Personnalisée</span>
            <span className="size-7 rounded-md border border-line" style={{ background: isHex(hex) ? hex : 'transparent' }} />
            <input
              value={hex}
              onChange={(e) => {
                const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`
                setHex(v)
                if (isHex(v)) void update({ accent: v.toLowerCase() })
              }}
              aria-label="Code couleur"
              spellCheck={false}
              maxLength={7}
              className="tnum h-8 w-28 rounded-md border border-line bg-panel px-2.5 text-[13px] uppercase text-fg focus:border-accent focus:outline-none"
            />
            {!isHex(hex) && <span className="text-[12px] text-danger">Format #RRGGBB</span>}
          </div>
          <Preview />
        </div>
      </Section>

      <Section
        title="Repère du compte"
        description="Dans la boîte unifiée, comment voir d’un coup d’œil de quelle boîte vient chaque message. La couleur et le nom court se règlent dans la page de chaque compte."
      >
        <MarkerPicker />
      </Section>

      <Section title="Affichage">
        <Row
          label="Taille de l’interface"
          hint="Automatique : plus grande sur les écrans larges (2560 px et plus), recalculée quand la fenêtre change d’écran."
        >
          <Select
            ariaLabel="Taille de l’interface"
            className="w-48"
            value={String(settings.uiScale)}
            onChange={(v) => void update({ uiScale: Number(v) })}
            options={[
              { value: '0', label: 'Automatique' },
              ...[0.9, 1, 1.1, 1.2, 1.35, 1.5].map((f) => ({ value: String(f), label: `${Math.round(f * 100)} %` }))
            ]}
          />
        </Row>
        <Row label="Fond" hint="La nébuleuse pixélisée derrière les panneaux (thème Nuit).">
          <Segmented
            ariaLabel="Fond"
            value={settings.backdrop}
            onChange={(v) => void update({ backdrop: v })}
            options={[
              { value: 'nebula', label: 'Nébuleuse' },
              { value: 'plain', label: 'Uni' }
            ]}
          />
        </Row>
        <Row label="Densité de la liste" hint="Compacte : une ligne par conversation, plus de messages à l’écran.">
          <Segmented
            ariaLabel="Densité"
            value={settings.density}
            onChange={(v) => void update({ density: v })}
            options={[
              { value: 'comfortable', label: 'Confortable' },
              { value: 'compact', label: 'Compacte' }
            ]}
          />
        </Row>
      </Section>
    </>
  )
}
