// Smart inbox, rules, unsubscribe, appearance and login-item settings, against an Ethereal mailbox.
// Usage: npm run build && node tests/e2e-triage.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { _electron as electron } from 'playwright'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await nodemailer.createTestAccount()
const smtp = nodemailer.createTransport({ host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure, auth: { user: account.user, pass: account.pass } })
const send = (opts) => smtp.sendMail({ to: account.user, ...opts })

await send({ from: 'Léa Moreau <lea@example.com>', subject: 'On déjeune vendredi ?', text: 'Ça te dit, vers 12h30 ?' })
await send({ from: 'Léa Moreau <lea@example.com>', subject: 'Facture du traiteur', text: 'Je te transfère la facture.' })
await send({
  from: 'Brand Weekly <hello@brand.example>',
  subject: 'Les nouveautés de la semaine',
  html: '<h1>Nouveautés</h1><p>Découvrez nos offres.</p>',
  headers: { 'List-Unsubscribe': '<mailto:unsubscribe@brand.example?subject=unsubscribe>, <https://brand.example/u/123>', Precedence: 'bulk' }
})
await send({
  from: 'GitHub <notifications@github.example>',
  subject: '[repo] Nouvelle issue #42',
  text: 'Quelqu’un a ouvert une issue.',
  headers: { 'Auto-Submitted': 'auto-generated', 'List-Id': 'repo <repo.github.example>' }
})
const start = new Date(Date.now() + 2 * 86_400_000)
await send({
  from: 'Bob Martin <bob@example.com>',
  subject: 'Invitation: Revue de sprint',
  text: 'Revue de sprint jeudi.',
  icalEvent: {
    method: 'REQUEST',
    content: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:sprint-1',
      `DTSTART:${start.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      'SUMMARY:Revue de sprint',
      'ORGANIZER:mailto:bob@example.com',
      `ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:${account.user}`,
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
  }
})
step('5 messages sent: 2 from a person, a newsletter, a notification, an invitation')

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && !m.text().includes('Content Security Policy') && errors.push(m.text()))

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

const rows = () => page.locator('[role=option]')
const bundle = (c) => page.locator(`[data-bundle="${c}"]`)
const back = () => page.click('button[aria-label="Retour à la réception"]')
const expectRows = async (label, texts) => {
  await page.waitForFunction(
    (want) => {
      const got = [...document.querySelectorAll('[role=option]')].map((r) => r.textContent)
      return got.length === want.length && want.every((w) => got.some((g) => g.includes(w)))
    },
    texts,
    { timeout: 60_000 }
  ).catch(async () => {
    throw new Error(`${label}: expected ${JSON.stringify(texts)}, got ${JSON.stringify(await rows().allTextContents())}`)
  })
}

await expectRows('Personnes', ['On déjeune', 'Facture du traiteur'])
for (const c of ['notifications', 'newsletters', 'invitations']) await bundle(c).waitFor()
await page.screenshot({ path: join(shots, 't-01-bundles.png') })
await bundle('notifications').click()
await expectRows('Notifications', ['Nouvelle issue'])
await back()
await bundle('invitations').click()
await expectRows('Invitations', ['Revue de sprint'])
await page.keyboard.press('Escape')
await bundle('newsletters').click()
await expectRows('Newsletters', ['nouveautés'])
step('smart inbox: people listed, notifications / newsletters / invitations bundled')

await rows().first().click()
await page.waitForSelector('text=Classé dans Newsletters')
await page.screenshot({ path: join(shots, 't-02-newsletter.png') })
await page.click('button:has-text("Se désabonner")')
await page.click('[role=alertdialog] button:has-text("Se désabonner")')
await page.waitForSelector('text=Désabonné de Brand Weekly', { timeout: 30_000 })
// Toasts must clear themselves.
await page.waitForSelector('text=Désabonné de Brand Weekly', { state: 'detached', timeout: 8_000 })
step('unsubscribed through List-Unsubscribe (mailto)')

await rows().first().click({ button: 'right' })
await page.click('[role=menuitem]:has-text("Toujours classer dans Personnes")')
await page.waitForSelector('text=iront dans Personnes')
await back()
await expectRows('Personnes after sender rule', ['On déjeune', 'Facture du traiteur', 'nouveautés'])
step('"always sort this sender into People" created a rule and re-sorted')

// A rule from the settings: anything with "facture" in the subject goes to Notifications.
await page.click('button[aria-label=Réglages]')
await page.click('nav[aria-label="Sections des réglages"] button:has-text("Tri & règles")')
await page.click('button:has-text("Nouvelle règle")')
await page.locator('[aria-label=Champ]').first().click()
await page.click('[role=menuitem]:has-text("L’objet")')
await page.fill('input[aria-label=Valeur]', 'facture')
await page.locator('[aria-label=Catégorie]').click()
await page.click('[role=menuitem]:has-text("Notifications")')
await page.screenshot({ path: join(shots, 't-03-rule-editor.png') })
await page.click('button:has-text("Enregistrer la règle")')
await page.waitForSelector('text=Règle enregistrée')
await page.keyboard.press('Escape')
await expectRows('Personnes after subject rule', ['On déjeune', 'nouveautés'])
step('subject rule moved the invoice to Notifications')

await bundle('notifications').hover()
await page.click('button[aria-label="Tout marquer comme lu dans Notifications"]')
await page.waitForSelector('text=marqués comme lus')
step('bundle "mark all read"')

// Appearance: accent + density.
await page.click('button[aria-label=Réglages]')
await page.click('nav[aria-label="Sections des réglages"] button:has-text("Apparence")')
await page.click('button[aria-label="Accent Corail"]')
const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
if (accent !== '#fb7c5c') throw new Error(`accent not applied: ${accent}`)
await page.click('[role=radio]:has-text("Compacte")')
await page.locator('[aria-label="Taille de l’interface"]').click()
await page.click('[role=menuitem]:has-text("120 %")')
await page.waitForTimeout(400)
const zoom = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
if (Math.abs(zoom - 1.2) > 0.01) throw new Error(`interface zoom not applied: ${zoom}`)
await page.locator('[aria-label="Taille de l’interface"]').click()
await page.click('[role=menuitem]:has-text("Automatique")')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, 't-04-appearance.png') })
step('accent colour, density and interface size applied live')

await page.click('nav[aria-label="Sections des réglages"] button:has-text("Notifications")')
await page.screenshot({ path: join(shots, 't-05-notifications.png') })

// Start with Windows: real registration, then removed again.
await page.click('nav[aria-label="Sections des réglages"] button:has-text("Général")')
const loginToggle = page.locator('div:has(> div > p:has-text("Lancer Mailbox au démarrage de Windows")) [role=switch]')
await loginToggle.click()
await page.waitForSelector('text=Enregistré auprès de Windows.', { timeout: 10_000 })
await page.screenshot({ path: join(shots, 't-06-general.png') })
const registered = await app.evaluate(({ app }) => app.getLoginItemSettings({ path: process.execPath, args: [app.getAppPath(), '--hidden'] }).openAtLogin)
if (!registered) throw new Error('login item not registered with the OS')
await loginToggle.click()
await page.waitForSelector('text=Pas lancé au démarrage.', { timeout: 10_000 })
step('start-with-Windows registered with the OS, then removed')

await page.keyboard.press('Escape')
await page.waitForSelector('[data-bundle]')
await page.screenshot({ path: join(shots, 't-07-inbox-compact.png') })
// Maximised on the current screen: bigger list, automatic zoom.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
await page.waitForTimeout(800)
await page.screenshot({ path: join(shots, 't-08-maximized.png') })

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
