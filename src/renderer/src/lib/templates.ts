import { escapeHtml } from './format'

/** `{{Prénom}}`, `{{ Date du rendez-vous }}`: fields asked for when a template is used. */
const FIELD = /\{\{\s*([^{}]+?)\s*\}\}/g

/** The fields of a template, in order of first appearance (subject first), without duplicates. */
export function templateFields(subject: string, html: string): string[] {
  const names = new Map<string, string>()
  for (const source of [subject, html]) {
    for (const m of source.matchAll(FIELD)) {
      const key = m[1].toLowerCase()
      if (!names.has(key)) names.set(key, m[1])
    }
  }
  return [...names.values()]
}

/** Puts the values in. Fields left empty stay as `{{Field}}`, so they're easy to spot before sending. */
export function fillTemplate(subject: string, html: string, values: Record<string, string>): { subject: string; html: string } {
  const lookup = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  const fill = (text: string, escape: boolean): string =>
    text.replace(FIELD, (whole, name: string) => {
      const value = lookup.get(name.toLowerCase())
      if (!value) return whole
      return escape ? escapeHtml(value) : value
    })
  return { subject: fill(subject, false), html: fill(html, true) }
}
