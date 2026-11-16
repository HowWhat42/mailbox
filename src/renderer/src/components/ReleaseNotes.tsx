import { Sparkles } from 'lucide-react'
import type { UpdateStatus } from '@shared/types'
import { api } from '../store'
import { releaseNotesHtml } from '../lib/markdown'
import { Modal } from './Modal'

/** What's new in the downloaded version, with the restart that installs it. */
export function ReleaseNotes({ update, onClose }: { update: UpdateStatus; onClose: () => void }) {
  const ready = update.state === 'ready'
  return (
    <Modal title={`Nouveautés de Mailbox ${update.available ?? ''}`} onClose={onClose} width={560}>
      <div className="px-5 pb-5">
        <div className="mb-4 flex items-center gap-2 text-[12.5px] text-muted">
          <Sparkles size={14} className="text-accent" />
          Vous avez la version {update.current}.{ready ? ' La nouvelle est téléchargée et prête.' : ''}
        </div>
        {update.notes ? (
          <div
            className="release-notes max-h-[56vh] overflow-y-auto pr-1"
            // Sanitized in releaseNotesHtml: these come from the project's own release page. Links open in the
            // browser: the main window turns any navigation into shell.openExternal.
            dangerouslySetInnerHTML={{ __html: releaseNotesHtml(update.notes) }}
          />
        ) : (
          <p className="text-[13px] text-fg-2">Pas de notes pour cette version.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 rounded-lg px-4 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            Plus tard
          </button>
          {ready && (
            <button onClick={() => void api.updates.install()} className="btn-primary h-9 rounded-lg px-4 text-[13px] font-medium">
              Redémarrer pour installer
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
