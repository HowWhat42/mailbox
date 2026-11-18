import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'

export interface AuthorizationCode {
  code: string
  verifier: string
  redirectUri: string
}

/**
 * Runs the installed-app OAuth flow: opens the system browser and receives the
 * code on a one-shot loopback server (RFC 8252), protected by PKCE + state.
 * `redirectHost` is the host put in the redirect URI (the server always listens on 127.0.0.1).
 */
export async function authorizeInBrowser(opts: {
  provider: string
  authUrl: string
  params: Record<string, string>
  redirectHost?: '127.0.0.1' | 'localhost'
}): Promise<AuthorizationCode> {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const state = randomBytes(16).toString('base64url')

  return new Promise<AuthorizationCode>((resolve, reject) => {
    let redirectUri = ''
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const ok = !error && url.searchParams.get('state') === state && code
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0b0b0d;color:#e6e6ea;display:grid;place-items:center;height:100vh;margin:0">` +
          `<p>${ok ? 'Compte connecté. Vous pouvez fermer cet onglet.' : 'Connexion annulée.'}</p></body>`
      )
      clearTimeout(timer)
      server.close()
      if (ok) resolve({ code, verifier, redirectUri })
      else {
        const detail = url.searchParams.get('error_description') ?? error
        reject(new Error(detail ? `${opts.provider} : ${detail}` : 'Réponse OAuth invalide.'))
      }
    })
    const timer = setTimeout(() => {
      server.close()
      reject(new Error(`Délai de connexion ${opts.provider} dépassé.`))
    }, 5 * 60_000)
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://${opts.redirectHost ?? '127.0.0.1'}:${(server.address() as AddressInfo).port}`
      const url = new URL(opts.authUrl)
      url.search = new URLSearchParams({
        ...opts.params,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state
      }).toString()
      void shell.openExternal(url.toString())
    })
  })
}
