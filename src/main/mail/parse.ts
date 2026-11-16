import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import type { Address, Attachment } from '@shared/types'

export function addressList(value: AddressObject | AddressObject[] | undefined): Address[] {
  if (!value) return []
  const groups = Array.isArray(value) ? value : [value]
  return groups.flatMap((g) =>
    g.value.flatMap((a) =>
      a.group ? a.group.map((m) => ({ name: m.name ?? '', address: m.address ?? '' })) : [{ name: a.name ?? '', address: a.address ?? '' }]
    )
  )
}

export function snippetOf(text: string | undefined | null): string {
  return (text ?? '').replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 220)
}

/** Parses a (possibly truncated) message prefix just to get a preview line. */
export async function previewFromPartialSource(source: Buffer): Promise<string> {
  try {
    const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipHtmlToText: false })
    return snippetOf(parsed.text)
  } catch {
    return ''
  }
}

export interface FullBody {
  html: string | null
  text: string | null
  attachments: Attachment[]
  parsed: ParsedMail
}

export async function parseFull(source: Buffer): Promise<FullBody> {
  const parsed = await simpleParser(source, { skipTextToHtml: true })
  let html = parsed.html || null
  // Inline images referenced by cid: become data URIs so the sandboxed viewer can show them.
  if (html) {
    for (const att of parsed.attachments) {
      if (att.contentId && att.content) {
        const cid = att.contentId.replace(/^<|>$/g, '')
        html = html.replaceAll(`cid:${cid}`, `data:${att.contentType};base64,${att.content.toString('base64')}`)
      }
    }
  }
  const attachments = parsed.attachments
    .map((a, index) => ({ a, index }))
    .filter(({ a }) => a.contentDisposition === 'attachment' || !a.related)
    .map(({ a, index }) => ({
      id: String(index),
      filename: a.filename ?? `piece-jointe-${index + 1}`,
      contentType: a.contentType,
      size: a.size
    }))
  return { html, text: parsed.text ?? null, attachments, parsed }
}

/** Message-ID / References header values without angle brackets. */
export function idList(value: string | undefined | null): string[] {
  return (value ?? '').match(/<[^>]+>/g)?.map((v) => v.slice(1, -1)) ?? []
}
