// Resizes the real window through each layout breakpoint, checks nothing overflows
// horizontally and that the right panes are shown. Screenshots each step.
// Usage: npm run build && node tests/e2e-responsive.mjs [screenshot-dir]
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
await smtp.sendMail({
  from: 'Léa Moreau <lea@example.com>',
  to: account.user,
  subject: 'Point projet jeudi',
  html: '<p>On fait le point <b>jeudi à 14h</b> ? Ordre du jour en pièce jointe.</p>',
  attachments: [{ filename: 'ordre-du-jour.pdf', content: 'x' }]
})
await smtp.sendMail({ from: 'Facturation <factures@example.org>', to: account.user, subject: 'Votre facture de novembre', text: 'Montant : 42,00 €. Merci !' })

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

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

const resize = async (width, height = 860) => {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
  await page.waitForFunction((w) => window.innerWidth === w, width)
  await page.waitForTimeout(350)
}
const noOverflow = async (label) => {
  const over = await page.evaluate(() => {
    const vw = window.innerWidth
    return [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return r.width > 0 && r.right > vw + 1 && style.position !== 'fixed' && !el.closest('[style*="-9999"]')
      })
      .slice(0, 5)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`)
  })
  if (over.length) throw new Error(`${label}: elements overflow the window:\n${over.join('\n')}`)
}

for (const [width, name] of [
  [1440, 'wide'],
  [1240, 'rail'],
  [980, 'single'],
  [640, 'drawer'],
  [480, 'minimum']
]) {
  await resize(width)
  if (width < 760) await page.click('button[aria-label="Afficher ou masquer la barre latérale"]')
  await page.click('nav button[aria-label=Réception]')
  const listVisible = await page.locator('[role=listbox]').isVisible()
  if (!listVisible) throw new Error(`${name}: list not visible`)
  await noOverflow(`${name} list`)
  await page.screenshot({ path: join(shots, `r-${width}-1-list.png`) })

  await page.click('[role=option]:has-text("Point projet")')
  await page.waitForSelector('article', { timeout: 30_000 })
  await page.waitForTimeout(400)
  await noOverflow(`${name} reader`)
  await page.screenshot({ path: join(shots, `r-${width}-2-reader.png`) })
  const single = width < 1100
  if (single) {
    if (await page.locator('[role=listbox]').isVisible()) throw new Error(`${name}: list should give way to the reader`)
    await page.click('button[aria-label="Retour à la liste (Échap)"]')
    await page.waitForSelector('[role=listbox]')
  }

  await page.keyboard.press('c')
  await page.waitForSelector('h2:has-text("Nouveau message")')
  await noOverflow(`${name} composer`)
  await page.screenshot({ path: join(shots, `r-${width}-3-composer.png`) })
  await page.keyboard.press('Escape')

  if (width < 760) {
    await page.click('button[aria-label="Afficher ou masquer la barre latérale"]')
    await page.waitForSelector('nav button[aria-label=Calendrier]')
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(shots, `r-${width}-4-drawer.png`) })
  }
  await page.click('nav button[aria-label=Calendrier]')
  await page.waitForSelector('text=Auj', { timeout: 10_000 })
  await page.waitForTimeout(300)
  await noOverflow(`${name} calendar`)
  await page.screenshot({ path: join(shots, `r-${width}-5-calendar.png`) })
  if (width < 760) await page.click('button[aria-label="Afficher ou masquer la barre latérale"]')
  step(`${width}px (${name}) OK`)
}

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
