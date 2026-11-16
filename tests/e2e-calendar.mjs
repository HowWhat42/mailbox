// CalDAV end-to-end test. Needs a local Radicale with open auth:
//   python -m radicale --server-hosts localhost:5232 --auth-type none --storage-filesystem-folder <dir>
// Usage: npm run build && node tests/e2e-calendar.mjs [screenshot-dir]
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import { _electron as electron } from 'playwright'

const DAV = 'http://localhost:5232'
const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const account = await nodemailer.createTestAccount()
const auth = 'Basic ' + Buffer.from(`${account.user}:${account.pass}`).toString('base64')
const calUrl = `${DAV}/${account.user}/perso/`

let res = await fetch(calUrl, {
  method: 'MKCALENDAR',
  headers: { Authorization: auth, 'Content-Type': 'application/xml' },
  body: `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>Perso</D:displayname></D:prop></D:set></C:mkcalendar>`
})
if (!res.ok) throw new Error(`MKCALENDAR ${res.status}`)

// A weekly stand-up every day of this week at 10:00 local (recurrence expansion check).
const monday = new Date()
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const local = (d, h) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(h)}0000`
res = await fetch(`${calUrl}standup.ics`, {
  method: 'PUT',
  headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
  body: [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//FR',
    'BEGIN:VEVENT', 'UID:standup-1', `DTSTAMP:${local(monday, 8)}Z`,
    `DTSTART:${local(monday, 10)}`, `DTEND:${local(monday, 10).slice(0, 9)}103000`,
    'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Stand-up', 'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n')
})
if (!res.ok) throw new Error(`PUT ${res.status}`)
step('calendar + recurring event created on Radicale')

const userData = mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.click('text=Autre adresse (IMAP)')
await page.fill('input[placeholder="Camille Martin"]', 'Agenda Test')
await page.fill('input[type=email]', account.user)
await page.fill('input[type=password]', account.pass)
await page.click('button:has-text("Continuer")')
await page.waitForSelector('text=Serveur IMAP')
const inputs = page.locator('form input')
await inputs.nth(0).fill(account.imap.host)
await inputs.nth(1).fill(String(account.imap.port))
await inputs.nth(2).fill(account.smtp.host)
await inputs.nth(3).fill(String(account.smtp.port))
await inputs.nth(5).fill(`${DAV}/`)
await page.click('button:has-text("Connecter le compte")')
await page.waitForSelector('text=Bienvenue dans Mailbox', { state: 'detached', timeout: 60_000 })

await page.click('nav button[aria-label=Calendrier]')
await page.waitForSelector('[role=checkbox][aria-label="Afficher Perso"]', { timeout: 30_000 })
await page.waitForFunction(() => [...document.querySelectorAll('button')].filter((b) => b.textContent?.startsWith('Stand-up')).length >= 5, null, { timeout: 30_000 })
step('5 occurrences of the recurring event shown')

await page.keyboard.press('n')
await page.waitForSelector('text=Nouvel événement')
await page.screenshot({ path: join(shots, '10b-event-editor.png') })
await page.fill('input[placeholder=Titre]', 'Déjeuner client')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('text=Événement créé', { timeout: 30_000 })
await page.waitForSelector('button:has-text("Déjeuner client")')
await page.screenshot({ path: join(shots, '09-calendar-events.png') })
step('event created from the UI')

const report = async () =>
  (await (await fetch(calUrl, { method: 'PROPFIND', headers: { Authorization: auth, Depth: '1' } })).text()).match(/\.ics/g)?.length ?? 0
if ((await report()) !== 2) throw new Error('created event not on server')
step('event stored on the CalDAV server')

await page.click('button:has-text("Déjeuner client")')
await page.fill('input[placeholder=Titre]', 'Déjeuner client (déplacé)')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('button:has-text("Déjeuner client (déplacé)")', { timeout: 30_000 })
step('event renamed')

await page.click('button:has-text("Déjeuner client (déplacé)")')
await page.click('form button:has-text("Supprimer")')
await page.waitForSelector('[role=alertdialog]')
await page.screenshot({ path: join(shots, '11-confirm-dialog.png') })
await page.click('[role=alertdialog] button:has-text("Supprimer")')
await page.waitForSelector('text=Événement supprimé', { timeout: 30_000 })
if ((await report()) !== 1) throw new Error('deleted event still on server')
step('event deleted on the server')

await page.click('button:has-text("Mois")')
await page.waitForTimeout(500)
await page.screenshot({ path: join(shots, '10-month.png') })

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
