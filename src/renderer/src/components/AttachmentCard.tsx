import { Download, X } from 'lucide-react'
import { extensionOf, fileSize } from '../lib/format'

const TINT: Record<string, string> = {
  PDF: '#ef4444',
  DOC: '#3b82f6',
  DOCX: '#3b82f6',
  XLS: '#22c55e',
  XLSX: '#22c55e',
  CSV: '#22c55e',
  PPT: '#f97316',
  PPTX: '#f97316',
  ZIP: '#a855f7',
  PNG: '#14b8a6',
  JPG: '#14b8a6',
  JPEG: '#14b8a6',
  GIF: '#14b8a6',
  WEBP: '#14b8a6'
}

/** File tile: type badge, name, size; open on click, optional save / remove. */
export function AttachmentCard({
  name,
  size,
  onOpen,
  onSave,
  onRemove
}: {
  name: string
  size: number
  onOpen?: () => void
  onSave?: () => void
  onRemove?: () => void
}) {
  const ext = extensionOf(name)
  return (
    <div className="group relative w-[148px]">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        title={onOpen ? `Ouvrir ${name}` : name}
        aria-label={onOpen ? `Ouvrir ${name}` : name}
        className="flex w-full flex-col overflow-hidden rounded-lg border border-line bg-panel text-left transition-colors hover:border-line-strong disabled:cursor-default"
      >
        <span className="relative grid h-16 place-items-center bg-hover/60">
          <span className="rounded px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide text-white" style={{ background: TINT[ext] ?? '#71717a' }}>
            {ext}
          </span>
        </span>
        <span className="px-2.5 py-1.5">
          <span className="block truncate text-[12px] font-medium text-fg">{name}</span>
          <span className="tnum block text-[11px] text-muted">{fileSize(size)}</span>
        </span>
      </button>
      {onSave && (
        <button
          type="button"
          onClick={onSave}
          title="Enregistrer sous…"
          aria-label={`Enregistrer ${name}`}
          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-raised text-muted opacity-0 shadow-card transition-opacity hover:text-fg group-hover:opacity-100"
        >
          <Download size={12} />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          title="Retirer"
          aria-label={`Retirer ${name}`}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-fg text-surface shadow"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
