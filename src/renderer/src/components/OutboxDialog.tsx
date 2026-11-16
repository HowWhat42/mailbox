import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, Clock, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { QueuedSend } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import { Modal } from './Modal'
import { parseAddresses } from './RecipientInput'

/** Messages written offline, waiting for the connection: retry, edit or discard. */
export function OutboxDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<QueuedSend[]>([])
  const [busy, setBusy] = useState(false)
  const { toast, compose } = useStore.getState()

  const load = useCallback(() => void api.mail.queue().then((q) => setItems(q.outbox)), [])
  useEffect(() => {
    load()
    return api.app.on('queue:changed', load)
  }, [load])

  const edit = async (item: QueuedSend): Promise<void> => {
    const msg = await api.mail.takeFromOutbox(item.id)
    if (!msg) return
    onClose()
    compose({
      kind: 'draft',
      accountId: msg.accountId,
      to: parseAddresses(msg.to),
      cc: parseAddresses(msg.cc),
      bcc: parseAddresses(msg.bcc),
      subject: msg.subject,
      html: msg.html,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      attachments: msg.attachments,
      draftId: msg.draftId
    })
  }

  const discard = async (item: QueuedSend): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Supprimer ce message ?',
      body: `« ${item.subject || 'Sans objet'} » ne sera pas envoyé.`,
      confirmLabel: 'Supprimer',
      tone: 'danger'
    })
    if (ok) await api.mail.takeFromOutbox(item.id)
  }

  return (
    <Modal title="Boîte d’envoi" onClose={onClose} width={520}>
      <div className="px-5 pb-5">
        <p className="mb-3 text-[12.5px] text-muted">Ces messages partiront automatiquement dès que le serveur sera joignable.</p>
        {items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-fg-2">La boîte d’envoi est vide.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line">
            {items.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-3.5 py-3">
                {item.lastError ? (
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" />
                ) : (
                  <Clock size={15} className="mt-0.5 shrink-0 text-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{item.subject || '(sans objet)'}</p>
                  <p className="truncate text-[12px] text-muted">À {item.to}</p>
                  {item.lastError && <p className="mt-1 text-[12px] text-danger">{item.lastError}</p>}
                </div>
                <button
                  onClick={() => void edit(item)}
                  title="Modifier"
                  aria-label="Modifier le message"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-fg"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => void discard(item)}
                  title="Supprimer"
                  aria-label="Supprimer le message"
                  className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <button
            disabled={busy || items.length === 0}
            onClick={async () => {
              setBusy(true)
              await api.mail.retryOutbox()
              setBusy(false)
              const left = (await api.mail.queue()).outbox.length
              toast(left ? 'Toujours hors ligne : nouvel essai automatique plus tard' : 'Messages envoyés')
            }}
            className="btn-primary flex h-9 items-center gap-2 rounded-lg px-4 text-[13px] font-medium disabled:opacity-50"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Réessayer maintenant
          </button>
        </div>
      </div>
    </Modal>
  )
}
