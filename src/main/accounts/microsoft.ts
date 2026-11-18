import { getSecret, setSecret } from './store'
import { authorizeInBrowser } from './oauth'

// `common`: personal accounts (outlook.com, hotmail, live, msn) and Microsoft 365 work/school accounts.
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send'
]

// Public client ("Mobile and desktop applications" platform in Entra ID): PKCE, no secret.
const clientId = import.meta.env.MAIN_VITE_MICROSOFT_CLIENT_ID ?? ''

export function microsoftConfigured(): boolean {
  return Boolean(clientId)
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  id_token?: string
  error?: string
  error_description?: string
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES.join(' '), ...params })
  })
  const body = (await res.json()) as TokenResponse
  if (!res.ok || body.error) throw new Error(`Microsoft : ${(body.error_description ?? body.error ?? res.statusText).split('\r\n')[0]}`)
  return body
}

/** Claims of the ID token. It comes straight from the token endpoint over TLS, so no signature check is needed (OIDC §3.1.3.7). */
function idClaims(idToken: string | undefined): { email?: string; preferred_username?: string; name?: string } {
  const payload = idToken?.split('.')[1]
  if (!payload) return {}
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { email?: string; preferred_username?: string; name?: string }
}

/** Opens the Microsoft sign-in page in the system browser and returns the account with its refresh token. */
export async function authorizeMicrosoft(): Promise<{ email: string; name: string; refreshToken: string }> {
  if (!microsoftConfigured()) {
    throw new Error('Client OAuth Microsoft non configuré : renseigner MAIN_VITE_MICROSOFT_CLIENT_ID dans .env.')
  }
  const { code, verifier, redirectUri } = await authorizeInBrowser({
    provider: 'Microsoft',
    authUrl: `${AUTHORITY}/authorize`,
    // Entra ID matches loopback redirects on "http://localhost" whatever the port.
    redirectHost: 'localhost',
    params: { client_id: clientId, scope: SCOPES.join(' '), prompt: 'select_account' }
  })
  const tokens = await tokenRequest({ code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (!tokens.refresh_token) throw new Error("Microsoft n'a pas fourni de refresh token.")
  const claims = idClaims(tokens.id_token)
  const email = (claims.email ?? claims.preferred_username ?? '').toLowerCase()
  if (!email.includes('@')) throw new Error('Microsoft n’a pas communiqué l’adresse du compte.')
  return { email, name: claims.name || email, refreshToken: tokens.refresh_token }
}

/**
 * Access token for IMAP/SMTP, cached until expiry. Microsoft rotates refresh tokens:
 * the new one is stored so the account keeps working past the old token's lifetime.
 */
export async function microsoftAccessToken(accountId: string): Promise<string> {
  const cached = tokenCache.get(accountId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const secret = await getSecret(accountId)
  if (!secret.refreshToken) throw new Error('Refresh token manquant : reconnecter le compte Microsoft.')
  const tokens = await tokenRequest({ refresh_token: secret.refreshToken, grant_type: 'refresh_token' })
  if (tokens.refresh_token && tokens.refresh_token !== secret.refreshToken) {
    await setSecret(accountId, { ...secret, refreshToken: tokens.refresh_token })
  }
  tokenCache.set(accountId, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 })
  return tokens.access_token
}
