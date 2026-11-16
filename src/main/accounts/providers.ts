/** Known mail providers: by address domain, or by the domain's MX hosts (hosted business mail). */

export interface Provider {
  name: string
  imap: [host: string, port: number, tls: boolean]
  smtp: [host: string, port: number, tls: boolean]
  /** Shown under the detected settings. */
  note?: string
  /** Address domains served by this provider. */
  domains?: RegExp
  /** MX host suffixes that reveal this provider behind a custom domain. */
  mx?: RegExp
}

const APP_PASSWORD = 'Utilisez un mot de passe d’application si la validation en deux étapes est activée.'

export const PROVIDERS: Provider[] = [
  {
    name: 'Gmail / Google Workspace',
    imap: ['imap.gmail.com', 993, true],
    smtp: ['smtp.gmail.com', 465, true],
    note: `${APP_PASSWORD} La connexion Google (OAuth) évite ce mot de passe.`,
    domains: /^(gmail\.com|googlemail\.com)$/,
    mx: /(\.|^)(google\.com|googlemail\.com)$/
  },
  {
    name: 'Outlook / Microsoft 365',
    imap: ['outlook.office365.com', 993, true],
    smtp: ['smtp.office365.com', 587, false],
    note: 'Microsoft a désactivé la connexion par mot de passe pour la plupart des comptes : la connexion Microsoft n’est pas encore disponible dans Mailbox.',
    domains: /^(outlook\.[a-z.]+|hotmail\.[a-z.]+|live\.[a-z.]+|msn\.com)$/,
    mx: /\.(protection\.outlook\.com|outlook\.com)$/
  },
  {
    name: 'iCloud',
    imap: ['imap.mail.me.com', 993, true],
    smtp: ['smtp.mail.me.com', 587, false],
    note: 'Créez un mot de passe pour app sur appleid.apple.com ; l’identifiant est votre adresse iCloud.',
    domains: /^(icloud\.com|me\.com|mac\.com)$/,
    mx: /\.mail\.icloud\.com$/
  },
  {
    name: 'Yahoo',
    imap: ['imap.mail.yahoo.com', 993, true],
    smtp: ['smtp.mail.yahoo.com', 465, true],
    note: 'Générez un mot de passe d’application dans la sécurité du compte Yahoo.',
    domains: /^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/,
    mx: /\.yahoodns\.net$/
  },
  { name: 'AOL', imap: ['imap.aol.com', 993, true], smtp: ['smtp.aol.com', 465, true], note: APP_PASSWORD, domains: /^(aol\.[a-z.]+|aim\.com)$/ },
  {
    name: 'Fastmail',
    imap: ['imap.fastmail.com', 993, true],
    smtp: ['smtp.fastmail.com', 465, true],
    note: 'Créez un mot de passe d’application dans Paramètres › Confidentialité et sécurité.',
    domains: /^(fastmail\.[a-z.]+|fastmail\.fm)$/,
    mx: /\.messagingengine\.com$/
  },
  {
    name: 'Proton Mail (Bridge)',
    imap: ['127.0.0.1', 1143, false],
    smtp: ['127.0.0.1', 1025, false],
    note: 'Proton Mail passe par Proton Mail Bridge, lancé sur cet ordinateur : utilisez le mot de passe affiché par Bridge.',
    domains: /^(proton\.me|protonmail\.(com|ch)|pm\.me)$/,
    mx: /\.protonmail\.ch$/
  },
  {
    name: 'Zoho Mail',
    imap: ['imap.zoho.com', 993, true],
    smtp: ['smtp.zoho.com', 465, true],
    domains: /^(zoho\.com|zohomail\.com)$/,
    mx: /\.zoho\.(com|eu|in)$/
  },
  { name: 'GMX', imap: ['imap.gmx.net', 993, true], smtp: ['mail.gmx.net', 587, false], domains: /^gmx\.[a-z.]+$/, mx: /\.gmx\.net$/ },
  {
    name: 'Yandex',
    imap: ['imap.yandex.com', 993, true],
    smtp: ['smtp.yandex.com', 465, true],
    note: APP_PASSWORD,
    domains: /^(yandex\.[a-z.]+|ya\.ru)$/
  },
  { name: 'Free', imap: ['imap.free.fr', 993, true], smtp: ['smtp.free.fr', 465, true], domains: /^free\.fr$/ },
  { name: 'Orange', imap: ['imap.orange.fr', 993, true], smtp: ['smtp.orange.fr', 465, true], domains: /^(orange\.fr|wanadoo\.fr)$/ },
  { name: 'SFR', imap: ['imap.sfr.fr', 993, true], smtp: ['smtp.sfr.fr', 465, true], domains: /^(sfr\.fr|neuf\.fr)$/ },
  { name: 'La Poste', imap: ['imap.laposte.net', 993, true], smtp: ['smtp.laposte.net', 465, true], domains: /^laposte\.net$/ },
  {
    name: 'Infomaniak',
    imap: ['mail.infomaniak.com', 993, true],
    smtp: ['mail.infomaniak.com', 465, true],
    domains: /^(ik\.me|etik\.com|ikmail\.com)$/,
    mx: /\.infomaniak\.ch$/
  },
  { name: 'OVHcloud', imap: ['ssl0.ovh.net', 993, true], smtp: ['ssl0.ovh.net', 465, true], mx: /\.(ovh\.net|mail\.ovh\.net)$/ },
  {
    name: 'IONOS',
    imap: ['imap.ionos.fr', 993, true],
    smtp: ['smtp.ionos.fr', 465, true],
    mx: /\.(ionos\.[a-z.]+|1and1\.[a-z.]+|kundenserver\.de)$/
  },
  { name: 'Gandi', imap: ['mail.gandi.net', 993, true], smtp: ['mail.gandi.net', 465, true], mx: /\.gandi\.net$/ },
  { name: 'Hostinger', imap: ['imap.hostinger.com', 993, true], smtp: ['smtp.hostinger.com', 465, true], mx: /\.hostinger\.com$/ },
  { name: 'QQ Mail', imap: ['imap.qq.com', 993, true], smtp: ['smtp.qq.com', 465, true], note: APP_PASSWORD, domains: /^(qq\.com|foxmail\.com)$/ },
  { name: '163 / 126 Mail', imap: ['imap.163.com', 993, true], smtp: ['smtp.163.com', 465, true], domains: /^(163\.com|126\.com)$/ }
]

export function byDomain(domain: string): Provider | undefined {
  return PROVIDERS.find((p) => p.domains?.test(domain))
}

export function byMx(hosts: string[]): Provider | undefined {
  for (const host of hosts) {
    const p = PROVIDERS.find((x) => x.mx?.test(host.toLowerCase().replace(/\.$/, '')))
    if (p) return p
  }
  return undefined
}
