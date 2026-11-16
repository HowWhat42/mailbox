import { Fragment } from 'react'
import { api } from '../store'
import { htmlToText } from './format'

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g

/**
 * Event descriptions are often HTML from another client (Teams, Outlook invites).
 * Render them as plain text with clickable links — never as live HTML.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const plain = /<[a-z][\s\S]*>/i.test(text) ? htmlToText(text) : text
  const parts = plain.split(URL_RE)
  return (
    <p className={`whitespace-pre-wrap break-words ${className ?? ''}`}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            onClick={(e) => {
              e.preventDefault()
              void api.app.openExternal(part)
            }}
            className="text-accent hover:underline"
          >
            {part.length > 60 ? `${part.slice(0, 57)}…` : part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </p>
  )
}
