// README screenshots, from demo data only: two throwaway Ethereal mailboxes filled with
// made-up mail, and a local .ics feed for the calendar. Nothing touches your own data.
// Usage: pnpm build && node scripts/screenshots.mjs   (writes docs/screenshots/*.png)
import { mkdirSync, mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from '../tests/ethereal.mjs'

const out = join(process.cwd(), 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const log = (msg) => console.log(`• ${msg}`)

const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = Date.now()

// ---------------------------------------------------------------- demo mail
const perso = await freshEtherealAccount()
const studio = await freshEtherealAccount()
const transport = (acc) =>
  createTransport({ host: acc.smtp.host, port: acc.smtp.port, secure: acc.smtp.secure, auth: { user: acc.user, pass: acc.pass } })
const mailTo = (acc) => {
  const smtp = transport(acc)
  return (opts) => smtp.sendMail({ to: `Camille Martin <${acc.user}>`, ...opts })
}
const toPerso = mailTo(perso)
const toStudio = mailTo(studio)
const newsletter = (from, subject, html, ago) => ({
  from,
  subject,
  html,
  date: new Date(now - ago),
  list: { unsubscribe: { url: 'https://example.com/unsubscribe', comment: 'Se désabonner' } }
})
const pdf = (name) => ({ filename: name, content: Buffer.from('%PDF-1.4\n% demo\n'), contentType: 'application/pdf' })

// A conversation of four exchanges, one of them ours.
const thread = [
  [
    'Léa Moreau <lea.moreau@example.com>',
    2 * DAY + 3 * HOUR,
    'Week-end à Annecy ?',
    'Salut ! On bloque le week-end du 28 pour Annecy ? Je peux réserver le chalet ce soir.'
  ],
  [`Camille Martin <${perso.user}>`, 2 * DAY, 'Re: Week-end à Annecy ?', 'Carrément partante. Tu peux prendre l’option avec le petit-déjeuner ?'],
  [
    'Léa Moreau <lea.moreau@example.com>',
    DAY + 5 * HOUR,
    'Re: Week-end à Annecy ?',
    'C’est réservé ! Je t’envoie la confirmation. Il reste à voir pour le train.'
  ],
  [
    'Léa Moreau <lea.moreau@example.com>',
    40 * 60_000,
    'Re: Week-end à Annecy ?',
    'J’ai trouvé un TGV à 8h12 samedi, 34 € chacune. Je prends deux places ?'
  ]
]
for (const [i, [from, ago, subject, text]] of thread.entries()) {
  await toPerso({
    from,
    subject,
    text,
    date: new Date(now - ago),
    messageId: `<annecy-${i}@example.com>`,
    ...(i ? { inReplyTo: `<annecy-${i - 1}@example.com>`, references: thread.slice(0, i).map((_, j) => `<annecy-${j}@example.com>`) } : {}),
    ...(i === 2 ? { attachments: [pdf('Confirmation-chalet.pdf')] } : {})
  })
}
await toPerso({
  from: 'Julien Bernard <julien.bernard@example.com>',
  subject: 'Photos du mariage',
  text: 'Voici la sélection des photos du mariage, dis-moi lesquelles tu veux en tirage.',
  date: new Date(now - 3 * HOUR)
})
await toPerso({
  from: 'Banque Horizon <alertes@banque-horizon.example>',
  subject: 'Votre relevé de novembre est disponible',
  text: 'Votre relevé de compte est disponible dans votre espace client.',
  date: new Date(now - 6 * HOUR),
  headers: { 'Auto-Submitted': 'auto-generated' }
})
await toPerso({
  from: 'Forge CI <notifications@forge-ci.example>',
  subject: '[atlas] Build #482 réussi sur main',
  text: 'Le build #482 de atlas est passé en 3 min 12 s.',
  date: new Date(now - 2 * HOUR),
  headers: { 'Auto-Submitted': 'auto-generated' }
})
await toPerso(
  newsletter(
    'Le Petit Journal du Vélo <hello@petitjournalvelo.example>',
    'Cinq cols à grimper avant l’hiver',
    '<h2>Cinq cols à grimper avant l’hiver</h2><p>Notre sélection pour finir la saison en beauté.</p>',
    5 * HOUR
  )
)
await toPerso(
  newsletter(
    'Cuisine du Marché <recettes@cuisinedumarche.example>',
    'Trois soupes pour la semaine',
    '<p>Potiron, poireaux, châtaignes.</p>',
    9 * HOUR
  )
)

await toStudio({
  from: 'Sophie Laurent <sophie@atelier-nord.example>',
  subject: 'Maquettes v3 de la page d’accueil',
  text: 'Voici la v3 des maquettes, avec la nouvelle grille. Tu peux regarder avant la revue de jeudi ?',
  date: new Date(now - 90 * 60_000),
  attachments: [pdf('Maquettes-v3.pdf')]
})
await toStudio({
  from: 'Hugo Petit <hugo.petit@example.com>',
  subject: 'Facture novembre',
  text: 'Bonjour, vous trouverez ci-joint la facture de novembre. Bonne journée !',
  date: new Date(now - 4 * HOUR),
  attachments: [pdf('Facture-2026-11.pdf')]
})
await toStudio(
  newsletter('Design Weekly <digest@designweekly.example>', 'Typographie variable : le guide', '<p>Tout sur les fontes variables.</p>', 7 * HOUR)
)
log('demo mail sent to two throwaway mailboxes')

// ---------------------------------------------------------------- demo calendar
const monday = new Date()
monday.setHours(0, 0, 0, 0)
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
const at = (day, h, m = 0) => {
  const d = new Date(monday.getTime() + day * DAY)
  d.setHours(h, m, 0, 0)
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '') // keeps the Z: UTC
}
const vevent = (uid, day, h, m, minutes, summary, extra = []) => [
  'BEGIN:VEVENT',
  `UID:${uid}@demo`,
  `DTSTAMP:${at(0, 8)}`,
  `DTSTART:${at(day, h, m)}`,
  `DTEND:${at(day, h, m + minutes)}`,
  `SUMMARY:${summary}`,
  ...extra,
  'END:VEVENT'
]
const meet = (code) => [`LOCATION:https://meet.google.com/${code}`, `DESCRIPTION:Rejoindre : https://meet.google.com/${code}`]
const calendar = (name, events) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mailbox demo//FR', `X-WR-CALNAME:${name}`, ...events.flat(), 'END:VCALENDAR', ''].join('\r\n')
const feeds = {
  '/travail.ics': calendar('Travail', [
    vevent('standup', 0, 9, 30, 15, 'Point d’équipe', ['RRULE:FREQ=DAILY;COUNT=5', ...meet('abc-defg-hij')]),
    vevent('design', 3, 14, 0, 60, 'Revue design · page d’accueil', meet('xyz-uvwx-rst')),
    vevent('client', 1, 11, 0, 90, 'Atelier client Nord', ['LOCATION:12 rue des Arts, Lyon']),
    vevent('focus', 2, 10, 0, 120, 'Bloc de concentration'),
    vevent('call', 4, 16, 0, 45, 'Appel Banque Horizon', meet('klm-nopq-rst'))
  ]),
  '/perso.ics': calendar('Perso', [
    vevent('lunch', 2, 12, 30, 60, 'Déjeuner avec Léa'),
    vevent('sport', 1, 18, 30, 60, 'Escalade'),
    vevent('sport2', 3, 18, 30, 60, 'Escalade'),
    vevent('cinema', 4, 19, 30, 120, 'Cinéma'),
    vevent('market', 5, 10, 0, 90, 'Marché de la Croix-Rousse')
  ])
}
const server = createServer((req, res) => res.writeHead(200, { 'Content-Type': 'text/calendar' }).end(feeds[req.url] ?? ''))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

// ---------------------------------------------------------------- app
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-shots-'))}`] })
const page = await app.firstWindow()
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1440, 900)
  win.center()
})
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1, smartInbox: false, theme: 'dark', accent: '#8f86f0', remoteImages: 'allow' }))

const addAccount = (acc, name) =>
  page.evaluate(
    ({ box, label }) =>
      window.mailbox.accounts.addImap({
        name: label,
        email: box.user,
        username: box.user,
        password: box.pass,
        imapHost: box.imap.host,
        imapPort: box.imap.port,
        imapSecure: box.imap.secure,
        smtpHost: box.smtp.host,
        smtpPort: box.smtp.port,
        smtpSecure: box.smtp.secure,
        caldavUrl: null
      }),
    { box: acc, label: name }
  )
const a1 = await addAccount(perso, 'Camille Martin')
const a2 = await addAccount(studio, 'Camille Martin')
await page.evaluate(
  ({ persoId, studioId }) =>
    Promise.all([
      window.mailbox.accounts.update(persoId, { label: 'Perso', color: '#2dd4bf' }),
      window.mailbox.accounts.update(studioId, { label: 'Studio', color: '#f5b041' })
    ]),
  { persoId: a1.id, studioId: a2.id }
)
const base = `http://127.0.0.1:${server.address().port}`
for (const [calName, path, calColor] of [
  ['Travail', '/travail.ics', '#5b8cff'],
  ['Perso', '/perso.ics', '#2dd4bf']
]) {
  const source = await page.evaluate((input) => window.mailbox.calendar.addSource({ kind: 'ics', ...input }), { name: calName, url: base + path })
  await page.evaluate(
    async ({ sourceId, tint }) => {
      for (const c of await window.mailbox.calendar.calendars())
        if (c.sourceId === sourceId) await window.mailbox.calendar.setCalendarColor(c.id, tint)
    },
    { sourceId: source.id, tint: calColor }
  )
}
await page.reload()
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 9, null, { timeout: 120_000 })
await page.waitForTimeout(1500)
log('app filled: two accounts, a calendar')

// The throwaway Ethereal addresses read like noise: show readable ones in the pictures.
const disguise = { [perso.user]: 'camille@exemple.fr', [studio.user]: 'camille@studio-nord.fr' }
const mask = () =>
  page.evaluate((map) => {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      for (const [from, to] of Object.entries(map)) if (n.nodeValue.includes(from)) n.nodeValue = n.nodeValue.replaceAll(from, to)
    }
    for (const el of document.querySelectorAll('[title]')) {
      for (const [from, to] of Object.entries(map)) el.title = el.title.replaceAll(from, to)
    }
  }, disguise)

const shot = async (name) => {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(500)
  await mask()
  await page.screenshot({ path: join(out, `${name}.png`) })
  log(`${name}.png`)
}
const open = async (subject) => {
  await page.click(`[role=option]:has-text("${subject}")`)
  await page.waitForSelector('article', { timeout: 30_000 })
  await page.waitForTimeout(800)
}

// 1. Unified inbox with a conversation open.
await open('Week-end à Annecy')
await shot('inbox')

// 2. Smart inbox: newsletters and notifications bundled.
await page.evaluate(() => window.mailbox.settings.set({ smartInbox: true }))
await page.click('nav button[aria-label="Toutes les boîtes"]')
await page.waitForSelector('[data-bundle]', { timeout: 30_000 })
await shot('smart-inbox')
await page.evaluate(() => window.mailbox.settings.set({ smartInbox: false }))

// 3. Calendar, week view.
await page.click('nav button:has-text("Calendrier")')
await page.waitForSelector('text=Revue design', { timeout: 60_000 })
await shot('calendar')

// 4. Light theme.
await page.click('nav button[aria-label="Toutes les boîtes"]')
await page.evaluate(() => window.mailbox.settings.set({ theme: 'light' }))
await open('Maquettes v3')
await shot('light')

// 5. Accent colours (dark).
await page.evaluate(() => window.mailbox.settings.set({ theme: 'dark' }))
for (const [name, hex] of [
  ['ambre', '#f5b041'],
  ['lagon', '#2dd4bf']
]) {
  await page.evaluate((accent) => window.mailbox.settings.set({ accent }), hex)
  await shot(`accent-${name}`)
}

// 6. Appearance settings.
await page.evaluate(() => window.mailbox.settings.set({ accent: '#8f86f0' }))
await page.click('button[title="Réglages"]')
await page.click('nav[aria-label="Sections des réglages"] button:has-text("Apparence")')
await shot('settings')

await app.close()
server.close()
log(`done: ${out}`)
