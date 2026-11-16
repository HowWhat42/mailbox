// In-app updates: a real NSIS build of a newer version is served from a local feed; the app
// finds it, downloads and verifies it, then offers a restart. (The installer itself isn't run.)
// Usage: pnpm build && node tests/e2e-update.mjs [screenshot-dir]
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)

const feedDir = mkdtempSync(join(tmpdir(), 'mailbox-feed-'))
execFileSync(
  process.execPath,
  ['node_modules/electron-builder/cli.js', '--win', '--publish', 'never', '-c.extraMetadata.version=9.9.9', `-c.directories.output=${feedDir}`],
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

await page.click('button[title="Réglages"]')
await page.waitForSelector('text=Mises à jour')
await page.waitForSelector('button:has-text("Redémarrer maintenant")')
await page.waitForSelector('text=/Mailbox \\d+\\.\\d+\\.\\d+/')
await page.locator('section:has(h2:text-is("Mises à jour"))').screenshot({ path: join(shots, 'u-02-settings.png') })
step('settings show the running version and offer the restart')

await app.close()
server.close()
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
