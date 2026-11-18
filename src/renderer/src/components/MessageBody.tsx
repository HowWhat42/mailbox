import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { Copy, ExternalLink, Image as ImageIcon, ImageOff, Link, Mail, TextSelect } from 'lucide-react'
import { textToHtml } from '../lib/format'
import { foldQuotes, QUOTE_CSS, quoteTextMail } from '../lib/quotes'
import { api, useStore } from '../store'
import { Menu, type MenuEntry } from './ui/Menu'

const REMOTE = /(<img[^>]+src=["']?https?:|url\(\s*["']?https?:|<image[^>]+href=["']?https?:)/i

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function buildDoc(html: string, allowRemote: boolean): string {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'link'],
    FORBID_ATTR: ['srcset']
  })
  // The CSP is the real guard: no scripts at all, and remote content only when the user asks for it.
  const img = allowRemote ? 'data: https: http:' : 'data:'
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'${allowRemote ? ' https: http:' : ''}; font-src data:${allowRemote ? ' https:' : ''};`
  const base = `
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <style>
      html { background: #fff; }
      body { margin: 0; padding: 24px 28px; color: #1d1d22; font: 14px/1.55 'Inter Variable', system-ui, sans-serif; overflow-wrap: anywhere; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100% !important; }
      pre { white-space: pre-wrap; }
      a { color: #0d7c72; }
      blockquote { margin: 8px 0; padding-left: 12px; border-left: 2px solid #d4d4db; color: #5c5c66; }
      ${allowRemote ? '' : 'img:not([src^="data:"]) { visibility: hidden; }'}
      ${QUOTE_CSS}
    </style>`
  // Fold the quoted history (Gmail-style "•••") before the document reaches the iframe.
  const parsed = new DOMParser().parseFromString(clean, 'text/html')
  foldQuotes(parsed)
  parsed.head.insertAdjacentHTML('afterbegin', base)
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}

const ANSWERED: Record<string, string> = { accepted: 'Invitation acceptée', declined: 'Invitation refusée', tentative: 'Réponse envoyée : peut-être' }

async function answerInvite(href: string): Promise<void> {
  const { toast } = useStore.getState()
  try {
    const status = await api.calendar.respondToInvite(href)
    // Not an agenda connected in Mailbox: Google's own page is the only way to answer.
    if (!status) return void (await api.app.openExternal(href))
    toast(ANSWERED[status] ?? 'Réponse envoyée')
  } catch (err) {
    toast((err as Error).message, 'error')
  }
}

async function copy(text: string, done: string): Promise<void> {
  await api.app.copyText(text)
  useStore.getState().toast(done)
}

/** Right-click on a message: what applies to the link, address, image or selection under the pointer. */
function contextItems(target: Element, d: Document): MenuEntry[] {
  const items: MenuEntry[] = []
  const selected = d.getSelection()?.toString() ?? ''
  if (selected.trim()) items.push({ label: 'Copier', icon: Copy, hint: 'Ctrl C', onSelect: () => void copy(selected, 'Texte copié') })

  const link = target.closest('a[href]') as HTMLAnchorElement | null
  const href = link?.href ?? ''
  if (/^mailto:/i.test(href)) {
    const [path, query] = href.slice(7).split('?')
    const address = decodeURIComponent(path)
    const subject = new URLSearchParams(query ?? '').get('subject') ?? ''
    if (items.length) items.push('separator')
    items.push(
      { label: `Écrire à ${address}`, icon: Mail, onSelect: () => useStore.getState().compose({ to: [{ name: '', address }], subject }) },
      { label: 'Copier l’adresse e-mail', icon: Copy, onSelect: () => void copy(address, 'Adresse copiée') }
    )
  } else if (/^https?:/i.test(href)) {
    if (items.length) items.push('separator')
    items.push(
      { label: 'Ouvrir le lien', icon: ExternalLink, onSelect: () => void api.app.openExternal(href) },
      { label: 'Copier le lien', icon: Link, onSelect: () => void copy(href, 'Lien copié') }
    )
  }

  const img = target.closest('img') as HTMLImageElement | null
  if (img && /^https?:/i.test(img.src)) {
    if (items.length) items.push('separator')
    items.push(
      { label: 'Ouvrir l’image', icon: ImageIcon, onSelect: () => void api.app.openExternal(img.src) },
      { label: 'Copier l’adresse de l’image', icon: Copy, onSelect: () => void copy(img.src, 'Adresse de l’image copiée') }
    )
  }

  if (items.length) items.push('separator')
  items.push({
    label: 'Tout sélectionner',
    icon: TextSelect,
    hint: 'Ctrl A',
    onSelect: () => d.getSelection()?.selectAllChildren(d.body)
  })
  return items
}

export function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  // Settings › Lecture › Images distantes, live: switching it applies to messages already open.
  const always = useStore((s) => s.settings?.remoteImages === 'allow')
  const [allowedHere, setAllowedHere] = useState(false)
  const allowRemote = always || allowedHere
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)
  const source =
    html ?? (text ? `<pre style="font:inherit;margin:0">${quoteTextMail(textToHtml(text))}</pre>` : '<p style="color:#888">(message vide)</p>')
  const hasRemote = useMemo(() => REMOTE.test(source), [source])
  const doc = useMemo(() => buildDoc(source, allowRemote), [source, allowRemote])

  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observer.current?.disconnect(), [])

  // Wired as the iframe's own onLoad, not from an effect: a document that loads before the effect
  // runs (cached, no images to wait for) would never be measured and stay stuck at its first height.
  const onLoad = (): void => {
    const d = frame.current?.contentDocument
    if (!d?.body) return
    const measure = (): void => {
      // body, not <html>: the root element is never shorter than the iframe itself.
      // scrollHeight too: content that overflows a body pinned to `height: 100%`.
      setHeight(Math.max(48, Math.ceil(d.body.getBoundingClientRect().height), d.body.scrollHeight))
    }
    measure()
    // The mail runs no script: the "•••" toggles are wired from here (same-origin, sandboxed).
    d.querySelectorAll<HTMLButtonElement>('.mb-quote-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const open = btn.nextElementSibling?.classList.toggle('mb-open') ?? false
        btn.setAttribute('aria-expanded', String(open))
        btn.title = open ? 'Masquer le message cité' : 'Afficher le message cité'
        measure()
      })
    })
    // Oui / Non / Peut-être of a Google invitation: answer from here instead of opening Google Agenda.
    d.addEventListener('click', (e) => {
      const link = (e.target as Element | null)?.closest?.('a[href*="action=RESPOND"]') as HTMLAnchorElement | null
      if (!link) return
      e.preventDefault()
      void answerInvite(link.href)
    })
    // Our own menu: the system one has nothing useful in a sandboxed frame (no copy link).
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const box = frame.current?.getBoundingClientRect()
      if (!box || !(e.target instanceof d.defaultView!.Element)) return
      setMenu({ x: box.left + e.clientX, y: box.top + e.clientY, items: contextItems(e.target, d) })
    })
    // Clicks inside the frame never reach the menu's outside-click handler.
    d.addEventListener('mousedown', (e) => e.button !== 2 && setMenu(null))
    observer.current?.disconnect()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(d.body)
  }

  return (
    <div>
      {hasRemote && !allowRemote && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
          <ImageOff size={13} />
          Images distantes bloquées pour protéger votre vie privée.
          <button onClick={() => setAllowedHere(true)} className="font-medium text-accent hover:underline">
            Afficher les images
          </button>
          <span aria-hidden>·</span>
          <button
            onClick={() => {
              void useStore.getState().updateSettings({ remoteImages: 'allow' })
              useStore.getState().toast('Images distantes affichées pour tous les messages (Réglages › Général pour revenir en arrière)')
            }}
            className="font-medium text-accent hover:underline"
          >
            Toujours afficher
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-lg bg-paper shadow-[0_1px_0_rgb(0_0_0/0.04),0_0_0_1px_var(--line)]">
        <iframe
          ref={frame}
          title="Contenu du message"
          // Same-origin lets us measure the height; with no allow-scripts nothing in the mail can run.
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={doc}
          onLoad={onLoad}
          style={{ height }}
          className="block w-full border-0"
        />
      </div>
      {menu && <Menu anchor={{ x: menu.x, y: menu.y }} items={menu.items} onClose={() => setMenu(null)} minWidth={220} />}
    </div>
  )
}
