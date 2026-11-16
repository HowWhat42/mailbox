import { Bell, CalendarClock, Newspaper, Users, type LucideIcon } from 'lucide-react'
import type { MailCategory } from '@shared/types'

export const CATEGORY_LABEL: Record<MailCategory, string> = {
  people: 'Personnes',
  notifications: 'Notifications',
  newsletters: 'Newsletters',
  invitations: 'Invitations'
}

export const CATEGORY_HINT: Record<MailCategory, string> = {
  people: 'Les messages écrits par des humains.',
  notifications: 'Messages automatiques : comptes, factures, alertes, outils (GitHub, Slack…).',
  newsletters: 'Listes de diffusion et envois marketing, avec désabonnement en un clic.',
  invitations: 'Invitations et réponses d’agenda.'
}

export const CATEGORY_ICON: Record<MailCategory, LucideIcon> = {
  people: Users,
  notifications: Bell,
  newsletters: Newspaper,
  invitations: CalendarClock
}
