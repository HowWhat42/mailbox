import type { Account, AccountMarker } from '@shared/types'
import { useStore } from '../../store'
import { Avatar } from '../../components/Avatar'
import { AccountDot, AccountTag } from '../../lib/accounts'

const OPTIONS: { value: AccountMarker; label: string; hint: string }[] = [
  { value: 'stripe', label: 'Liseré', hint: 'Bande de couleur à gauche' },
  { value: 'tag', label: 'Étiquette', hint: 'Nom court du compte' },
  { value: 'ring', label: 'Anneau', hint: 'Autour de l’avatar' },
  { value: 'dot', label: 'Point', hint: 'Pastille près de l’heure' },
  { value: 'none', label: 'Aucun', hint: 'Pas de repère' }
]

const SAMPLE: Account = {
  id: 'sample',
  kind: 'imap',
  name: 'Travail',
  label: 'Pro',
  email: 'vous@entreprise.fr',
  color: '#f5a524',
  imapHost: '',
  imapPort: 0,
  imapSecure: true,
  smtpHost: '',
  smtpPort: 0,
  smtpSecure: true,
  username: '',
  caldavUrl: null,
  signature: '',
  lastSyncAt: null,
  syncError: null,
  notify: true,
  inUnified: true,
  syncDepth: 400
}

/** A miniature list row wearing the given marker. */
export function MarkerSample({ marker, account = SAMPLE }: { marker: AccountMarker; account?: Account }) {
  return (
    <div className="relative flex items-center gap-2.5 overflow-hidden rounded-lg bg-white/[0.03] py-2 pl-3 pr-2.5">
      {marker === 'stripe' && (
        <span
          className="absolute inset-y-1 left-0 w-[3px] rounded-full"
          style={{ background: account.color, boxShadow: `0 0 8px ${account.color}` }}
        />
      )}
      <span
        className="rounded-full"
        style={marker === 'ring' ? { boxShadow: `0 0 0 2px var(--surface-solid), 0 0 0 4px ${account.color}` } : undefined}
      >
        <Avatar name="Léa Moreau" seed="lea@example.com" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold">Léa Moreau</span>
        <span className="block truncate text-[11.5px] text-muted">Point projet jeudi</span>
      </span>
      {marker === 'tag' && <AccountTag account={account} />}
      {marker === 'dot' && <AccountDot account={account} />}
      <span className="tnum text-[11px] text-muted">09:41</span>
    </div>
  )
}

export function MarkerPicker() {
  const marker = useStore((s) => s.settings?.accountMarker ?? 'stripe')
  const update = useStore((s) => s.updateSettings)
  return (
    <div role="radiogroup" aria-label="Repère du compte" className="grid grid-cols-1 gap-2 p-3 @[560px]:grid-cols-2">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={marker === o.value}
          aria-label={o.label}
          onClick={() => void update({ accountMarker: o.value })}
          className={`space-y-2 rounded-xl border p-2.5 text-left ${marker === o.value ? 'lit border-transparent' : 'border-line hover:bg-hover'}`}
        >
          <span className="flex items-baseline gap-2 px-0.5">
            <span className="text-[12.5px] font-medium">{o.label}</span>
            <span className="text-[11.5px] text-muted">{o.hint}</span>
          </span>
          <MarkerSample marker={o.value} />
        </button>
      ))}
    </div>
  )
}
