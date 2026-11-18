import { getSecret } from './store'
import { authorizeInBrowser } from './oauth'

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

/** Opens the Google consent screen in the system browser and returns the account with its refresh token. */
export async function authorizeGoogle(scope: keyof typeof SCOPES = 'mail'): Promise<{ email: string; name: string; refreshToken: string }> {
  if (!googleConfigured()) {
    throw new Error('Client OAuth Google non configuré : renseigner MAIN_VITE_GOOGLE_CLIENT_ID / SECRET dans .env.')
  }
  const { code, verifier, redirectUri } = await authorizeInBrowser({
    provider: 'Google',
    authUrl: AUTH_URL,
    params: { client_id: clientId, scope: SCOPES[scope].join(' '), access_type: 'offline', prompt: 'consent' }
  })

  const tokens = await tokenRequest({
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })
  if (!tokens.refresh_token) throw new Error("Google n'a pas fourni de refresh token.")
  const info = (await (await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json()) as {
    email: string
    name?: string
  }
  return { email: info.email, name: info.name ?? info.email, refreshToken: tokens.refresh_token }
}

export async function googleAccessToken(accountId: string): Promise<string> {
  return googleTokenFor(accountId, async () => (await getSecret(accountId)).refreshToken)
}

/** Access token for any holder of a refresh token (mail account or standalone calendar), cached until expiry. */
export async function googleTokenFor(cacheKey: string, refreshToken: () => Promise<string | undefined>): Promise<string> {
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const token = await refreshToken()
  if (!token) throw new Error('Refresh token manquant : reconnecter le compte Google.')
  const tokens = await tokenRequest({ refresh_token: token, grant_type: 'refresh_token' })
  tokenCache.set(cacheKey, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 })
  return tokens.access_token
}

export function forgetGoogleToken(accountId: string): void {
  tokenCache.delete(accountId)
}
