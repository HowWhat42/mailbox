import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, net } from 'electron'

/** An image from a message onto the clipboard, as PNG: a data: URI as is, a remote one fetched first. */
export async function copyImage(src: string): Promise<void> {
  let image: Electron.NativeImage | null = null
  if (/^data:image\//i.test(src)) image = nativeImage.createFromDataURL(src)
  else if (/^https?:/i.test(src)) {
    const res = await net.fetch(src)
    if (!res.ok) throw new Error(`Image indisponible (${res.status}).`)
    image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
  }
  // nativeImage only decodes PNG and JPEG: anything else comes back empty.
  if (!image || image.isEmpty()) throw new Error('Cette image ne peut pas être copiée.')
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
}

/**
 * Prints a message, already sanitized and locked down by its CSP, to a PDF the user picks.
 * Rendered in a hidden window with JavaScript off. False when the dialog is cancelled.
 */
export async function savePdf(html: string, name: string): Promise<boolean> {
  const parent = BrowserWindow.getFocusedWindow()
  const filename = `${
    name
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .trim()
      .slice(0, 120) || 'message'
  }.pdf`
  const options = { defaultPath: filename, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return false

  // A file rather than a data: URL: big messages (inline images) go past what a URL can carry.
  const dir = await mkdtemp(join(tmpdir(), 'mailbox-pdf-'))
  const file = join(dir, 'message.html')
  await writeFile(file, html)
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await win.loadFile(file)
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    await writeFile(result.filePath, pdf)
    return true
  } finally {
    win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}
