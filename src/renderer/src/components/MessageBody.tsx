import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { ImageOff } from 'lucide-react'
import { textToHtml } from '../lib/format'

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
    </style>`
  return clean.replace(/<head>/i, `<head>${base}`)
}

export function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  const [allowRemote, setAllowRemote] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)
  const source = html ?? (text ? `<pre style="font:inherit;margin:0">${textToHtml(text)}</pre>` : '<p style="color:#888">(message vide)</p>')
  const hasRemote = useMemo(() => REMOTE.test(source), [source])
  const doc = useMemo(() => buildDoc(source, allowRemote), [source, allowRemote])

  useEffect(() => {
    const el = frame.current
    if (!el) return
    let observer: ResizeObserver | null = null
    const measure = (): void => {
      const d = el.contentDocument
      // body, not <html>: the root element is never shorter than the iframe itself.
      if (d?.body) setHeight(Math.max(48, Math.ceil(d.body.getBoundingClientRect().height)))
    }
    const onLoad = (): void => {
      measure()
      const d = el.contentDocument
      if (d?.body) {
        observer = new ResizeObserver(measure)
        observer.observe(d.body)
      }
    }
    el.addEventListener('load', onLoad)
    return () => {
      el.removeEventListener('load', onLoad)
      observer?.disconnect()
    }
  }, [doc])

  return (
    <div>
      {hasRemote && !allowRemote && (
        <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
          <ImageOff size={13} />
          Images distantes bloquées pour protéger votre vie privée.
          <button onClick={() => setAllowRemote(true)} className="font-medium text-accent hover:underline">
            Afficher les images
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
          style={{ height }}
          className="block w-full border-0"
        />
      </div>
    </div>
  )
}
