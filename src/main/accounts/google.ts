import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import { getSecret } from './store'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const SCOPES = {
  mail: ['openid', 'email', 'profile', 'https://mail.google.com/', 'https://www.googleapis.com/auth/calendar'],
  calendar: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar']
}

const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? ''
const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? ''

export function googleConfigured(): boolean {
  return Boolean(clientId && clientSecret)
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  error?: string
  error_description?: string
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })
  })
  const body = (await res.json()) as TokenResponse
  if (!res.ok || body.error) throw new Error(`Google OAuth : ${body.error_description ?? body.error ?? res.statusText}`)
  return body
}

/**
 * Runs the installed-app OAuth flow: opens the system browser and receives the
 * code on a one-shot loopback server (RFC 8252), protected by PKCE + state.
 */
export async function authorizeGoogle(scope: keyof typeof SCOPES = 'mail'): Promise<{ email: string; name: string; refreshToken: string }> {
  if (!googleConfigured()) {
    throw new Error('Client OAuth Google non configuré : renseigner MAIN_VITE_GOOGLE_CLIENT_ID / SECRET dans .env.')
  }
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0b0b0d;color:#e6e6ea;display:grid;place-items:center;height:100vh;margin:0">` +
          `<p>${ok ? 'Compte connecté. Vous pouvez fermer cet onglet.' : 'Connexion annulée.'}</p></body>`
      )
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code: url.searchParams.get('code')!, redirectUri: loopbackUri })
      else reject(new Error(error ? `Google : ${error}` : 'Réponse OAuth invalide.'))
    })
    let loopbackUri = ''
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Délai de connexion Google dépassé.'))
    }, 5 * 60_000)
    server.listen(0, '127.0.0.1', () => {
      loopbackUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const url = new URL(AUTH_URL)
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: loopbackUri,
        response_type: 'code',
        scope: SCOPES[scope].join(' '),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent',
        state
      }).toString()
      void shell.openExternal(url.toString())
    })
  })

  const tokens = await tokenRequest({
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })
  if (!tokens.refresh_token) throw new Error("Google n'a pas fourni de refresh token.")
  const info = (await (
    await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  ).json()) as { email: string; name?: string }
  return { email: info.email, name: info.name ?? info.email, refreshToken: tokens.refresh_token }
}

export async function googleAccessToken(accountId: string): Promise<string> {
  return googleTokenFor(accountId, () => getSecret(accountId).refreshToken)
}

/** Access token for any holder of a refresh token (mail account or standalone calendar), cached until expiry. */
export async function googleTokenFor(cacheKey: string, refreshToken: () => string | undefined): Promise<string> {
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const token = refreshToken()
  if (!token) throw new Error('Refresh token manquant : reconnecter le compte Google.')
  const tokens = await tokenRequest({ refresh_token: token, grant_type: 'refresh_token' })
  tokenCache.set(cacheKey, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 })
  return tokens.access_token
}

export function forgetGoogleToken(accountId: string): void {
  tokenCache.delete(accountId)
}
