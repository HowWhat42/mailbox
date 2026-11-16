// Two mailboxes: unified inbox with per-account markers, per-account inboxes, custom label/colour.
// Usage: npm run build && node tests/e2e-accounts.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import { _electron as electron } from 'playwright'
import { ImapFlow } from 'imapflow'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const accounts = [await freshEtherealAccount(), await freshEtherealAccount()]
for (const [i, acc] of accounts.entries()) {
  const smtp = createTransport({ host: acc.smtp.host, port: acc.smtp.port, secure: acc.smtp.secure, auth: { user: acc.user, pass: acc.pass } })
  await smtp.sendMail({
    from: 'Léa Moreau <lea@example.com>',
    to: acc.user,
    subject: i === 0 ? 'Message pour le compte pro' : 'Message pour le compte perso',
    text: 'Bonjour !'
  })
}
// A folder of our own on the first account: it must show up under that account, not in a mixed list.
const imap = new ImapFlow({
  host: accounts[0].imap.host,
  port: accounts[0].imap.port,
  secure: accounts[0].imap.secure,
  auth: { user: accounts[0].user, pass: accounts[0].pass },
  logger: false
})
await imap.connect()
await imap.mailboxCreate('Projets')
await imap.logout()
step('one message sent to each of two mailboxes, a "Projets" folder on the first')

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1 }))

const addAccount = async (acc, name) => {
  await page.click('text=Autre adresse (IMAP)')
  await page.fill('input[placeholder="Camille Martin"]', name)
  await page.fill('input[type=email]', acc.user)
  await page.fill('input[type=password]', acc.pass)
  await page.click('button:has-text("Continuer")')
  await page.waitForSelector('text=Serveur IMAP')
  const inputs = page.locator('form input')
  await inputs.nth(0).fill(acc.imap.host)
  await inputs.nth(1).fill(String(acc.imap.port))
  await inputs.nth(2).fill(acc.smtp.host)
  await inputs.nth(3).fill(String(acc.smtp.port))
  await page.click('button:has-text("Connecter le compte")')
  await page.waitForSelector('text=Serveur IMAP', { state: 'detached', timeout: 60_000 }).catch(async (err) => {
    await page.screenshot({ path: join(shots, 'a-00-add-failed.png') })
    const shown = await page.locator('.text-danger').allTextContents()
    throw new Error(`adding ${acc.user} failed: ${shown.join(' | ') || err.message}`)
  })
  step(`account ${name} added`)
}
await addAccount(accounts[0], 'Travail')
await page.click('nav button:has-text("Ajouter un compte")')
await addAccount(accounts[1], 'Maison')

const rowCount = () => page.locator('[role=option]').count()
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 2, null, { timeout: 60_000 })
const stripes = await page.$$eval('[role=option] > span[aria-hidden]', (els) => els.map((e) => getComputedStyle(e).backgroundColor))
if (stripes.length !== 2 || stripes[0] === stripes[1]) throw new Error(`expected two differently coloured stripes, got ${JSON.stringify(stripes)}`)
await page.screenshot({ path: join(shots, 'a-01-unified-stripes.png') })
step('unified inbox: both mailboxes, each row striped in its account colour')

const perAccount = page.locator('nav button[aria-label^="Réception "]')
if ((await perAccount.count()) !== 2) throw new Error('per-account inboxes missing from the sidebar')
await perAccount.first().click()
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 1)
if (await page.locator('[role=option] > span[aria-hidden]').count()) throw new Error('a single account inbox should not show markers')
await page.click('nav button[aria-label="Toutes les boîtes"]')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 2)
step('sidebar: unified inbox plus one inbox per account')

// Same-name accounts are told apart by their address, under the name.
for (const acc of accounts) await page.locator(`nav button[aria-label^="Réception "]:has-text("${acc.user}")`).waitFor()
// Several accounts: custom folders live under their account, no mixed "Dossiers" list.
if (await page.locator('nav div:text-is("Dossiers")').count()) throw new Error('mixed "Dossiers" list shown with several accounts')
await page.locator('nav button[aria-expanded]:has-text("Travail")').click()
await page.locator('nav button:has-text("Projets")').waitFor({ timeout: 30_000 })
step('accounts show their address; "Projets" listed under its own account')

// Resizable panes: drag the sidebar and the message list edges, double-click to reset.
const widthOf = (sel) => page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().width))
const drag = async (label, dx) => {
  const box = await page.locator(`[role=separator][aria-label="${label}"]`).boundingBox()
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y)
  await page.mouse.move(x + dx, y)
  await page.mouse.up()
}
const aside = 'aside'
const list = 'section:has([role=separator][aria-label="Largeur de la liste des messages"])'
const sidebar0 = await widthOf(aside)
await drag('Largeur de la barre latérale', 80)
if (Math.abs((await widthOf(aside)) - (sidebar0 + 80)) > 2) throw new Error(`sidebar did not follow the drag: ${sidebar0} → ${await widthOf(aside)}`)
const list0 = await widthOf(list)
await drag('Largeur de la liste des messages', 120)
if (Math.abs((await widthOf(list)) - (list0 + 120)) > 2) throw new Error(`list did not follow the drag: ${list0} → ${await widthOf(list)}`)
await page.screenshot({ path: join(shots, 'a-03-resized.png') })
await page.reload()
await page.waitForSelector('nav')
if (Math.abs((await widthOf(aside)) - (sidebar0 + 80)) > 2) throw new Error('sidebar width not kept after a reload')
await page.locator('[role=separator][aria-label="Largeur de la barre latérale"]').dblclick()
await page.waitForTimeout(300) // the width transition
if (Math.abs((await widthOf(aside)) - sidebar0) > 2) throw new Error('double-click did not reset the sidebar width')
step('sidebar and list resize by dragging, the width is kept, double-click resets')

// Account page: short label + custom colour.
await page.click('button[aria-label=Réglages]')
await page.click('nav[aria-label="Sections des réglages"] button:has-text("Travail")')
await page.fill('input[aria-label="Nom court du compte"]', 'Pro')
await page.keyboard.press('Enter')
await page.fill('input[aria-label="Couleur personnalisée du compte"]', '#ff5a1f')
await page.waitForTimeout(400)
await page.screenshot({ path: join(shots, 'a-02-account-settings.png') })
await page.click('button:has-text("Changer le style de repère")')
await page.click('[role=radio][aria-label="Étiquette"]')
await page.screenshot({ path: join(shots, 'a-03-marker-picker.png') })
await page.keyboard.press('Escape')
await page.waitForSelector('[role=option]:has-text("Pro")')
const pro = await page.$eval('[role=option]:has-text("compte pro") span[title]', (el) => getComputedStyle(el).color)
if (pro !== 'rgb(255, 90, 31)') throw new Error(`label tag should use the custom colour, got ${pro}`)
await page.screenshot({ path: join(shots, 'a-04-unified-tags.png') })
step('custom label "Pro" and colour shown as a tag in the unified inbox')

for (const style of ['Anneau', 'Point']) {
  await page.click('button[aria-label=Réglages]')
  await page.click('nav[aria-label="Sections des réglages"] button:has-text("Apparence")')
  await page.click(`[role=radio][aria-label="${style}"]`)
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role=option]')
  await page.screenshot({ path: join(shots, `a-05-${style}.png`) })
}
if ((await rowCount()) !== 2) throw new Error('rows lost while switching marker style')
step('ring and dot marker styles render')

// Drag a conversation onto a folder of its account; a drop on another account's folder is refused.
await page.click('nav button[aria-label="Toutes les boîtes"]')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 2)
const travail = page.locator(`nav button[aria-expanded]:has-text("${accounts[0].user}")`)
if ((await travail.getAttribute('aria-expanded')) !== 'true') await travail.click()
const projets = page.locator('nav button:has-text("Projets")')
await page.locator('[role=option]:has-text("compte perso")').dragTo(projets)
await page.waitForTimeout(500)
if (!(await page.locator('[role=option]:has-text("compte perso")').count())) throw new Error('a conversation was moved to another account')
await page.locator('[role=option]:has-text("compte pro")').dragTo(projets)
await page.waitForSelector('text=Conversation déplacée')
await page.waitForFunction(() => document.querySelectorAll('[role=option]').length === 1)
await page.waitForTimeout(6_500) // undo window, then the move reaches the server
await projets.click()
await page.waitForSelector('[role=option]:has-text("compte pro")', { timeout: 30_000 })
step('drag and drop: moved into "Projets" on its account, refused on the other account')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
