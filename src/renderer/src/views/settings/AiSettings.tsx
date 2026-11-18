import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, CircleDashed, Copy, KeyRound } from 'lucide-react'
import { format } from 'date-fns'
import type { McpActivity, McpStatus } from '@shared/types'
import { api, confirmDialog, useStore } from '../../store'
import { Toggle } from '../../components/ui/Controls'
import { fieldCls } from '../../components/Modal'
import { Row, Section } from './parts'

const OUTCOMES: Record<McpActivity['outcome'], { label: string; cls: string }> = {
  ok: { label: 'OK', cls: 'text-emerald-400' },
  error: { label: 'Erreur', cls: 'text-amber-400' },
  denied: { label: 'Refusé', cls: 'text-red-400' },
  cancelled: { label: 'Annulé', cls: 'text-muted' }
}

const btn = 'flex h-8 items-center gap-2 rounded-lg border border-line px-3.5 text-[12.5px] text-fg-2 hover:border-line-strong hover:text-fg'

function statusLine(s: McpStatus) {
  if (s.state === 'listening')
    return (
      <span className="flex items-center gap-1.5">
        <CircleCheck size={12} className="text-emerald-400" /> Actif sur <code className="select-text text-fg">{s.url}</code>
      </span>
    )
  if (s.state === 'error')
    return (
      <span className="flex items-center gap-1.5 text-amber-400">
        <CircleAlert size={12} /> {s.error}
      </span>
    )
  return (
    <span className="flex items-center gap-1.5">
      <CircleDashed size={12} /> Désactivé : aucune IA ne peut se connecter.
    </span>
  )
}

export function AiSettings() {
  const settings = useStore((s) => s.settings)!
  const update = useStore((s) => s.updateSettings)
  const { toast } = useStore.getState()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [activity, setActivity] = useState<McpActivity[]>([])
  /** Port being typed; null shows the saved one. */
  const [port, setPort] = useState<string | null>(null)

  useEffect(() => {
    const load = (): void => {
      void api.mcp.status().then(setStatus)
      void api.mcp.activity(40).then(setActivity)
    }
    load()
    return api.app.on('mcp:changed', load)
  }, [])

  const savePort = (): void => {
    if (port === null) return
    const n = Number(port)
    setPort(null)
    if (!Number.isInteger(n) || n < 1024 || n > 65535) toast('Port invalide : choisissez un nombre entre 1024 et 65535.', 'error')
    else if (n !== settings.mcpPort) void update({ mcpPort: n })
  }

  const copyCommand = async (): Promise<void> => {
    const token = await api.mcp.token()
    const url = status?.url ?? `http://127.0.0.1:${settings.mcpPort}/mcp`
    await api.app.copyText(`claude mcp add --transport http mailbox ${url} --header "Authorization: Bearer ${token}"`)
    toast('Commande copiée : elle contient le jeton, ne la partagez pas.')
  }

  const copyToken = async (): Promise<void> => {
    await api.app.copyText(await api.mcp.token())
    toast('Jeton copié')
  }

  const regenerate = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Régénérer le jeton ?',
      body: 'Les assistants configurés avec l’ancien jeton ne pourront plus se connecter tant que vous ne leur aurez pas donné le nouveau.',
      confirmLabel: 'Régénérer',
      tone: 'danger'
    })
    if (!ok) return
    await api.mcp.regenerateToken()
    toast('Nouveau jeton créé')
  }

  return (
    <>
      <Section
        title="Serveur MCP local"
        description="Permet à un assistant IA (Claude Code, Claude Desktop, Cursor…) de lire vos mails et votre agenda via le protocole MCP. Le serveur n’écoute que sur cet ordinateur (127.0.0.1), exige un jeton secret et refuse toute requête venant d’un navigateur."
      >
        <Row label="Autoriser les assistants IA" hint={status && statusLine(status)}>
          <Toggle label="" ariaLabel="Autoriser les assistants IA" checked={settings.mcpEnabled} onChange={(v) => void update({ mcpEnabled: v })} />
        </Row>
        <Row label="Port" hint="Entre 1024 et 65535. À changer seulement s’il est déjà pris par une autre application.">
          <input
            value={port ?? String(settings.mcpPort)}
            inputMode="numeric"
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
            onBlur={savePort}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Port du serveur MCP"
            className={`${fieldCls} !w-28`}
          />
        </Row>
      </Section>

      <Section
        title="Permissions"
        description="La lecture (conversations, contacts, agenda) est toujours permise quand le serveur est actif. Le reste est à accorder ici. Supprimer des messages, vider un dossier, ouvrir une pièce jointe ou toucher aux comptes et réglages n’est jamais possible."
      >
        <Row
          label="Brouillons, classement et événements"
          hint="Écrire des brouillons (sans pièce jointe), marquer lu ou suivi, archiver, ajouter un événement sans invité."
        >
          <Toggle
            label=""
            ariaLabel="Brouillons, classement et événements"
            checked={settings.mcpAllowWrite}
            onChange={(v) => void update({ mcpAllowWrite: v })}
          />
        </Row>
        <Row
          label="Envoi de messages"
          hint="Chaque message s’affiche d’abord dans une fenêtre de Mailbox : il ne part que si vous cliquez sur Envoyer. Un mail reçu peut contenir des consignes piégées destinées à l’IA ; relisez toujours le destinataire et le texte."
        >
          <Toggle label="" ariaLabel="Envoi de messages" checked={settings.mcpAllowSend} onChange={(v) => void update({ mcpAllowSend: v })} />
        </Row>
      </Section>

      <Section
        title="Connexion"
        description="Le jeton est chiffré par le système sur cet ordinateur. Toute personne qui le possède peut accéder à votre messagerie tant que le serveur est actif : ne le collez que dans la configuration de votre assistant."
      >
        <Row label="Claude Code" hint="Copie la commande d’installation, jeton compris, à coller dans un terminal.">
          <button onClick={() => void copyCommand()} className={btn}>
            <Copy size={13} /> Copier la commande
          </button>
        </Row>
        <Row
          label="Autres assistants"
          hint={<>Adresse : {status?.url ?? `http://127.0.0.1:${settings.mcpPort}/mcp`} · en-tête « Authorization: Bearer &lt;jeton&gt; ».</>}
        >
          <div className="flex gap-2">
            <button onClick={() => void copyToken()} className={btn}>
              <Copy size={13} /> Copier le jeton
            </button>
            <button onClick={() => void regenerate()} className={btn}>
              <KeyRound size={13} /> Régénérer
            </button>
          </div>
        </Row>
      </Section>

      <Section title="Activité" description="Les 40 dernières actions des assistants et les connexions refusées.">
        {activity.length === 0 ? (
          <p className="px-4 py-3.5 text-[12.5px] text-muted">Aucune activité pour l’instant.</p>
        ) : (
          <>
            <ul aria-label="Activité des assistants IA" className="max-h-80 divide-y divide-line overflow-y-auto">
              {activity.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 px-4 py-2 text-[12.5px]">
                  <span className="w-[86px] shrink-0 tabular-nums text-muted">{format(a.at, 'dd/MM HH:mm:ss')}</span>
                  <code className="w-[120px] shrink-0 truncate text-fg">{a.tool}</code>
                  <span className={`w-14 shrink-0 ${OUTCOMES[a.outcome].cls}`}>{OUTCOMES[a.outcome].label}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-2" title={a.detail}>
                    {a.detail}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end px-4 py-2.5">
              <button onClick={() => void api.mcp.clearActivity()} className="text-[12px] text-muted hover:text-fg">
                Effacer l’historique
              </button>
            </div>
          </>
        )}
      </Section>
    </>
  )
}
