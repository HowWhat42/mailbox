import { differenceInCalendarDays, format, formatDistanceStrict, isSameYear, isToday, isYesterday } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Address, FolderRole } from '@shared/types'

export function listDate(ts: number): string {
  const d = new Date(ts)
  if (isToday(d)) return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Hier'
  if (isSameYear(d, new Date())) return format(d, 'd MMM', { locale: fr })
  return format(d, 'dd/MM/yy')
}

/** Going back in a conversation (newest first), when two messages are on different days: "La veille", "3 jours plus tôt"… */
export function gapLabel(newer: number, older: number): string | null {
  const days = differenceInCalendarDays(newer, older)
  if (days <= 0) return null
  if (days === 1) return 'La veille'
  if (days < 7) return `${days} jours plus tôt`
  return `${formatDistanceStrict(older, newer, { locale: fr, roundingMethod: 'floor' })} plus tôt`
}

/** Day heading in a conversation: "mercredi 11 novembre" (with the year when it isn't this one). */
export function dayLabel(ts: number): string {
  const d = new Date(ts)
  return format(d, isSameYear(d, new Date()) ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy', { locale: fr })
}

/** How long a conversation has been going: "sur 3 jours", or null within a day. */
export function spanLabel(first: number, last: number): string | null {
  if (differenceInCalendarDays(last, first) < 1) return null
  const days = differenceInCalendarDays(last, first)
  return days < 31 ? `sur ${days} jour${days > 1 ? 's' : ''}` : `sur ${formatDistanceStrict(first, last, { locale: fr })}`
}

export function fullDate(ts: number): string {
  return format(new Date(ts), "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })
}

export function displayName(a: Address | undefined): string {
  if (!a) return ''
  return a.name || a.address
}

export function formatAddresses(list: Address[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
}

export function initials(name: string): string {
  const clean = name.replace(/[<>"']/g, '').trim()
  const parts = clean.split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

/** Stable, readable color per correspondent. */
export function avatarColor(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `oklch(0.62 0.09 ${h % 360})`
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

export const ROLE_LABEL: Record<Exclude<FolderRole, null>, string> = {
  inbox: 'Réception',
  sent: 'Envoyés',
  drafts: 'Brouillons',
  trash: 'Corbeille',
  junk: 'Indésirables',
  archive: 'Archives',
  all: 'Tous les messages',
  flagged: 'Suivis'
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>')
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  doc.querySelectorAll('p, div, li, blockquote').forEach((el) => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Section a thread falls under in the list (Aujourd’hui, Hier, …). */
export function dateGroup(ts: number, now = new Date()): string {
  const d = new Date(ts)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (ts >= today) return 'Aujourd’hui'
  if (ts >= today - day) return 'Hier'
  const weekStart = today - ((now.getDay() + 6) % 7) * day
  if (ts >= weekStart) return 'Cette semaine'
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'Ce mois-ci'
  const label = format(d, isSameYear(d, now) ? 'MMMM' : 'MMMM yyyy', { locale: fr })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function extensionOf(filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()! : ''
  return ext.slice(0, 4).toUpperCase() || 'FICH'
}
