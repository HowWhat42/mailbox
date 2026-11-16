import { resolveMx } from 'node:dns/promises'
import type { ServerSettings } from '@shared/types'
import { byDomain, byMx, type Provider } from './providers'

function fromProvider(p: Provider, email: string, via?: string): ServerSettings {
  return {
    imapHost: p.imap[0],
    imapPort: p.imap[1],
    imapSecure: p.imap[2],
    smtpHost: p.smtp[0],
    smtpPort: p.smtp[1],
    smtpSecure: p.smtp[2],
    username: email,
    provider: via ? `${p.name} (${via})` : p.name,
    note: p.note
  }
}

async function autoconfig(url: string, email: string): Promise<ServerSettings | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return res.ok ? parseAutoconfig(await res.text(), email) : null
  } catch {
    return null
  }
}

/** Registrable domain of a host, good enough for ISPDB lookups ("mx1.mail.ovh.net" → "ovh.net"). */
function baseDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.')
  return parts.slice(-2).join('.')
}

/**
 * Finds IMAP/SMTP settings for an address: known providers first, then the provider's own
 * autoconfig file, Mozilla's ISPDB, and finally the domain's MX records, which reveal who
 * hosts mail for a custom domain (Google Workspace, Microsoft 365, OVH, IONOS…).
 */
export async function discoverSettings(email: string): Promise<ServerSettings | null> {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  if (!domain) return null

  const known = byDomain(domain)
  if (known) return fromProvider(known, email)

  for (const url of [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
    `https://autoconfig.thunderbird.net/v1.1/${domain}`
  ]) {
    const found = await autoconfig(url, email)
    if (found) return { ...found, provider: found.provider ?? domain }
  }

  try {
    const mx = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange)
    const hosted = byMx(mx)
    if (hosted) return fromProvider(hosted, email, 'détecté via MX')
    for (const base of new Set(mx.map(baseDomain))) {
      const found = await autoconfig(`https://autoconfig.thunderbird.net/v1.1/${base}`, email)
      if (found) return { ...found, provider: `${base} (détecté via MX)` }
    }
  } catch {
    // No MX records or no network: fall back to the UI's guess.
  }
  return null
}

function tag(block: string, name: string): string | null {
  return block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? null
}

function expand(template: string, email: string): string {
  const [local, domain] = email.split('@')
  return template.replaceAll('%EMAILADDRESS%', email).replaceAll('%EMAILLOCALPART%', local).replaceAll('%EMAILDOMAIN%', domain)
}

function parseAutoconfig(xml: string, email: string): ServerSettings | null {
  const incoming = [...xml.matchAll(/<incomingServer type="imap">([\s\S]*?)<\/incomingServer>/g)].map((m) => m[1])
  const outgoing = [...xml.matchAll(/<outgoingServer type="smtp">([\s\S]*?)<\/outgoingServer>/g)].map((m) => m[1])
  // Prefer implicit TLS, then STARTTLS; never plain.
  const pick = (blocks: string[]): string | undefined =>
    blocks.find((b) => tag(b, 'socketType') === 'SSL') ?? blocks.find((b) => tag(b, 'socketType') === 'STARTTLS')
  const imap = pick(incoming)
  const smtp = pick(outgoing)
  if (!imap || !smtp) return null
  return {
    imapHost: tag(imap, 'hostname') ?? '',
    imapPort: Number(tag(imap, 'port') ?? 993),
    imapSecure: tag(imap, 'socketType') === 'SSL',
    smtpHost: tag(smtp, 'hostname') ?? '',
    smtpPort: Number(tag(smtp, 'port') ?? 465),
    smtpSecure: tag(smtp, 'socketType') === 'SSL',
    username: expand(tag(imap, 'username') ?? '%EMAILADDRESS%', email)
  }
}
