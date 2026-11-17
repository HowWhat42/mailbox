// Folders: create one and a subfolder from the sidebar (checked on the server), nested display of
// subfolders made elsewhere, favourites pinned to the sidebar.
// Usage: pnpm build && node tests/e2e-folders.mjs [screenshot-dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImapFlow } from 'imapflow'
import { createTransport } from 'nodemailer'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await freshEtherealAccount()
const imap = () =>
  new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: { user: account.user, pass: account.pass },
    logger: false
  })
// A nested folder made by another client: it must show under its parent.
const other = imap()
await other.connect()
const delimiter = (await other.list()).find((f) => f.delimiter)?.delimiter ?? '/'
await other.mailboxCreate(`Archives 2024`)
await other.mailboxCreate(`Archives 2024${delimiter}Janvier`)
// A message tagged by another client: a Thunderbird tag and a plain keyword.
await createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass }
}).sendMail({
  from: 'Léa <lea@example.com>',
  to: account.user,
  subject: 'Devis cuisine',
  text: 'Voici le devis.'
})
for (let i = 0; i < 20 && !(await other.status('INBOX', { messages: true })).messages; i++) await new Promise((r) => setTimeout(r, 1000))
await other.mailboxOpen('INBOX')
await other.messageFlagsAdd('1:*', ['$label2', 'Devis'])
await other.logout()
step(`"Archives 2024${delimiter}Janvier" created and a message tagged by another client`)

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1 }))
await page.evaluate(
  (box) =>
    window.mailbox.accounts.addImap({
      name: 'Camille',
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
const nav = page.locator('nav')
await nav.locator('button:has-text("Archives 2024")').waitFor({ timeout: 60_000 })
if (await nav.locator('button:has-text("Janvier")').count()) throw new Error('subfolder shown before its parent is unfolded')
await nav.locator('button[aria-label="Déplier les sous-dossiers"]').first().click()
await nav.locator('button:has-text("Janvier")').waitFor()
const indent = async (name) =>
  nav.locator(`button:has-text("${name}")`).evaluate((el) => el.closest('[style*="padding-left"]')?.style.paddingLeft ?? '0px')
if ((await indent('Janvier')) === (await indent('Archives 2024'))) throw new Error('subfolder not indented under its parent')
step('existing subfolder nested under its parent, behind a chevron')

// Labels: the Thunderbird tag reads "Travail", the keyword as it is; one added later shows after a sync.
const row = page.locator('[role=option]:has-text("Devis cuisine")')
await row.locator('text=Travail').waitFor({ timeout: 30_000 })
await row.locator('span:text-is("Devis")').waitFor()
const later = imap()
await later.connect()
await later.mailboxOpen('INBOX')
await later.messageFlagsAdd('1:*', ['Urgent'])
await later.logout()
// A click during a running sync joins it; wait for it to end so this one reads the new flags.
await page.waitForFunction(() => !document.querySelector('button[aria-label=Synchroniser] .animate-spin'), null, { timeout: 60_000 })
await page.click('button[aria-label=Synchroniser]')
// The row shows two labels then +1; the reader shows them all.
await row.locator('text=+1').waitFor({ timeout: 30_000 })
await row.click()
await page.locator('h2:has-text("Devis cuisine") ~ span >> text=Urgent').waitFor()
await page.screenshot({ path: join(shots, 'f-00-labels.png') })
step('labels shown on the row and in the reader, updated by a sync')

// Edit labels: L opens the picker on the open conversation; untick one, create another.
await page.keyboard.press('l')
const picker = page.locator('[role=dialog][aria-label="Libellés"]')
// Anchored under the reader's Libellés button, not stuck in the top-left corner.
await picker.waitFor()
const [box, tag] = await Promise.all([picker.boundingBox(), page.locator('button[aria-label="Libellés (L)"]').boundingBox()])
if (!box || !tag || box.y < tag.y + tag.height || box.x + box.width < tag.x)
  throw new Error(`label picker misplaced: ${JSON.stringify({ box, tag })}`)
await picker.locator('[role=option]:has-text("Urgent")').click()
await page.fill('input[aria-label="Rechercher ou créer un libellé"]', 'Client VIP')
await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
await page.locator('h2:has-text("Devis cuisine") ~ span >> text=Client VIP').waitFor()
if (await page.locator('h2:has-text("Devis cuisine") ~ span >> text=Urgent').count()) throw new Error('removed label still shown')
const server = imap()
await server.connect()
await server.mailboxOpen('INBOX')
let flags = []
for await (const m of server.fetch('1:*', { flags: true })) flags = [...m.flags]
await server.logout()
if (!flags.includes('Client_VIP') || flags.includes('Urgent')) throw new Error(`server keywords not updated: ${flags.join(', ')}`)
await page.waitForFunction(() => !document.querySelector('button[aria-label=Synchroniser] .animate-spin'), null, { timeout: 60_000 })
await page.click('button[aria-label=Synchroniser]')
await page.waitForTimeout(3000)
await page.locator('h2:has-text("Devis cuisine") ~ span >> text=Client VIP').waitFor()
step(`labels edited from the picker (L): server keywords now ${flags.filter((f) => !f.startsWith('$') || f === '$label2').join(', ')}`)

// Create a folder, then a subfolder in it.
await nav.locator('button[aria-expanded]:has-text("Camille")').click()
await nav.locator('button[aria-label="Nouveau dossier"]').click()
await page.fill('input[aria-label="Nom du dossier"]', 'Clients')
await page.keyboard.press('Enter')
await page.waitForSelector('text=Dossier « Clients » créé', { timeout: 30_000 })
await nav.locator('button[aria-label="Clients"]').click({ button: 'right' })
await page.click('[role=menuitem]:has-text("Nouveau sous-dossier")')
await page.fill('input[aria-label="Nom du dossier"]', 'Nord')
await page.keyboard.press('Enter')
await page.waitForSelector('text=Dossier « Nord » créé', { timeout: 30_000 })
await nav.locator('div:has(> button[aria-label="Clients"]) >> xpath=../.. >> button[aria-label="Déplier les sous-dossiers"]').click()
await nav.locator('button[aria-label="Nord"]').waitFor()
const check = imap()
await check.connect()
const paths = (await check.list()).map((f) => f.path)
await check.logout()
if (!paths.includes(`Clients${delimiter}Nord`)) throw new Error(`Clients${delimiter}Nord missing on the server: ${paths.join(', ')}`)
step(`"Clients" and its subfolder "Nord" created on the server (${paths.filter((p) => p.startsWith('Clients')).join(', ')})`)

// Favourites.
await nav.locator('button[aria-label="Nord"]').click({ button: 'right' })
await page.click('[role=menuitem]:has-text("Ajouter aux favoris")')
await nav.locator('div:has(> div:text-is("Favoris")) button[aria-label="Nord"]').waitFor()
await page.screenshot({ path: join(shots, 'f-01-tree-favorites.png') })
await page.reload()
await nav.locator('div:has(> div:text-is("Favoris")) button[aria-label="Nord"]').waitFor({ timeout: 30_000 })
await nav.locator('div:has(> div:text-is("Favoris")) button[aria-label="Nord"]').click({ button: 'right' })
await page.click('[role=menuitem]:has-text("Retirer des favoris")')
await nav.locator('div:text-is("Favoris")').waitFor({ state: 'detached' })
step('favourite pinned in the sidebar, kept after a reload, then removed')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
