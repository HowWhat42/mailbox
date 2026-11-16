import DOMPurify from 'dompurify'
import { escapeHtml } from './format'

/** Marks the signature inside the composer, so switching the sending account can swap it. */
export const SIGNATURE_ATTR = 'data-mailbox-signature'

/** A signature written as HTML (pasted from a signature generator), rather than plain text. */
export function isHtmlSignature(signature: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(signature)
}

/** Safe HTML for a signature: HTML ones are sanitized, plain text keeps its line breaks. */
export function signatureHtml(signature: string): string {
  const s = signature.trim()
  if (!s) return ''
  if (!isHtmlSignature(s)) return escapeHtml(s).replace(/\n/g, '<br>')
  return DOMPurify.sanitize(s, { FORBID_TAGS: ['script', 'style', 'form', 'input', 'button', 'iframe', 'object', 'embed'] })
}

/**
 * The signature block appended to a new message. Plain text gets the usual "-- " delimiter;
 * a designed HTML signature goes in as it is.
 */
export function signatureBlock(signature: string): string {
  const html = signatureHtml(signature)
  if (!html) return ''
  const content = isHtmlSignature(signature) ? html : `-- <br>${html}`
  return `<div ${SIGNATURE_ATTR}="">${content}</div>`
}
