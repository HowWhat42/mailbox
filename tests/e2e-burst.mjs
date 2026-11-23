// Deleting many conversations in a row: none may come back. Every packet to the IMAP server
// is delayed, so the sync each delete starts reads the inbox while later moves are still on
// their way — the race that used to bring deleted mail back.
// Usage: pnpm build && node tests/e2e-burst.mjs [screenshot-dir]
import { createServer, connect } from 'node:net'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { _electron as electron } from 'playwright'
import { freshEtherealAccount } from './ethereal.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)
const COUNT = 8
const LATENCY_MS = 120

/** A TCP relay that holds every chunk for `latency` ms in both directions, keeping order. */
function slowRelay(targetHost, targetPort, latency) {
  const delayed = (from, to) => {
    let chain = Promise.resolve()
    from.on('data', (chunk) => {
      chain = chain.then(() => new Promise((ok) => setTimeout(ok, latency))).then(() => to.write(chunk))
    })
    from.on('end', () => void chain.then(() => to.end()))
  }
  return new Promise((ok) => {
    const server = createServer((client) => {
      const upstream = connect(targetPort, targetHost)
      for (const s of [client, upstream]) s.on('error', () => s.destroy())
      delayed(client, upstream)
      delayed(upstream, client)
    })
    server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, close: () => server.close() }))
  })
}

const account = await freshEtherealAccount()
const smtp = createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass }
})
for (let i = 1; i <= COUNT; i++) {
  await smtp.sendMail({ from: `Expéditeur ${i} <s${i}@example.com>`, to: account.user, subject: `À supprimer ${i}`, text: `Message ${i}` })
}
step(`${COUNT} messages delivered`)

const imapRelay = await slowRelay(account.imap.host, account.imap.port, LATENCY_MS)
// The relay presents Ethereal's certificate for 127.0.0.1: accept it in this test only.
const app = await electron.launch({
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`],
  env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }
})
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
await inputs.nth(0).fill('127.0.0.1')
await inputs.nth(1).fill(String(imapRelay.port))
await inputs.nth(2).fill(account.smtp.host)
await inputs.nth(3).fill(String(account.smtp.port))
await page.locator('[aria-label="Chiffrement IMAP"]').click()
await page.click('[role=menuitem]:has-text("SSL/TLS")')
await page.click('button:has-text("Connecter le compte")')
await page.waitForFunction((n) => document.querySelectorAll('[role=option]').length === n, COUNT, { timeout: 120_000 })
step('account connected through the slow relay')

// One delete every 400 ms, as when clicking through the list, plus a manual sync mid-burst.
// Meanwhile, watch the inbox: a conversation deleted more than 300 ms ago must never be listed again.
const result = await page.evaluate(async () => {
  const list = () => window.mailbox.mail.list({ type: 'unified', role: 'inbox' }, 'all', 'all', 100)
  const threads = await list()
  const deletedAt = new Map()
  const cameBack = new Set()
  const watch = { on: true }
  const watcher = (async () => {
    while (watch.on) {
      const now = Date.now()
      for (const t of await list()) if (now - (deletedAt.get(t.threadId) ?? Infinity) > 300) cameBack.add(t.subject)
      await new Promise((ok) => setTimeout(ok, 100))
    }
  })()
  const runs = []
  for (const [i, t] of threads.entries()) {
    deletedAt.set(t.threadId, Date.now())
    runs.push(window.mailbox.mail.actThread(t.accountId, t.threadId, t.folderId, 'trash'))
    if (i === 2) runs.push(window.mailbox.mail.sync())
    await new Promise((ok) => setTimeout(ok, 400))
  }
  const results = await Promise.allSettled(runs)
  // The syncs started by the last deletes may still be running: keep watching a while.
  await new Promise((ok) => setTimeout(ok, 15_000))
  watch.on = false
  await watcher
  return {
    failures: results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)),
    cameBack: [...cameBack],
    left: (await list()).length
  }
})
if (result.failures.length) throw new Error(`actions failed: ${result.failures.join(' | ')}`)
step(`${COUNT} deletes sent`)
if (result.cameBack.length) {
  await page.screenshot({ path: join(shots, 'b-01-came-back.png') })
  throw new Error(`deleted mail came back: ${result.cameBack.join(', ')}`)
}
if (result.left) throw new Error(`${result.left} conversation(s) still listed`)
step('no deleted message came back while the syncs settled')

const check = new ImapFlow({
  host: account.imap.host,
  port: account.imap.port,
  secure: account.imap.secure,
  auth: { user: account.user, pass: account.pass },
  logger: false
})
await check.connect()
const inbox = await check.status('INBOX', { messages: true })
await check.logout()
if (inbox.messages) throw new Error(`server inbox still holds ${inbox.messages} message(s)`)
step('server confirms: inbox empty')

await app.close()
imapRelay.close()
if (errors.length) {
  console.error('Renderer errors:\n' + errors.join('\n'))
  process.exit(1)
}
step('OK')
