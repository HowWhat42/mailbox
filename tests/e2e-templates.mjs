// Templates and HTML signatures: preview in settings, create a template with {{fields}}, insert it
// from the composer, send, and read what arrived; save a message as a template.
// Usage: pnpm build && node tests/e2e-templates.mjs [screenshot-dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await freshEtherealAccount()
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1, smartInbox: false }))

const added = await page.evaluate(
  (box) =>
    window.mailbox.accounts.addImap({
      name: 'Camille Martin',
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
  account
)
await page.reload()
await page.waitForSelector('nav')
step('account added')

// --- HTML signature, previewed in settings -----------------------------------------------------
const signature = '<table><tr><td><b>Camille Martin</b><br><span style="color:#888">Studio Nord</span></td></tr></table>'
await page.click('button[title="Réglages"]')
await page.click(`nav[aria-label="Sections des réglages"] button[aria-label^="Compte "]`)
await page.fill('textarea[aria-label=Signature]', signature)
const preview = page.frameLocator('iframe[title="Aperçu de la signature"]')
await preview.locator('b:text-is("Camille Martin")').waitFor()
await preview.locator('text=Studio Nord').waitFor()
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('text=Compte enregistré')
await page.locator('section:has(h2:text-is("Identité"))').screenshot({ path: join(shots, 'tp-01-signature.png') })
step('HTML signature rendered in the settings preview, saved')

// --- A template with fields -------------------------------------------------------------------
await page.click('button:has-text("Nouveau modèle")')
await page.fill('input[aria-label="Nom du modèle"]', 'Relance devis')
await page.fill('input[aria-label="Objet du modèle"]', 'Devis {{Numéro}}')
await page.click('[aria-label="Corps du modèle"]')
await page.keyboard.type('Bonjour {{Prénom}}, avez-vous pu regarder le devis {{Numéro}} ?')
await page.waitForSelector('[role=dialog] >> text=Champs :')
await page.screenshot({ path: join(shots, 'tp-02-editor.png') })
await page.click('[role=dialog] button:has-text("Enregistrer")')
await page.waitForSelector('text=2 champs : Numéro, Prénom')
step('template created; its fields listed in settings')

// --- Insert it from the composer --------------------------------------------------------------
await page.keyboard.press('Escape')
await page.keyboard.press('c')
const editor = page.locator('.prose-compose')
await editor.locator('b:text-is("Camille Martin")').waitFor()
if ((await editor.innerHTML()).includes('&lt;table')) throw new Error('HTML signature inserted as text')
await page.fill('input[aria-label=Destinataires]', account.user)
await page.keyboard.press('Enter')
await page.click('button:has-text("Modèles")')
await page.click('[role=menuitem]:has-text("Relance devis")')
await page.waitForSelector('[role=dialog] >> text=Remplir')
// Escape belongs to the dialog, not to the composer behind it.
await page.keyboard.press('Escape')
await page.waitForSelector('[role=dialog]', { state: 'detached' })
if (!(await editor.count())) throw new Error('Escape in the template dialog closed the composer')
await page.click('button:has-text("Modèles")')
await page.click('[role=menuitem]:has-text("Relance devis")')
await page.fill('[role=dialog] input[aria-label="Numéro"]', 'D-042')
await page.fill('[role=dialog] input[aria-label="Prénom"]', 'Léa')
await page.click('[role=dialog] button:has-text("Insérer")')
await editor.locator('text=Bonjour Léa, avez-vous pu regarder le devis D-042 ?').waitFor()
if ((await page.inputValue('input[aria-label=Objet]')) !== 'Devis D-042') throw new Error('subject not filled from the template')
await editor.locator('b:text-is("Camille Martin")').waitFor()
await page.screenshot({ path: join(shots, 'tp-03-composer.png') })
step('template inserted with its fields filled; signature kept; Escape stays in the dialog')

await page.keyboard.press('Control+Enter')
await page.waitForSelector('text=Message envoyé', { timeout: 30_000 })
await page.click('button[aria-label=Synchroniser]')
await page.waitForSelector('[role=option]:has-text("Devis D-042")', { timeout: 60_000 })
await page.click('[role=option]:has-text("Devis D-042")')
const body = page.frameLocator('iframe[title="Contenu du message"]').last()
await body.locator('text=Bonjour Léa').waitFor({ timeout: 30_000 })
await body.locator('b:text-is("Camille Martin")').waitFor()
await body.locator('text=Studio Nord').waitFor()
if (await body.locator('text=/\\{\\{/').count()) throw new Error('unfilled {{field}} in the sent message')
step('sent and received: filled text and HTML signature as designed')

// --- Save a message as a template -------------------------------------------------------------
await page.keyboard.press('c')
await page.fill('input[aria-label=Objet]', 'Point hebdo')
await editor.click()
await page.keyboard.press('Control+Home')
await page.keyboard.type('Voici le point de la semaine.')
await page.click('button:has-text("Modèles")')
await page.click('[role=menuitem]:has-text("Enregistrer ce message comme modèle")')
await page.fill('[role=dialog] input[aria-label="Nom du modèle"]', 'Point hebdo')
await page.keyboard.press('Enter')
await page.waitForSelector('text=Modèle « Point hebdo » enregistré')
const saved = await page.evaluate((id) => window.mailbox.templates.list(id), added.id)
const hebdo = saved.find((t) => t.name === 'Point hebdo')
if (!hebdo || hebdo.subject !== 'Point hebdo' || !hebdo.html.includes('Voici le point'))
  throw new Error(`saved template wrong: ${JSON.stringify(hebdo)}`)
if (hebdo.html.includes('Studio Nord')) throw new Error('the signature was saved into the template')
step('message saved as a template, without the signature')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
