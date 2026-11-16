// Offline queue: archive and send while the server is unreachable, then replay when it's back.
// The app talks to Ethereal through local TCP relays the test can cut, so "offline" is real
// connection failures (ECONNREFUSED) without touching the machine's network.
// Usage: pnpm build && node tests/e2e-offline.mjs [screenshot-dir]
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

/** A TCP relay we can switch off (refusing and dropping connections) and on again. */
function relay(targetHost, targetPort) {
  const sockets = new Set()
  let server = null
  let port = 0
  const start = () =>
    new Promise((ok) => {
      server = createServer((client) => {
        const upstream = connect(targetPort, targetHost)
        for (const s of [client, upstream]) {
          sockets.add(s)
          s.on('close', () => sockets.delete(s))
          s.on('error', () => s.destroy())
        }
        client.pipe(upstream).pipe(client)
      })
      server.listen(port, '127.0.0.1', () => {
        port = server.address().port
        ok(port)
      })
    })
  const stop = () =>
    new Promise((ok) => {
      for (const s of sockets) s.destroy()
      server.close(() => ok())
    })
  return {
    start,
    stop,
    get port() {
      return port
    }
  }
}

const account = await freshEtherealAccount()
const smtp = createTransport({
  host: account.smtp.host,
  port: account.smtp.port,
  secure: account.smtp.secure,
  auth: { user: account.user, pass: account.pass }
})
await smtp.sendMail({ from: 'Léa <lea@example.com>', to: account.user, subject: 'À archiver hors ligne', text: 'A' })
// Over the prefetch size limit: its body is only fetched when opened.
await smtp.sendMail({
  from: 'Paul <paul@example.com>',
  to: account.user,
  subject: 'Reste dans la boîte',
  text: 'B',
  attachments: [{ filename: 'plans.bin', content: Buffer.alloc(2_200_000, 7) }]
})
step('two messages delivered')

const imapRelay = relay(account.imap.host, account.imap.port)
const smtpRelay = relay(account.smtp.host, account.smtp.port)
await imapRelay.start()
await smtpRelay.start()

// The relays present Ethereal's certificate for 127.0.0.1: accept it in this test only.
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
await inputs.nth(2).fill('127.0.0.1')
await inputs.nth(3).fill(String(smtpRelay.port))
// Non-standard ports: say which encryption each relayed server speaks.
await page.locator('[aria-label="Chiffrement IMAP"]').click()
await page.click('[role=menuitem]:has-text("SSL/TLS")')
await page.locator('[aria-label="Chiffrement SMTP"]').click()
await page.click(`[role=menuitem]:has-text("${account.smtp.secure ? 'SSL/TLS' : 'STARTTLS'}")`)
await page.click('button:has-text("Connecter le compte")')
await page
  .waitForFunction(() => document.querySelectorAll('[role=option]').length === 2, null, { timeout: 60_000 })
  .catch(async (err) => {
    await page.screenshot({ path: join(shots, 'o-00-connect-failed.png') })
    throw new Error(`connecting through the relays failed: ${(await page.locator('.text-danger').allTextContents()).join(' | ') || err.message}`)
  })
step('account connected through the relays')

// --- Go offline ---------------------------------------------------------------------------
await imapRelay.stop()
await smtpRelay.stop()
await page.click('button[aria-label=Synchroniser]')
await page.waitForSelector('nav ~ div p:text-is("Hors ligne"), aside p:text-is("Hors ligne")', { timeout: 30_000 })
step('server unreachable: the sidebar says "Hors ligne"')

// Small mail was kept whole during sync: it reads fine offline.
await page.click('[role=option]:has-text("À archiver")')
await page.frameLocator('iframe[title="Contenu du message"]').last().locator('text=A').waitFor({ timeout: 10_000 })
// A big one (attachment) never downloaded says so instead of failing.
await page.click('[role=option]:has-text("Reste dans la boîte")')
await page.waitForSelector('text=pas encore téléchargé')
await page.click('[role=option]:has-text("À archiver")')
await page.keyboard.press('e')
await page.waitForSelector('text=/actions? en attente/', { timeout: 20_000 }).catch(async (err) => {
  await page.screenshot({ path: join(shots, 'o-00-queue.png') })
  console.log('queue:', JSON.stringify(await page.evaluate(() => window.mailbox.mail.queue())))
  throw err
})
step('small mail readable offline, big one marked not downloaded; archive kept locally and queued')

await page.keyboard.press('c')
await page.fill('input[aria-label=Destinataires]', account.user)
await page.keyboard.press('Enter')
await page.fill('input[aria-label=Objet]', 'Écrit hors ligne')
await page.click('.prose-compose')
await page.keyboard.type('Parti plus tard.')
await page.keyboard.press('Control+Enter')
await page.waitForSelector('text=le message partira dès le retour', { timeout: 30_000 })
await page.waitForSelector('text=Boîte d’envoi · 1')
await page.screenshot({ path: join(shots, 'o-01-offline.png') })
await page.click('button:has-text("Boîte d’envoi · 1")')
await page.waitForSelector('[role=dialog] >> text=Écrit hors ligne')
await page.screenshot({ path: join(shots, 'o-02-outbox.png') })
// Escape closes the outbox even though the focus is on the sidebar button behind it.
await page.keyboard.press('Escape')
await page.waitForSelector('[role=dialog]', { state: 'detached', timeout: 5_000 })
step('message written offline waits in the outbox')

// --- Back online ----------------------------------------------------------------------------
await imapRelay.start()
await smtpRelay.start()
await page.click('button[aria-label=Synchroniser]')
await page.waitForSelector('text=/actions? en attente/', { state: 'detached', timeout: 60_000 }).catch(async (err) => {
  await page.screenshot({ path: join(shots, 'o-03-stuck.png') })
  console.log('queue after reconnect:', JSON.stringify(await page.evaluate(() => window.mailbox.mail.queue())))
  console.log('accounts:', JSON.stringify((await page.evaluate(() => window.mailbox.accounts.list())).map((a) => [a.syncError, a.lastSyncAt])))
  throw err
})
await page.waitForSelector('text=Boîte d’envoi · 1', { state: 'detached', timeout: 60_000 })
await page.waitForSelector('aside p:text-is("Hors ligne")', { state: 'detached', timeout: 60_000 }).catch(async (err) => {
  await page.screenshot({ path: join(shots, 'o-04-still-offline.png') })
  console.log('offline text found in:', await page.locator('text=Hors ligne').evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 160))))
  throw err
})
await page.click('[role=option]:has-text("Reste dans la boîte")')
await page.waitForSelector('text=pas encore téléchargé', { state: 'detached', timeout: 30_000 })
step('back online: queue replayed, outbox empty, bodies download again')

// Check the server itself.
const client = new ImapFlow({
  host: account.imap.host,
  port: account.imap.port,
  secure: true,
  auth: { user: account.user, pass: account.pass },
  logger: false
})
await client.connect()
const subjects = async (path) => {
  const lock = await client.getMailboxLock(path)
  try {
    const out = []
    for await (const m of client.fetch('1:*', { envelope: true })) out.push(m.envelope.subject)
    return out
  } catch {
    return []
  } finally {
    lock.release()
  }
}
let inbox = []
for (let i = 0; i < 20; i++) {
  inbox = await subjects('INBOX')
  if (inbox.includes('Écrit hors ligne')) break
  await new Promise((ok) => setTimeout(ok, 1500))
}
const archive = (await client.list()).find((f) => f.specialUse === '\\Archive' || /archive/i.test(f.path))
const archived = archive ? await subjects(archive.path) : []
await client.logout()
if (inbox.includes('À archiver hors ligne')) throw new Error(`archive was not replayed on the server: ${JSON.stringify(inbox)}`)
if (!archived.includes('À archiver hors ligne')) throw new Error(`archived message not found in ${archive?.path}: ${JSON.stringify(archived)}`)
if (!inbox.includes('Écrit hors ligne')) throw new Error(`queued message never arrived: ${JSON.stringify(inbox)}`)
step('server confirms: message archived, queued message delivered')

await app.close()
await imapRelay.stop()
await smtpRelay.stop()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
