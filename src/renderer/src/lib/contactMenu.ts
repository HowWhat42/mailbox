import { Copy, Mail, UserRound } from 'lucide-react'
import type { Address } from '@shared/types'
import type { MenuEntry } from '../components/ui/Menu'
import { api, useStore } from '../store'

/** Loose on purpose: good enough to spot an address in running text. */
export const EMAIL = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g

export async function copy(text: string, done: string): Promise<void> {
  await api.app.copyText(text)
  useStore.getState().toast(done)
}

/** "Paul Durand <paul@exemple.fr>", or the bare address when there's no name. */
export function fullAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address
}

/** Write to / copy the address / copy name and address, for one correspondent. */
export function addressItems(a: Address, opts: { accountId?: string; subject?: string } = {}): MenuEntry[] {
  const items: MenuEntry[] = [
    {
      label: `Écrire à ${a.address}`,
      icon: Mail,
      onSelect: () => useStore.getState().compose({ accountId: opts.accountId, to: [a], subject: opts.subject ?? '' })
    },
    { label: 'Copier l’adresse e-mail', icon: Copy, onSelect: () => void copy(a.address, 'Adresse copiée') }
  ]
  if (a.name) items.push({ label: 'Copier le nom et l’adresse', icon: UserRound, onSelect: () => void copy(fullAddress(a), 'Contact copié') })
  return items
}

/** Every recipient of a message, one line each, plus all of them at once. */
export function recipientItems(list: Address[]): MenuEntry[] {
  const items: MenuEntry[] = list.slice(0, 12).map((a) => ({
    label: a.name ? `${a.name} · ${a.address}` : a.address,
    icon: Copy,
    onSelect: () => void copy(a.address, 'Adresse copiée')
  }))
  if (list.length > 1)
    items.push('separator', {
      label: `Copier les ${list.length} adresses`,
      icon: Copy,
      onSelect: () => void copy(list.map(fullAddress).join(', '), 'Adresses copiées')
    })
  return items
}

/** The address under the pointer in plain text (not a link): caret position, then the match around it. */
export function addressAt(d: Document, x: number, y: number): string | null {
  const range = d.caretRangeFromPoint?.(x, y)
  const node = range?.startContainer
  if (!range || node?.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent ?? ''
  for (const m of text.matchAll(EMAIL)) {
    if (m.index <= range.startOffset && range.startOffset <= m.index + m[0].length) return m[0].replace(/\.+$/, '')
  }
  return null
}

/** "Copier" when text is selected in the app itself (Electron shows no menu of its own). */
export function selectionItems(): MenuEntry[] {
  const selected = window.getSelection()?.toString() ?? ''
  if (!selected.trim()) return []
  return [{ label: 'Copier', icon: Copy, hint: 'Ctrl C', onSelect: () => void copy(selected, 'Texte copié') }, 'separator']
}
