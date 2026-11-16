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
step('a Gmail-style reply and a plain-text reply sent')

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

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
