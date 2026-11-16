// End-to-end smoke test against a disposable Ethereal mailbox (https://ethereal.email).
// Usage: npm run build && node tests/e2e.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { _electron as electron } from 'playwright'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await nodemailer.createTestAccount()
step(`test account ${account.user}`)

const smtp = nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } })
const first = await smtp.sendMail({
  from: 'Léa Moreau <lea@example.com>',
  to: account.user,
  subject: 'Point projet jeudi',
  html: '<p>Salut,</p><p>On fait le point <b>jeudi à 14h</b> ? Ordre du jour en pièce jointe.</p><p><img src="https://example.com/pixel.png"></p>',
  attachments: [{ filename: 'ordre-du-jour.txt', content: '1. Planning\n2. Budget\n' }]
})
await smtp.sendMail({
  from: 'Léa Moreau <lea@example.com>',
  to: account.user,
  subject: 'Re: Point projet jeudi',
  text: 'Petite précision : la salle est au 3e étage.',
  inReplyTo: first.messageId,
  references: [first.messageId]
})
await smtp.sendMail({ from: 'Facturation <factures@example.org>', to: account.user, subject: 'Votre facture de novembre', text: 'Montant : 42,00 €. Merci !' })
step('3 messages sent')

const userData = mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: process.cwd() })
const errors = []
const page = await app.firstWindow()
page.on('pageerror', (e) => errors.push(e.message))
// Blocked remote images are the privacy feature working, not a failure.
page.on('console', (m) => m.type() === 'error' && !m.text().includes('Content Security Policy') && errors.push(m.text()))
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
await page.waitForSelector('text=Bienvenue dans Mailbox')
await page.screenshot({ path: join(shots, '01-onboarding.png') })

await page.click('text=Autre adresse (IMAP)')
await page.fill('input[placeholder="Camille Martin"]', 'Test Ethereal')
await page.fill('input[type=email]', account.user)
await page.fill('input[type=password]', account.pass)
await page.click('button:has-text("Continuer")')
await page.waitForSelector('text=Serveur IMAP')
const inputs = page.locator('form input')
await inputs.nth(0).fill(account.imap.host)
await inputs.nth(1).fill(String(account.imap.port))
await inputs.nth(2).fill(account.smtp.host)
await inputs.nth(3).fill(String(account.smtp.port))
await page.screenshot({ path: join(shots, '02-servers.png') })
await page.click('button:has-text("Connecter le compte")')
step('account submitted')

await page.waitForSelector('[role=option]', { timeout: 60_000 })
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length >= 2, null, { timeout: 60_000 })
const rows = await page.locator('[role=option]').count()
step(`inbox shows ${rows} threads`)
if (rows !== 2) throw new Error(`expected 2 threads (reply grouped), got ${rows}`)
await page.screenshot({ path: join(shots, '03-inbox.png') })

await page.click('[role=option]:has-text("Point projet")')
await page.waitForSelector('text=ordre-du-jour.txt', { timeout: 30_000 })
await page.waitForSelector('text=Images distantes bloquées')
await page.waitForTimeout(600)
await page.screenshot({ path: join(shots, '04-reader.png') })
step('thread opened with attachment, remote images blocked')

await page.keyboard.press('c')
await page.waitForSelector('text=Nouveau message >> nth=1')
await page.fill('input[placeholder="nom@exemple.fr, …"]', account.user)
await page.locator('form, div').locator('label:has-text("Objet") input').fill('Envoyé depuis Mailbox')
await page.click('.prose-compose')
await page.keyboard.type('Ceci est un test envoyé par le client.')
await page.screenshot({ path: join(shots, '05-composer.png') })
await page.keyboard.press('Control+Enter')
await page.waitForSelector('text=Message envoyé', { timeout: 30_000 })
step('message sent')

await page.waitForSelector('[role=option]:has-text("Envoyé depuis Mailbox")', { timeout: 60_000 }).catch(async () => {
  await page.click('button[title=Synchroniser]')
  await page.waitForSelector('[role=option]:has-text("Envoyé depuis Mailbox")', { timeout: 60_000 })
})
step('sent message received back in inbox')

await page.click('[role=option]:has-text("facture")')
await page.keyboard.press('e')
await page.waitForSelector('text=Archivé')
await page.waitForFunction(() => ![...document.querySelectorAll('[role=option]')].some((r) => r.textContent.includes('facture')))
step('archive removed the thread')

await page.keyboard.press('Control+k')
await page.waitForSelector('[cmdk-input]')
await page.keyboard.type('env')
await page.screenshot({ path: join(shots, '06-palette.png') })
await page.keyboard.press('Escape')

await page.fill('#search-input', 'salle étage')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 1)
step('full-text search finds the reply')
await page.fill('#search-input', '')

await page.click('text=Calendrier')
await page.waitForSelector('text=Aujourd’hui')
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '07-calendar.png') })

await page.click('button[title="Thème clair"]')
await page.click('text=Réception >> nth=0')
await page.click('[role=option] >> nth=0')
await page.waitForSelector('text=Chargement du message', { state: 'detached', timeout: 30_000 })
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '08-light.png') })

await app.close()
if (errors.length) {
  console.error('Renderer errors:\n' + errors.join('\n'))
  process.exit(1)
}
step(`OK — screenshots in ${shots}`)
