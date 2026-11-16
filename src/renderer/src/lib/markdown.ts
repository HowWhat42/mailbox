import DOMPurify from 'dompurify'
import { escapeHtml } from './format'

/** **bold**, `code` and [links](https://…), on already-escaped text. */
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
}

/** The small Markdown of CHANGELOG.md (headings, lists, paragraphs) as HTML. */
function markdownToHtml(md: string): string {
  const out: string[] = []
  let list = false
  let para: string[] = []
  const flush = (): void => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = escapeHtml(raw.trim())
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const item = /^[-*]\s+(.*)$/.exec(line)
    if (item) {
      flush()
      if (!list) out.push('<ul>')
      list = true
      out.push(`<li>${inline(item[1])}</li>`)
      continue
    }
    if (list) {
      out.push('</ul>')
      list = false
    }
    if (heading) {
      flush()
      out.push(`<h3>${inline(heading[2])}</h3>`)
    } else if (!line) flush()
    else para.push(line)
  }
  flush()
  if (list) out.push('</ul>')
  return out.join('')
}

/** Release notes ready to show: GitHub gives HTML (sanitized), a plain feed gives Markdown. */
export function releaseNotesHtml(notes: string): string {
  const html = /<\/?[a-z][\s\S]*>/i.test(notes) ? notes : markdownToHtml(notes)
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input', 'img'] })
}
