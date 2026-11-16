import type { ServerSettings } from '@shared/types'

/**
 * Finds IMAP/SMTP settings for an address the same way Thunderbird does:
 * the provider's own autoconfig file, then Mozilla's ISPDB.
 */
export async function discoverSettings(email: string): Promise<ServerSettings | null> {
  const domain = email.split('@')[1]?.trim().toLowerCase()
  if (!domain) return null
  const sources = [
    `https://autoconfig.${domain}/mail/config-v1.1.xml?emailaddress=${encodeURIComponent(email)}`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
    `https://autoconfig.thunderbird.net/v1.1/${domain}`
  ]
  for (const url of sources) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const settings = parseAutoconfig(await res.text(), email)
      if (settings) return settings
    } catch {
      // next source
    }
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
