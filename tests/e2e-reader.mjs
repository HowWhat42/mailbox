// Reader features: folded quotes (and, as they land, images, sender security, codes…).
// Usage: pnpm build && node tests/e2e-reader.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await freshEtherealAccount()
const smtp = createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass }
})
const send = (opts) => smtp.sendMail({ to: account.user, ...opts })

await send({
  from: 'Léa Moreau <lea@example.com>',
  subject: 'Re: Budget 2027',
  html:
    '<div dir="ltr">Parfait, on valide comme ça.</div><br>' +
    '<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">Le lun. 16 nov. 2026 à 09:00, Bob a écrit :</div>' +
    '<blockquote class="gmail_quote">Voici la proposition de budget détaillée.<br>Ligne 1<br>Ligne 2<br>Ligne 3<br>Ligne 4</blockquote></div>'
})
await send({
  from: 'Paul Durand <paul@example.com>',
  subject: 'Re: Horaires',
  text: 'Oui, 14h me va.\n\nLe 15/11/2026 à 18:00, Toi a écrit :\n> On se voit à quelle heure ?\n> Je suis dispo l’après-midi.'
})
// A five-message conversation over four days, one of them from us.
const day = 86_400_000
const atlas = [
  ['Claire Dubois <claire@example.com>', 4 * day, 'Voici le planning du projet Atlas.'],
  [`Test <${account.user}>`, 3 * day, 'Merci, je regarde ça.'],
  ['Claire Dubois <claire@example.com>', 3 * day - 3_600_000, 'Je t’envoie aussi le budget.'],
  ['Marc Petit <marc@example.com>', day, 'Je valide le planning.'],
  ['Claire Dubois <claire@example.com>', 0, 'Parfait, on lance lundi.']
]
for (const [i, [from, ago, text]] of atlas.entries()) {
  await send({
    from,
    cc: 'marc@example.com',
    subject: i ? 'Re: Projet Atlas' : 'Projet Atlas',
    text,
    date: new Date(Date.now() - ago),
    messageId: `<atlas-${i}@example.com>`,
    ...(i ? { inReplyTo: `<atlas-${i - 1}@example.com>`, references: atlas.slice(0, i).map((_, j) => `<atlas-${j}@example.com>`) } : {})
  })
}
step('a Gmail-style reply, a plain-text reply and a five-message conversation sent')

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ smartInbox: false, uiScale: 1 }))

await page.click('text=Autre adresse (IMAP)')
await page.fill('input[placeholder="Camille Martin"]', 'Test')
await page.fill('input[type=email]', account.user)
await page.fill('input[type=password]', account.pass)
await page.click('button:has-text("Continuer")')
await page.waitForSelector('text=Serveur IMAP')
const inputs = page.locator('form input')
await inputs.nth(0).fill(account.imap.host)
await inputs.nth(1).fill(String(account.imap.port))
await inputs.nth(2).fill(account.smtp.host)
await inputs.nth(3).fill(String(account.smtp.port))
await page.click('button:has-text("Connecter le compte")')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 2, null, { timeout: 60_000 })

// Conversation timeline: summary, our own message marked, day changes, older messages folded.
await page.waitForSelector('[role=option]:has-text("Projet Atlas")', { timeout: 60_000 })
await page.click('[role=option]:has-text("Projet Atlas")')
const conv = page.locator('ol[aria-label="Messages de la conversation"]')
await page.waitForSelector('text=5 messages · 3 participants · sur 4 jours', { timeout: 30_000 }).catch(async (err) => {
  await page.screenshot({ path: join(shots, 'r-00-conversation-fail.png') })
  throw err
})
if ((await conv.locator('article').count()) !== 5) throw new Error('new messages should all be open on first read')
if ((await conv.locator('li[data-mine]').count()) !== 1) throw new Error('our own message should be marked')
await conv.locator('article[aria-label="Message de Vous"]').waitFor()
await conv.locator('text=La veille').first().waitFor()
await conv.locator('text=/2 jours plus tôt/').waitFor()
const order = await conv.locator('article time[datetime]').evaluateAll((els) => els.map((e) => Date.parse(e.getAttribute('datetime'))))
if (order.some((t, i) => i && t > order[i - 1])) throw new Error('newest message should come first')
if (await conv.locator('.mb-quote-toggle').count()) throw new Error('no quote to fold in these messages')
await page.screenshot({ path: join(shots, 'r-00-conversation.png') })
await page.click('[role=option]:has-text("Budget 2027")')
await page.click('[role=option]:has-text("Projet Atlas")')
await conv.locator('text=2 messages plus anciens').click()
await conv.locator('button[aria-label="Déplier le message de Vous"]').waitFor()
if ((await conv.locator('article').count()) !== 1) throw new Error('only the latest message should be open once read')
await page.screenshot({ path: join(shots, 'r-00-conversation-read.png') })
step('conversation timeline: newest first, summary, own message, day gaps, older messages folded')

const body = () => page.frameLocator('iframe[title="Contenu du message"]').last()
const frameHeight = () =>
  page
    .locator('iframe[title="Contenu du message"]')
    .last()
    .evaluate((f) => f.getBoundingClientRect().height)

for (const [subject, quoted, fresh] of [
  ['Budget 2027', 'Ligne 4', 'on valide'],
  ['Horaires', 'quelle heure', '14h me va']
]) {
  await page.click(`[role=option]:has-text("${subject}")`)
  await body().locator(`text=${fresh}`).waitFor({ timeout: 30_000 })
  if (await body().locator(`text=${quoted}`).isVisible()) throw new Error(`${subject}: quoted text should be folded`)
  const folded = await frameHeight()
  await body().locator('.mb-quote-toggle').click()
  await body().locator(`text=${quoted}`).waitFor({ state: 'visible' })
  await page.waitForTimeout(200)
  if ((await frameHeight()) <= folded) throw new Error(`${subject}: frame did not grow after unfolding`)
  step(`${subject}: quote folded behind •••, unfolds on click`)
}
await page.screenshot({ path: join(shots, 'r-01-quotes.png') })

// Folder actions: mark the whole inbox read from the list's ⋯ menu, then empty the trash.
const unreadInInbox = () =>
  page.evaluate(() => window.mailbox.mail.list({ type: 'unified', role: 'inbox' }, 'unread', 'all', 50).then((r) => r.length))
await page.click('button[aria-label="Marquer comme non lu (U)"]')
await page.waitForFunction(() => window.mailbox.mail.list({ type: 'unified', role: 'inbox' }, 'unread', 'all', 50).then((r) => r.length === 1))
await page.click('button[aria-label="Actions sur cette vue"]')
await page.click('[role=menuitem]:has-text("Tout marquer comme lu")')
await page.waitForSelector('text=1 message marqué comme lu', { timeout: 15_000 })
if (await unreadInInbox()) throw new Error('inbox still has unread messages')
step('"mark all as read" from the view menu')

await page.click('[role=option]:has-text("Horaires")')
await page.keyboard.press('#')
await page.waitForTimeout(6_500) // undo window, then the move reaches the server
await page.click('button[aria-label=Synchroniser]')
await page.locator('nav button:has-text("Test")').click()
await page.locator('nav button[aria-label=Corbeille]').waitFor({ timeout: 30_000 })
await page.locator('nav button[aria-label=Corbeille]').click({ button: 'right' })
await page.click('[role=menuitem]:has-text("Vider la corbeille")')
await page.click('[role=alertdialog] button:has-text("Vider")')
await page.waitForSelector('text=supprimé', { timeout: 30_000 })
await page.locator('nav button[aria-label=Corbeille]').click()
await page.waitForSelector('text=Tout est traité', { timeout: 10_000 })
step('trash emptied from the folder right-click menu')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
