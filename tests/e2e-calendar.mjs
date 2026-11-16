// Calendar end-to-end test: standalone CalDAV source + .ics subscription, recurring
// events, Teams detection, RSVP written back to the server, floating reminder + Join.
//
// Needs a local Radicale with open auth:
//   python -m radicale --server-hosts localhost:5232 --auth-type none --storage-filesystem-folder <dir>
// Usage: npm run build && node tests/e2e-calendar.mjs [screenshot-dir]
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright'

const DAV = 'http://localhost:5232'
const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const user = `alice-${randomUUID().slice(0, 6)}@example.com`
const auth = 'Basic ' + Buffer.from(`${user}:x`).toString('base64')
const calUrl = `${DAV}/${user}/travail/`
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_TEST%40thread.v2/0?context=%7b%7d'

const pad = (n) => String(n).padStart(2, '0')
const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
const dateOnly = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
const ics = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//FR', ...lines, 'END:VCALENDAR', ''].join('\r\n')
const put = async (name, body) => {
  const res = await fetch(`${calUrl}${name}`, { method: 'PUT', headers: { Authorization: auth, 'Content-Type': 'text/calendar' }, body })
  if (!res.ok) throw new Error(`PUT ${name} ${res.status}`)
}

let res = await fetch(calUrl, {
  method: 'MKCALENDAR',
  headers: { Authorization: auth, 'Content-Type': 'application/xml' },
  body: `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>Travail</D:displayname></D:prop></D:set></C:mkcalendar>`
})
if (!res.ok) throw new Error(`MKCALENDAR ${res.status}`)

// A Teams meeting starting in 8 minutes, with a 10-minute alarm: its reminder is due right away.
const meetingStart = new Date(Math.ceil((Date.now() + 8 * 60_000) / 60_000) * 60_000)
await put(
  'sync.ics',
  ics(
    'BEGIN:VEVENT',
    'UID:sync-1',
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(meetingStart)}`,
    `DTEND:${utc(new Date(meetingStart.getTime() + 30 * 60_000))}`,
    'SUMMARY:Point projet avec Bob',
    'LOCATION:Réunion Microsoft Teams',
    `X-MICROSOFT-SKYPETEAMSMEETINGURL:${TEAMS}`,
    'ORGANIZER;CN=Bob Martin:mailto:bob@example.com',
    'ATTENDEE;CN=Bob Martin;PARTSTAT=ACCEPTED:mailto:bob@example.com',
    `ATTENDEE;CN=Alice;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${user}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT10M',
    'DESCRIPTION:Rappel',
    'END:VALARM',
    'END:VEVENT'
  )
)
// Daily stand-up, Monday to Friday this week at 9:00 local time.
const monday = new Date()
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
monday.setHours(9, 0, 0, 0)
await put(
  'standup.ics',
  ics('BEGIN:VEVENT', 'UID:standup-1', `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(monday)}`, `DTEND:${utc(new Date(monday.getTime() + 15 * 60_000))}`, 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:Stand-up', 'END:VEVENT')
)
step('CalDAV calendar with a Teams invitation and a recurring stand-up')

// A read-only .ics feed, as published by Outlook.
const today = new Date()
const feed = ics(
  'X-WR-CALNAME:Jours fériés test',
  'BEGIN:VEVENT',
  'UID:holiday-1',
  `DTSTAMP:${utc(today)}`,
  `DTSTART;VALUE=DATE:${dateOnly(today)}`,
  `DTEND;VALUE=DATE:${dateOnly(new Date(today.getTime() + 86_400_000))}`,
  'SUMMARY:Jour de test',
  'END:VEVENT'
)
const server = createServer((req, r) => {
  r.writeHead(200, { 'Content-Type': 'text/calendar' })
  r.end(feed)
}).listen(0, '127.0.0.1')
await new Promise((ok) => server.once('listening', ok))
const feedUrl = `http://127.0.0.1:${server.address().port}/feed.ics`

const userData = mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
// Never let the test open a real browser: record the URL instead.
await app.evaluate(({ shell }) => {
  globalThis.openedUrls = []
  shell.openExternal = async (url) => {
    globalThis.openedUrls.push(url)
  }
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.click('text=Passer pour l’instant')
await page.click('nav button[aria-label=Calendrier]')
await page.waitForSelector('text=Aucun agenda connecté')
await page.click('button:has-text("Ajouter un agenda")')
await page.click('button:has-text("CalDAV")')
await page.fill('input[placeholder="https://"]', `${DAV}/`)
await page.fill('input[placeholder="vous@exemple.fr"]', user)
await page.fill('input[type=password]', 'x')
await page.fill('input[placeholder="Perso, Travail…"]', 'Radicale')
await page.click('button:has-text("Connecter")')
await page.waitForSelector('text=Agenda CalDAV connecté', { timeout: 30_000 })
step('standalone CalDAV source added')

await page.click('button:has-text("Ajouter un agenda")')
await page.click('button:has-text("Abonnement par lien")')
await page.fill('input[placeholder="https://… .ics"]', feedUrl)
await page.click('button:has-text("S’abonner")')
await page.waitForSelector('text=Abonnement ajouté', { timeout: 30_000 })
await page.waitForSelector('text=Jours fériés test')
step('.ics subscription added')

// The floating reminder window.
const notifyWin = await (async () => {
  for (let i = 0; i < 60; i++) {
    const w = app.windows().find((win) => win.url().includes('notify.html'))
    if (w && (await w.locator('text=Point projet avec Bob').count())) return w
    await new Promise((ok) => setTimeout(ok, 500))
  }
  throw new Error('reminder window did not show up')
})()
const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('notify.html') && w.isAlwaysOnTop() && w.isVisible()))
if (!onTop) throw new Error('reminder window is not visible and always on top')
await notifyWin.waitForTimeout(400)
await notifyWin.screenshot({ path: join(shots, 'c-01-reminder.png') })
step('reminder popped up in its own always-on-top window')

await page.waitForSelector('[data-event-id]')
await page.screenshot({ path: join(shots, 'c-02-week.png') })
const standups = await page.locator('[data-event-id]:has-text("Stand-up")').count()
if (standups !== 5) throw new Error(`expected 5 stand-ups, got ${standups}`)
step('recurring event expanded to 5 occurrences')

// Click the title, not the chip's own Join button.
await page.click('[data-event-id]:has-text("Point projet avec Bob")', { position: { x: 12, y: 8 } })
await page.waitForSelector('text=Rejoindre avec Teams')
await page.waitForSelector('text=Sans réponse')
await page.screenshot({ path: join(shots, 'c-03-peek.png') })
await page.click('[role=dialog] button:has-text("Accepter")')
await page.waitForSelector('text=Invitation acceptée', { timeout: 30_000 })
const stored = await (await fetch(`${calUrl}sync.ics`, { headers: { Authorization: auth } })).text()
if (!/PARTSTAT=ACCEPTED[^\r\n]*mailto:alice/i.test(stored.replace(/\r\n /g, ''))) throw new Error('RSVP not written to the server')
step('RSVP accepted and stored on the CalDAV server')
await page.keyboard.press('Escape')

await notifyWin.click('button:has-text("Rejoindre")')
const opened = await app.evaluate(() => globalThis.openedUrls)
if (!opened.includes(TEAMS)) throw new Error(`Join did not open the Teams link: ${JSON.stringify(opened)}`)
step('Join from the reminder opened the Teams link')

await page.keyboard.press('a')
await page.waitForSelector('text=Jour de test')
await page.screenshot({ path: join(shots, 'c-04-agenda.png') })
step('agenda view lists the subscription event')

await page.keyboard.press('w')
await page.keyboard.press('n')
await page.waitForSelector('text=Nouvel événement')
await page.fill('input[placeholder=Titre]', 'Déjeuner client')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('text=Événement créé', { timeout: 30_000 })
await page.click('[data-event-id]:has-text("Déjeuner client")')
await page.click('button[aria-label="Supprimer l’événement"]')
await page.click('[role=alertdialog] button:has-text("Supprimer")')
await page.waitForSelector('text=Événement supprimé', { timeout: 30_000 })
step('event created then deleted')

await page.click('nav button[aria-label=Réception]')
await page.waitForSelector('text=Point projet avec Bob')
await page.screenshot({ path: join(shots, 'c-05-nextup.png') })
step('next-up card shows the meeting in the mail view')

await app.close()
server.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
