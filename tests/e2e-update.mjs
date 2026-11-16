// In-app updates: a real NSIS build of a newer version is served from a local feed; the app
// finds it, downloads and verifies it, then offers a restart. (The installer itself isn't run.)
// Usage: pnpm build && node tests/e2e-update.mjs [screenshot-dir]
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { upcomingNotes, versionNotes } from '../scripts/changelog.mjs'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const feedDir = mkdtempSync(join(tmpdir(), 'mailbox-feed-'))
// Real release notes: the "À venir" section of CHANGELOG.md, or the current version's right after a release.
const changelog = readFileSync('CHANGELOG.md', 'utf8')
const notesFile = join(mkdtempSync(join(tmpdir(), 'mailbox-notes-')), 'notes.md')
writeFileSync(notesFile, upcomingNotes(changelog) || versionNotes(changelog, JSON.parse(readFileSync('package.json', 'utf8')).version))
execFileSync(
  process.execPath,
  [
    'node_modules/electron-builder/cli.js',
    '--win',
    '--publish',
    'never',
    '-c.extraMetadata.version=9.9.9',
    `-c.directories.output=${feedDir}`,
    `-c.releaseInfo.releaseNotesFile=${notesFile}`
  ],
  { stdio: 'ignore' }
)
if (!existsSync(join(feedDir, 'latest.yml'))) throw new Error('no latest.yml in the build output')
step('Mailbox 9.9.9 packaged with its update manifest')

const server = createServer((req, res) => {
  const file = join(feedDir, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!file.startsWith(feedDir) || !existsSync(file)) return void res.writeHead(404).end()
  createReadStream(file).pipe(res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const feed = `http://127.0.0.1:${server.address().port}/`

// The Mailbox installed on this machine must come out untouched: the test build is never installed.
const installed = join(process.env.LOCALAPPDATA ?? tmpdir(), 'Programs', 'mailbox', 'Mailbox.exe')
const installedBefore = existsSync(installed) ? statSync(installed).mtimeMs : null

const app = await electron.launch({
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`],
  env: { ...process.env, MAILBOX_UPDATE_FEED: feed }
})
const page = await app.firstWindow()
app.process().stdout.on('data', (d) => process.stdout.write(`[main] ${d}`))
app.process().stderr.on('data', (d) => process.stdout.write(`[main] ${d}`))
const errors = []
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1 }))
await page.click('text=Passer pour l’instant')
page.on('pageerror', (e) => errors.push(e.message))

await page.waitForSelector('[role=status]:has-text("Mise à jour prête")', { timeout: 180_000 }).catch(async (err) => {
  console.error('update status:', JSON.stringify(await page.evaluate(() => window.mailbox.updates.status())))
  await page.screenshot({ path: join(shots, 'u-00-fail.png') })
  throw err
})
await page.waitForSelector('[role=status] >> text=9.9.9')
await page.locator('[role=status]:has-text("Mise à jour prête")').screenshot({ path: join(shots, 'u-01-ready.png') })
step('update found, downloaded and verified: "Mise à jour prête · 9.9.9"')

// What's new, before restarting.
await page.click('[role=status] button:has-text("Voir les nouveautés")')
const notes = page.locator('[role=dialog][aria-label="Nouveautés de Mailbox 9.9.9"]')
await notes.locator(`h3:has-text("Les mails s'ouvrent tout de suite")`).waitFor()
if ((await notes.locator('.release-notes li').count()) < 3) throw new Error('release notes lists not rendered')
if (await notes.locator('text=/^#{2,}/').count()) throw new Error('raw Markdown shown in the release notes')
await page.screenshot({ path: join(shots, 'u-00-notes.png') })
await notes.locator('button:has-text("Plus tard")').click()
step('release notes shown, formatted, before restarting')

await page.click('button[title="Réglages"]')
await page.waitForSelector('text=Mises à jour')
await page.waitForSelector('button:has-text("Redémarrer maintenant")')
await page.waitForSelector('text=/Mailbox \\d+\\.\\d+\\.\\d+/')
await page.locator('section:has(h2:text-is("Mises à jour"))').screenshot({ path: join(shots, 'u-02-settings.png') })
step('settings show the running version and offer the restart')

await app.close()
server.close()
await new Promise((r) => setTimeout(r, 8000)) // time an installer would need to start replacing files
const installedAfter = existsSync(installed) ? statSync(installed).mtimeMs : null
if (installedAfter !== installedBefore) throw new Error('the test update was installed over the Mailbox on this machine')
step('the installed Mailbox was left alone')
rmSync(feedDir, { recursive: true, force: true })
// electron-updater's download cache for this app name
for (const dir of readdirSync(process.env.LOCALAPPDATA ?? tmpdir()).filter((d) => /^mailbox-updater-test$/i.test(d))) {
  rmSync(join(process.env.LOCALAPPDATA, dir), { recursive: true, force: true })
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
