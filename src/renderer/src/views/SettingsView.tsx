import { Bell, CalendarDays, Inbox, Keyboard, Palette, Plus, SlidersHorizontal, X, type LucideIcon } from 'lucide-react'
import { useStore, type SettingsSection } from '../store'
import { useLayout } from '../lib/layout'
import { GeneralSettings } from './settings/GeneralSettings'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { NotificationSettings } from './settings/NotificationSettings'
import { InboxSettings } from './settings/InboxSettings'
import { CalendarSettings } from './settings/CalendarSettings'
import { AccountSettings } from './settings/AccountSettings'

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'Général', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Apparence', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'inbox', label: 'Tri & règles', icon: Inbox },
  { id: 'calendars', label: 'Agendas', icon: CalendarDays },
  { id: 'shortcuts', label: 'Raccourcis', icon: Keyboard }
]

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Palette de commandes'],
  ['C', 'Nouveau message'],
  ['/', 'Rechercher'],
  ['J / K', 'Conversation suivante / précédente'],
  ['E', 'Archiver'],
  ['# ou Suppr', 'Supprimer'],
  ['!', 'Indésirable'],
  ['S', 'Suivre'],
  ['U', 'Lu / non lu'],
  ['V', 'Déplacer vers un dossier'],
  ['X', 'Cocher la conversation'],
  ['Z', 'Annuler la dernière action'],
  ['R / A / F', 'Répondre / répondre à tous / transférer'],
  ['Ctrl Entrée', 'Envoyer'],
  ['G puis I, S, T, D, C', 'Réception, suivis, envoyés, brouillons, calendrier'],
  ['Ctrl \\', 'Barre latérale'],
  ['Calendrier : D W M A', 'Jour, semaine, mois, agenda'],
  ['Calendrier : T N ← →', 'Aujourd’hui, nouvel événement, navigation']
]

const TITLES: Record<string, string> = {
  general: 'Général',
  appearance: 'Apparence',
  notifications: 'Notifications',
  inbox: 'Tri & règles',
  calendars: 'Agendas',
  shortcuts: 'Raccourcis'
}

export function SettingsView() {
  const section = useStore((s) => s.settingsSection)
  const accounts = useStore((s) => s.accounts)
  const settings = useStore((s) => s.settings)
  const { openSettings, setMode, setSetup } = useStore.getState()
  const { single } = useLayout()
  const account = section.startsWith('account:') ? accounts.find((a) => `account:${a.id}` === section) : undefined

  const item = (active: boolean): string =>
    `flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] ${single ? '' : 'w-full'} ${active ? 'lit text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg'}`

  if (!settings) return null

  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${single ? 'flex-col' : ''}`}>
      <nav
        aria-label="Sections des réglages"
        className={
          single
            ? 'flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2'
            : 'w-[232px] shrink-0 space-y-0.5 overflow-y-auto border-r border-line p-3'
        }
      >
        {!single && <p className="px-2.5 pb-2 pt-1 text-[15px] font-semibold tracking-[-0.01em]">Réglages</p>}
        {SECTIONS.map((s) => (
          <button key={s.id} onClick={() => openSettings(s.id)} className={item(section === s.id)}>
            <s.icon size={15} className="text-muted" />
            {s.label}
          </button>
        ))}
        {!single && <p className="px-2.5 pb-1 pt-4 text-[12px] font-medium text-muted">Comptes</p>}
        {accounts.map((a) => (
          <button key={a.id} onClick={() => openSettings(`account:${a.id}`)} className={item(section === `account:${a.id}`)}>
            <span className="grid size-[15px] place-items-center">
              <span className="size-2.5 rounded-[3px]" style={{ background: a.color }} />
            </span>
            <span className="truncate">{a.name}</span>
          </button>
        ))}
        <button onClick={() => setSetup(true)} className={item(false)}>
          <Plus size={15} className="text-muted" /> Ajouter un compte
        </button>
      </nav>

      <div className="@container min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-5 pb-16 pt-6 @[600px]:px-8">
          <div className="mb-6 flex items-center">
            <h1 className="flex-1 text-[22px] font-semibold tracking-[-0.02em]">{account ? 'Compte' : TITLES[section]}</h1>
            <button
              onClick={() => setMode('mail')}
              aria-label="Fermer les réglages"
              title="Fermer (Échap)"
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
            >
              <X size={17} />
            </button>
          </div>
          {section === 'general' && <GeneralSettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'notifications' && <NotificationSettings />}
          {section === 'inbox' && <InboxSettings />}
          {section === 'calendars' && <CalendarSettings />}
          {section === 'shortcuts' && (
            <div className="divide-y divide-line rounded-xl border border-line">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="flex items-center gap-4 px-4 py-2.5">
                  <span className="flex-1 text-[13px] text-fg-2">{label}</span>
                  <kbd className="rounded-md border border-line bg-hover px-2 py-0.5 text-[12px] text-fg">{keys}</kbd>
                </div>
              ))}
            </div>
          )}
          {account && <AccountSettings key={account.id} account={account} />}
          {section.startsWith('account:') && !account && <p className="text-[13px] text-muted">Ce compte n’existe plus.</p>}
        </div>
      </div>
    </div>
  )
}
