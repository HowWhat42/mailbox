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

// Compose: chips + contact autocomplete, then leave → draft is kept on the server.
await page.keyboard.press('c')
await page.waitForSelector('h2:has-text("Nouveau message")')
await page.fill('input[aria-label=Destinataires]', account.user)
await page.keyboard.press('Enter')
await page.click('button:has-text("Cc Cci")')
await page.fill('input[aria-label=Copie]', 'lea')
await page.waitForSelector('text=lea@example.com', { timeout: 10_000 })
await page.keyboard.press('Enter')
await page.waitForSelector('span[title*="lea@example.com"]')
step('contact autocomplete turned "lea" into a chip')
await page.fill('input[aria-label=Objet]', 'Envoyé depuis Mailbox')
await page.click('.prose-compose')
await page.keyboard.type('Ceci est un test envoyé par le client.')
await page.screenshot({ path: join(shots, '05-composer.png') })
await page.keyboard.press('Escape')
await page.waitForSelector('text=Brouillon enregistré', { timeout: 30_000 })
await page.click('nav button[aria-label=Brouillons]')
await page.waitForSelector('[role=option]:has-text("Envoyé depuis Mailbox")', { timeout: 30_000 })
step('closing the composer saved a server draft')

await page.click('[role=option]:has-text("Envoyé depuis Mailbox")')
await page.click('button:has-text("Reprendre le brouillon")')
await page.waitForSelector('span[title*="lea@example.com"]')
await page.keyboard.press('Control+Enter')
await page.waitForSelector('text=Message envoyé', { timeout: 30_000 })
await page.waitForFunction(() => ![...document.querySelectorAll('[role=option]')].some((r) => r.textContent.includes('Envoyé depuis Mailbox')), null, { timeout: 30_000 })
step('draft reopened, sent, and removed from Drafts')

await page.click('nav button[aria-label=Réception]')
await page.waitForSelector('[role=option]:has-text("Envoyé depuis Mailbox")', { timeout: 60_000 }).catch(async () => {
  await page.click('button[aria-label=Synchroniser]')
  await page.waitForSelector('[role=option]:has-text("Envoyé depuis Mailbox")', { timeout: 60_000 })
})
step('sent message received back in inbox')

const hasFacture = () => page.evaluate(() => [...document.querySelectorAll('[role=option]')].some((r) => r.textContent.includes('facture')))
await page.click('[role=option]:has-text("facture")')
await page.keyboard.press('e')
await page.waitForSelector('text=Conversation archivée')
if (await hasFacture()) throw new Error('archived thread still listed')
await page.keyboard.press('z')
await page.waitForSelector('[role=option]:has-text("facture")')
step('archive is undoable with Z')
await page.click('[role=option]:has-text("facture")')
await page.keyboard.press('e')
await page.waitForTimeout(6500)
await page.click('button[aria-label=Synchroniser]')
await page.waitForTimeout(3000)
if (await hasFacture()) throw new Error('archive did not reach the server')
step('archive committed after the undo window')

await page.click('[role=option] >> nth=0', { button: 'right' })
await page.waitForSelector('[role=menu]')
await page.screenshot({ path: join(shots, '06-context-menu.png') })
await page.keyboard.press('Escape')

await page.keyboard.press('Control+k')
await page.waitForSelector('[cmdk-input]')
await page.keyboard.type('env')
await page.screenshot({ path: join(shots, '06b-palette.png') })
await page.keyboard.press('Escape')

await page.fill('#search-input', 'salle étage')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 1)
step('full-text search finds the reply')
await page.fill('#search-input', '')

await page.click('nav button[aria-label=Calendrier]')
await page.waitForSelector('text=Aujourd’hui')
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, '07-calendar.png') })

await page.click('button[aria-label="Thème clair"]')
await page.click('nav button[aria-label=Réception]')
await page.click('[role=option]:has-text("Point projet")')
await page.waitForSelector('article', { timeout: 30_000 })
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '08-light.png') })

await app.close()
if (errors.length) {
  console.error('Renderer errors:\n' + errors.join('\n'))
  process.exit(1)
}
step(`OK — screenshots in ${shots}`)
