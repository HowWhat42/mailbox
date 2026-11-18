import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpStatus } from '@shared/types'
import { emit } from '../events'
import { getSettings } from '../settings'
import { allowRequest, isLocked, logActivity, recordFailure, resetLimits, tokenMatches } from './guard'
import { buildServer } from './tools'

const HOST = '127.0.0.1'
const PATH = '/mcp'
const MAX_BODY = 1024 * 1024

let server: Server | null = null
let status: McpStatus = { state: 'off', url: null, error: null }

function setStatus(next: McpStatus): void {
  status = next
  emit('mcp:changed', {})
}

export function mcpStatus(): McpStatus {
  return status
}

function reply(res: ServerResponse, code: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return void res.end()
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1'])

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * Every request goes through these checks before reaching MCP:
 * - loopback peer only, and a Host header naming this very port (blocks DNS rebinding);
 * - no Origin header at all: browsers always send one, MCP clients don't, so no web page can call in;
 * - POST /mcp with a JSON body under 1 MB;
 * - the bearer token, compared in constant time, with a lockout after repeated failures;
 * - a per-minute request cap.
 */
async function handle(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply(res, 403, 'Forbidden')
  const host = (req.headers.host ?? '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(res, 403, 'Forbidden host')
  if (req.headers.origin !== undefined) return reply(res, 403, 'Browser requests are not allowed')
  if (new URL(req.url ?? '/', `http://${HOST}`).pathname !== PATH) return reply(res, 404, 'Not found')
  if (req.method !== 'POST') return reply(res, 405, 'Method not allowed', { Allow: 'POST' })

  if (isLocked()) return reply(res, 429, 'Too many failed attempts, try again later', { 'Retry-After': '60' })
  const auth = req.headers.authorization ?? ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!presented || !(await tokenMatches(presented))) {
    recordFailure()
    logActivity('auth', 'denied', presented ? 'Jeton invalide' : 'Jeton absent')
    return reply(res, 401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' })
  }
  if (!allowRequest()) return reply(res, 429, 'Rate limit exceeded', { 'Retry-After': '60' })

  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return reply(res, 415, 'Expected application/json')
  const raw = await readBody(req)
  if (!raw) return reply(res, 413, 'Request too large')
  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    return reply(res, 400, 'Invalid JSON')
  }

  // Stateless: a fresh server per request, so tools always follow the current permissions.
  const mcp = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void mcp.close()
  })
  await mcp.connect(transport)
  await transport.handleRequest(req, res, body)
}

function stop(): Promise<void> {
  const s = server
  server = null
  if (!s) return Promise.resolve()
  return new Promise((resolve) => {
    s.close(() => resolve())
    s.closeAllConnections()
  })
}

let applying = Promise.resolve()

/** Starts, restarts or stops the server to match the settings, one change at a time. */
export function applyMcpSettings(): Promise<void> {
  applying = applying.then(apply, apply)
  return applying
}

async function apply(): Promise<void> {
  await stop()
  resetLimits()
  const { mcpEnabled, mcpPort } = getSettings()
  if (!mcpEnabled) return setStatus({ state: 'off', url: null, error: null })

  const s = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, (req, res) => {
    handle(req, res, mcpPort).catch((err: unknown) => {
      console.error('[mcp]', err)
      reply(res, 500, 'Internal error')
    })
  })
  s.on('clientError', (_err, socket) => socket.destroy())
  try {
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject)
      s.listen(mcpPort, HOST, () => {
        s.off('error', reject)
        resolve()
      })
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return setStatus({
      state: 'error',
      url: null,
      error: code === 'EADDRINUSE' ? `Le port ${mcpPort} est déjà utilisé : choisissez-en un autre.` : (err as Error).message
    })
  }
  server = s
  setStatus({ state: 'listening', url: `http://${HOST}:${mcpPort}${PATH}`, error: null })
}

export function stopMcp(): Promise<void> {
  return stop()
}
