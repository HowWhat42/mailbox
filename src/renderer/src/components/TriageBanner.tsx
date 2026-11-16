import { useState } from 'react'
import { MailX, Users } from 'lucide-react'
import type { ThreadSummary } from '@shared/types'
import { api, confirmDialog, useStore } from '../store'
import { CATEGORY_ICON, CATEGORY_LABEL } from '../lib/categories'

/** Shown on newsletters and automated mail: unsubscribe, or tell the triage it got it wrong. */
export function TriageBanner({ thread, messageId }: { thread: ThreadSummary; messageId: string }) {
  const { toast, refreshMail } = useStore.getState()
  const [busy, setBusy] = useState(false)
  const Icon = CATEGORY_ICON[thread.category]
  const sender = thread.from.name || thread.from.address

  const unsubscribe = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: `Se désabonner de ${sender} ?`,
      body: 'Mailbox utilise le lien de désabonnement fourni par l’expéditeur. Les prochains envois pourront encore arriver quelques jours.',
      confirmLabel: 'Se désabonner'
    })
    if (!ok) return
    setBusy(true)
    try {
      const result = await api.mail.unsubscribe(messageId)
      toast(result === 'done' ? `Désabonné de ${sender}` : 'Page de désabonnement ouverte dans le navigateur')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-[12.5px]">
      <Icon size={15} className="text-muted" />
      <span className="flex-1 text-fg-2">Classé dans {CATEGORY_LABEL[thread.category]}</span>
      {thread.canUnsubscribe && (
        <button
          onClick={() => void unsubscribe()}
          disabled={busy}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-line px-2.5 text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-50"
        >
          <MailX size={13} /> {busy ? 'Désabonnement…' : 'Se désabonner'}
        </button>
      )}
      <button
        onClick={() =>
          void api.rules.classifySender(thread.from.address, 'people').then(() => {
            toast(`Les messages de ${sender} iront dans Personnes`)
            void refreshMail()
          })
        }
        className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-muted hover:bg-hover hover:text-fg"
      >
        <Users size={13} /> C’est une personne
      </button>
    </div>
  )
}
