// Message list: the "Relever le courrier" button fetches new mail, and the list stays where the user
// scrolled even when it changes under them (no jump back to the open conversation).
// Usage: pnpm build && node tests/e2e-list.mjs [screenshot-dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ImapFlow } from 'imapflow'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await freshEtherealAccount()
const imap = new ImapFlow({
  host: account.imap.host,
  port: account.imap.port,
  secure: account.imap.secure,
  auth: { user: account.user, pass: account.pass },
  logger: false
})
await imap.connect()
const mail = (n, date) =>
  [
    `From: Léa ${n} <lea${n}@example.com>`,
    `To: ${account.user}`,
    `Subject: Message ${n}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <list-${n}-${date.getTime()}@example.com>`,
    '',
    `Contenu ${n}.`
  ].join('\r\n')
const now = Date.now()
for (let i = 1; i <= 40; i++) await imap.append('INBOX', mail(i, new Date(now - (41 - i) * 3_600_000)))
step('40 messages in the inbox')

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ smartInbox: false, uiScale: 1 }))
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
const row = (n) => page.locator(`[role=option]:has-text("Message ${n}")`).first()
await row(40).waitFor({ timeout: 60_000 })

// Reads (and with a value, sets) the scroll position of the message list.
const listScroll = (to) =>
  page.evaluate((target) => {
    let el = document.querySelector('[role=option]')
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
    if (!el) throw new Error('message list is not scrollable')
    if (target != null) el.scrollTop = target
    return el.scrollTop
  }, to ?? null)

// Open a conversation far down the list, then scroll back to the top.
await listScroll(100_000)
await row(1).click()
await page.locator('h2:has-text("Message 1")').waitFor()
await page.waitForTimeout(1500)
await listScroll(0)
await page.waitForTimeout(300)

// A new message arrives and is fetched with "Relever le courrier": the list changes under the user.
await imap.append('INBOX', mail(41, new Date()))
await imap.logout()
await page.waitForFunction(() => !document.querySelector('button[aria-label="Relever le courrier (F5)"] .animate-spin'), null, { timeout: 60_000 })
await page.click('button[aria-label="Relever le courrier (F5)"]')
// Message 1 was opened (read): 39 unread before, 40 once the new one is in. Not the row itself:
// a list that jumped away does not render it.
await page.locator('header p:text-is("40 non lus")').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1000)
const top = await listScroll()
await page.screenshot({ path: join(shots, 'l-00-list-after-refresh.png') })
if (!(await row(41).isVisible())) throw new Error('new message not shown at the top of the list')
if (top > 0) throw new Error(`list jumped back to the open conversation (scrollTop ${top})`)
step('"Relever le courrier" fetched the new message; the list stayed at the top')

// Keyboard moves still bring the selection into view.
await page.keyboard.press('k')
await page.waitForTimeout(500)
if ((await listScroll()) === 0) throw new Error('keyboard selection was not scrolled into view')
step('moving the selection with the keyboard still scrolls to it')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
