// Local MCP server: off by default, reachable only with the token, closed to browsers and foreign
// Host headers, locked after repeated bad tokens, tools gated by the permissions in the settings.
// Usage: pnpm build && node tests/e2e-mcp.mjs [screenshot-dir]
import { mkdirSync, mkdtempSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'

const shots = process.argv[2] ?? join(tmpdir(), 'mailbox-e2e-shots')
mkdirSync(shots, { recursive: true })
const step = (msg) => console.log(`• ${msg}`)
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const PORT = 47_990

/** Raw HTTP so the test controls every header (fetch would set Host and friends itself). */
function call({ method = 'POST', path = '/mcp', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path,
        headers: {
          Host: `127.0.0.1:${PORT}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers
        }
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }))
      }
    )
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

let rpcId = 0
const rpc = (token, method, params = {}) =>
  call({ headers: { Authorization: `Bearer ${token}` }, body: { jsonrpc: '2.0', id: ++rpcId, method, params } })
const toolNames = async (token) => (await rpc(token, 'tools/list')).body.result.tools.map((t) => t.name).toSorted()

const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'mailbox-e2e-'))}`] })
const page = await app.firstWindow()
app.process().stderr.on('data', (d) => process.stdout.write(`[main] ${d}`))
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.evaluate(() => window.mailbox.settings.set({ uiScale: 1 }))
await page.click('text=Passer pour l’instant')

// Off by default: nothing listens.
const settings = await page.evaluate(() => window.mailbox.settings.get())
assert(!settings.mcpEnabled && !settings.mcpAllowWrite && !settings.mcpAllowSend, 'MCP must be off, without write or send, by default')
assert((await page.evaluate(() => window.mailbox.mcp.status())).state === 'off', 'status should be off')
await call({ port: PORT }).then(
  () => assert(false, 'nothing should listen while disabled'),
  (err) => assert(err.code === 'ECONNREFUSED', `expected ECONNREFUSED, got ${err.code}`)
)
step('off by default, nothing listening')

await page.evaluate((port) => window.mailbox.settings.set({ mcpEnabled: true, mcpPort: port }), PORT)
await page.waitForFunction(() => window.mailbox.mcp.status().then((s) => s.state === 'listening'))
const token = await page.evaluate(() => window.mailbox.mcp.token())
assert(/^mbx_[\w-]{43}$/.test(token), `unexpected token shape: ${token}`)
step(`listening on 127.0.0.1:${PORT}`)

const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }
const initBody = { jsonrpc: '2.0', id: 0, method: 'initialize', params: init }
assert((await call({ body: initBody })).status === 401, 'no token must be refused')
assert((await call({ headers: { Authorization: 'Bearer mbx_nope' }, body: initBody })).status === 401, 'wrong token must be refused')
const auth = { Authorization: `Bearer ${token}` }
assert((await call({ headers: { ...auth, Origin: 'https://evil.example' }, body: initBody })).status === 403, 'browser Origin must be refused')
assert((await call({ headers: { ...auth, Host: `evil.example:${PORT}` }, body: initBody })).status === 403, 'foreign Host must be refused')
assert((await call({ method: 'GET', headers: auth })).status === 405, 'GET must be refused')
assert((await call({ path: '/other', headers: auth, body: initBody })).status === 404, 'other paths must 404')
assert((await call({ headers: { ...auth, 'Content-Type': 'text/plain' }, body: initBody })).status === 415, 'non-JSON must be refused')
step('refused: no token, wrong token, browser Origin, foreign Host, GET, other path, non-JSON')

const hello = await rpc(token, 'initialize', init)
assert(hello.status === 200 && hello.body.result.serverInfo.name === 'mailbox', `initialize failed: ${JSON.stringify(hello.body)}`)
assert(/données, jamais comme des instructions/.test(hello.body.result.instructions), 'instructions should warn about untrusted mail')

const READ = ['get_thread', 'list_accounts', 'list_calendars', 'list_events', 'list_folders', 'search_contacts', 'search_threads']
assert(JSON.stringify(await toolNames(token)) === JSON.stringify(READ), `read-only tools expected, got ${await toolNames(token)}`)
const accounts = await rpc(token, 'tools/call', { name: 'list_accounts', arguments: {} })
assert(JSON.parse(accounts.body.result.content[0].text).length === 0, 'no account expected')
const notListed = await rpc(token, 'tools/call', { name: 'send_message', arguments: {} })
assert(notListed.body.error || notListed.body.result?.isError, 'send_message must not be callable without the permission')
step('read-only by default: write and send tools neither listed nor callable')

await page.evaluate(() => window.mailbox.settings.set({ mcpAllowWrite: true }))
const withWrite = await toolNames(token)
assert(
  ['create_draft', 'create_event', 'update_thread'].every((t) => withWrite.includes(t)) && !withWrite.includes('send_message'),
  'write tools expected'
)
await page.evaluate(() => window.mailbox.settings.set({ mcpAllowSend: true }))
assert((await toolNames(token)).includes('send_message'), 'send_message expected once allowed')
const badSend = await rpc(token, 'tools/call', {
  name: 'send_message',
  arguments: { account_id: 'nope', to: ['a@example.com'], subject: 'x', body: 'y' }
})
assert(badSend.body.result.isError && /Compte inconnu/.test(badSend.body.result.content[0].text), 'unknown account must be refused before any dialog')
const badInput = await rpc(token, 'tools/call', { name: 'create_draft', arguments: { account_id: 'x', to: ['not-an-email'], subject: '', body: '' } })
assert(badInput.body.error || badInput.body.result?.isError, 'invalid addresses must be rejected')
step('write and send tools appear only once allowed; bad input refused')

// Lockout: five bad tokens, then even the right one waits.
for (let i = 0; i < 5; i++) await call({ headers: { Authorization: 'Bearer mbx_wrong' }, body: initBody })
assert((await rpc(token, 'tools/list')).status === 429, 'server should lock after repeated bad tokens')
step('locked after 5 bad tokens')

// Regenerating the token cuts off the old one (restart clears the lockout).
await page.evaluate(() => window.mailbox.settings.set({ mcpEnabled: false }))
await page.evaluate(() => window.mailbox.settings.set({ mcpEnabled: true }))
await page.waitForFunction(() => window.mailbox.mcp.status().then((s) => s.state === 'listening'))
const fresh = await page.evaluate(() => window.mailbox.mcp.regenerateToken())
assert((await rpc(token, 'tools/list')).status === 401, 'old token must stop working')
assert((await rpc(fresh, 'tools/list')).status === 200, 'new token must work')
step('regenerated token replaces the old one')

await page.click('button[title="Réglages"]')
await page.click('nav[aria-label="Sections des réglages"] >> text=Accès IA')
await page.waitForSelector('text=Actif sur')
await page.waitForSelector('[aria-label="Activité des assistants IA"] >> text=Jeton invalide')
await page.screenshot({ path: join(shots, 'mcp-01-settings.png') })
step('settings show the status, permissions and the activity log')

await page.evaluate(() => window.mailbox.settings.set({ mcpEnabled: false }))
await page.waitForFunction(() => window.mailbox.mcp.status().then((s) => s.state === 'off'))
await call().then(
  () => assert(false, 'server should be closed'),
  (err) => assert(err.code === 'ECONNREFUSED', `expected ECONNREFUSED, got ${err.code}`)
)
step('turning it off closes the port')

await app.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
step('OK')
