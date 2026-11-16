/**
 * Finds the quoted history at the bottom of a reply and folds it behind a "•••" button,
 * like Gmail. Works on the sanitized document, before it goes into the sandboxed iframe.
 */

const QUOTE_ROOTS = [
  '.gmail_quote_container',
  '.gmail_quote',
  '.yahoo_quoted',
  '#divRplyFwdMsg',
  '#appendonsend',
  '.moz-cite-prefix',
  'blockquote[type="cite"]',
  '.protonmail_quote',
  '[data-mailbox-quote]'
].join(',')

/** "Le 12 nov. 2026 à 10:00, Léa a écrit :" / "On Tue, Bob wrote:" / Outlook "De : … Envoyé : …". */
const ATTRIBUTION = /(a\s+écrit|wrote|schrieb|escribió|ha scritto)\s*:?\s*$|^(de|from)\s*:.*(envoyé|sent)\s*:/is

function textOf(nodes: Node[]): string {
  return nodes
    .map((n) => n.textContent ?? '')
    .join('')
    .replace(/\s+/g, '')
}

/** Top-most quote root in reading order, or the attribution line right before a bare <blockquote>. */
function findQuoteStart(body: HTMLElement): Element | null {
  const candidates = [...body.querySelectorAll(QUOTE_ROOTS)].filter((el) => !el.parentElement?.closest(QUOTE_ROOTS))
  let start: Element | null = candidates[0] ?? null
  if (!start) {
    // Plain <blockquote> preceded by an attribution sentence (our own replies, many webmails).
    for (const bq of body.querySelectorAll('blockquote')) {
      if (bq.parentElement?.closest('blockquote')) continue
      const prev = bq.previousElementSibling
      if (prev && ATTRIBUTION.test((prev.textContent ?? '').trim())) {
        start = prev
        break
      }
    }
  }
  if (!start) return null
  // Pull the attribution line in with the quote ("Le … a écrit :" just above Gmail/Apple quotes).
  const prev = start.previousElementSibling
  if (prev && prev.matches('div, p, span') && ATTRIBUTION.test((prev.textContent ?? '').trim())) start = prev
  return start
}

export function foldQuotes(doc: Document): boolean {
  const body = doc.body
  if (!body) return false
  const start = findQuoteStart(body)
  if (!start) return false
  // The quote and everything after it at the same level (signatures of the quoted mail, etc.).
  const quoted: Node[] = []
  for (let n: Node | null = start; n; n = n.nextSibling) quoted.push(n)
  // Nothing new above the quote (e.g. a plain forward): keep it visible.
  if (textOf([body]).length <= textOf(quoted).length) return false

  const wrapper = doc.createElement('div')
  wrapper.className = 'mb-quoted'
  start.parentNode!.insertBefore(wrapper, start)
  for (const n of quoted) wrapper.appendChild(n)

  const toggle = doc.createElement('button')
  toggle.className = 'mb-quote-toggle'
  toggle.type = 'button'
  toggle.title = 'Afficher le message cité'
  toggle.setAttribute('aria-label', 'Afficher le message cité')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.textContent = '•••'
  wrapper.parentNode!.insertBefore(toggle, wrapper)
  return true
}

/** Plain-text mail: trailing "> …" lines (and their attribution) become a quote block. */
export function quoteTextMail(html: string): string {
  const lines = html.split('<br>')
  let i = lines.length - 1
  while (i >= 0 && (lines[i].trim() === '' || lines[i].startsWith('&gt;'))) i--
  // Only trailing blank lines: nothing quoted.
  if (!lines.slice(i + 1).some((l) => l.startsWith('&gt;'))) return html
  if (i >= 0 && ATTRIBUTION.test(lines[i].replace(/<[^>]+>/g, '').trim())) i--
  const head = lines.slice(0, i + 1).join('<br>')
  const tail = lines.slice(i + 1).join('<br>')
  return `${head}<blockquote type="cite">${tail}</blockquote>`
}

export const QUOTE_CSS = `
  .mb-quoted { display: none; }
  .mb-quoted.mb-open { display: block; }
  .mb-quote-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    margin: 10px 0 4px; padding: 0 10px; height: 18px; border: 0; border-radius: 9px;
    background: #ececf1; color: #55555f; font: 700 12px/1 system-ui, sans-serif; letter-spacing: 1px; cursor: pointer;
  }
  .mb-quote-toggle:hover { background: #e0e0e8; }
  .mb-quote-toggle[aria-expanded="true"] { background: #e0e0e8; }
`
