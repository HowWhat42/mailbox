import type { Account, AccountMarker } from '@shared/types'
import { useStore } from '../store'

/** Short name on markers: the user's label, else a word from the account name or domain. */
export function accountLabel(a: Pick<Account, 'label' | 'name' | 'email'>): string {
  if (a.label.trim()) return a.label.trim()
  const domain = a.email.split('@')[1]?.split('.')[0] ?? ''
  const generic = [
    'gmail',
    'googlemail',
    'outlook',
    'hotmail',
    'live',
    'yahoo',
    'icloud',
    'me',
    'proton',
    'protonmail',
    'free',
    'orange',
    'sfr',
    'laposte',
    'ethereal'
  ]
  const word = generic.includes(domain.toLowerCase()) ? a.name.split(/\s+/)[0] : domain
  return (word || a.email).slice(0, 12).replace(/^./, (c) => c.toUpperCase())
}

/**
 * Which marker to draw for an account in lists: only when there is something to tell apart
 * (several accounts, in a view that mixes them).
 */
export function useAccountMarker(mixed: boolean): { style: AccountMarker; account: (id: string) => Account | undefined } {
  const accounts = useStore((s) => s.accounts)
  const style = useStore((s) => s.settings?.accountMarker ?? 'stripe')
  const show = mixed && accounts.length > 1
  return { style: show ? style : 'none', account: (id) => accounts.find((a) => a.id === id) }
}

/** Account name pill ("Pro", "Perso") in the account colour. */
export function AccountTag({ account, size = 'sm' }: { account: Account; size?: 'sm' | 'md' }) {
  return (
    <span
      title={account.email}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md font-semibold ${size === 'sm' ? 'h-[18px] px-1.5 text-[10.5px]' : 'h-6 px-2 text-[12px]'}`}
      style={{
        color: account.color,
        background: `color-mix(in oklch, ${account.color} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${account.color} 30%, transparent)`
      }}
    >
      {accountLabel(account)}
    </span>
  )
}

export function AccountDot({ account, size = 8 }: { account: Account; size?: number }) {
  return (
    <span
      title={`${accountLabel(account)} · ${account.email}`}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: account.color }}
    />
  )
}
