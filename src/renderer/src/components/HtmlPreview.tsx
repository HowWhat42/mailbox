import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Renders already-sanitized HTML the way a recipient sees it: white paper, no scripts (sandbox + CSP),
 * images allowed. Grows to fit its content.
 */
export function HtmlPreview({ html, label, minHeight = 48 }: { html: string; label: string; minHeight?: number }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(minHeight)
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https:;">
<style>
  html, body { margin: 0; background: #fff; color: #1d1d1f; }
  body { padding: 14px 16px; font: 14px/1.5 -apple-system, 'Segoe UI', Inter, sans-serif; overflow: hidden; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
</style></head><body>${html}</body></html>`,
    [html]
  )

  useEffect(() => {
    const f = frame.current
    if (!f) return
    const measure = (): void => setHeight(Math.max(minHeight, f.contentDocument?.documentElement.scrollHeight ?? minHeight))
    f.addEventListener('load', measure)
    // Images change the height once they arrive.
    const id = setInterval(measure, 400)
    const stop = setTimeout(() => clearInterval(id), 4000)
    return () => {
      f.removeEventListener('load', measure)
      clearInterval(id)
      clearTimeout(stop)
    }
    // `doc` is a trigger: a new document means measuring again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [doc, minHeight])

  return (
    <iframe
      ref={frame}
      title={label}
      sandbox="allow-same-origin"
      srcDoc={doc}
      style={{ height }}
      className="block w-full rounded-lg border border-line bg-white"
    />
  )
}
