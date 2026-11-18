import { Sparkles } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { api } from '../store'
import { releaseNotesHtml } from '../lib/markdown'
import { Modal } from './Modal'

/** What's new since the running version, one section per release, with the restart that installs it. */
export function ReleaseNotes({ update, onClose }: { update: UpdateStatus; onClose: () => void }) {
  const ready = update.state === 'ready'
  const notes = update.notes ?? []
  const behind = notes.length > 1 ? ` · ${notes.length} versions de retard` : ''
  return (
    <Modal title={`Nouveautés de Mailbox ${update.available ?? ''}`} onClose={onClose} width={560}>
      <div className="px-5 pb-5">
        <div className="mb-4 flex items-center gap-2 text-[12.5px] text-muted">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span>
            Vous avez la version {update.current}
            {behind}.{ready && !update.manual ? ' La nouvelle est téléchargée et prête.' : ''}
          </span>
        </div>
        {notes.length ? (
          <div className="max-h-[56vh] space-y-5 overflow-y-auto pr-1">
            {notes.map((n, i) => (
              <section key={n.version} className={i > 0 ? 'border-t border-line pt-4' : ''}>
                <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold text-fg">
                  {n.version}
                  {i === 0 && notes.length > 1 && <span className="text-[11.5px] font-normal text-muted">dernière version</span>}
                </h3>
                <div
                  className="release-notes"
                  // Sanitized in releaseNotesHtml: these come from the project's own release page. Links open in the
                  // browser: the main window turns any navigation into shell.openExternal.
                  dangerouslySetInnerHTML={{ __html: releaseNotesHtml(n.note) }}
                />
              </section>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-fg-2">Pas de notes pour cette version.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-lg px-4 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            Plus tard
          </button>
          {ready && (
            <button onClick={() => void api.updates.install()} className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium">
              {update.manual ? 'Télécharger' : 'Redémarrer pour installer'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
