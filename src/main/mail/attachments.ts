import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserWindow, dialog, shell } from 'electron'
import { getDb } from '../db'
import { parseFull } from './parse'
import { ensureBodies } from './sync'

export async function loadAttachment(messageId: string, attachmentId: string): Promise<{ filename: string; content: Buffer }> {
  await ensureBodies([messageId])
  const row = getDb().prepare('SELECT eml_path FROM messages WHERE id = ?').get(messageId) as { eml_path: string | null } | undefined
  if (!row?.eml_path) throw new Error('Message introuvable.')
  const { parsed } = await parseFull(await readFile(row.eml_path))
  const index = Number(attachmentId)
  const att = parsed.attachments[index]
  if (!att) throw new Error('Pièce jointe introuvable.')
  // Strip path components a hostile sender could put in the filename.
  const filename = (att.filename ?? `piece-jointe-${index + 1}`).replace(/[\\/:*?"<>|]/g, '_')
  return { filename, content: att.content }
}

export async function openAttachment(messageId: string, attachmentId: string): Promise<void> {
  const { filename, content } = await loadAttachment(messageId, attachmentId)
  const dir = await mkdtemp(join(tmpdir(), 'mailbox-'))
  const file = join(dir, filename)
  await writeFile(file, content)
  const error = await shell.openPath(file)
  if (error) throw new Error(error)
}

export async function saveAttachment(messageId: string, attachmentId: string): Promise<void> {
  const { filename, content } = await loadAttachment(messageId, attachmentId)
  const win = BrowserWindow.getFocusedWindow()
  const options = { defaultPath: filename }
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return
  await writeFile(result.filePath, content)
}
