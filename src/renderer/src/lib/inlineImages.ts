/** Wider than this, a picture is scaled down before it goes in a message: no 4000 px phone photo in a mail. */
const MAX_WIDTH = 1600

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(reader.result as string))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image illisible.')))
    reader.readAsDataURL(file)
  })
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.src = src
  await img.decode().catch(() => {
    throw new Error('Image illisible.')
  })
  return img
}

/** The picture as a data: URI (sent as an inline cid: part), scaled down when it's huge. */
async function toDataUrl(file: File): Promise<string> {
  const src = await readAsDataUrl(file)
  // GIFs would lose their animation, SVGs their sharpness: they go in as they are.
  if (/^image\/(gif|svg)/i.test(file.type)) return src
  const img = await loadImage(src)
  if (img.naturalWidth <= MAX_WIDTH) return src
  const canvas = document.createElement('canvas')
  canvas.width = MAX_WIDTH
  canvas.height = Math.round((img.naturalHeight * MAX_WIDTH) / img.naturalWidth)
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
  return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
}

export function imageFiles(list: FileList | File[] | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith('image/'))
}

/** Inserts pictures where the caret is in `editor` (at the top when it's elsewhere), undoable with Ctrl Z. */
export async function insertImages(editor: HTMLElement, files: File[]): Promise<void> {
  if (!files.length) return
  const sources = await Promise.all(files.map(toDataUrl))
  const selection = window.getSelection()
  const inside = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
  editor.focus()
  if (!inside) selection?.setPosition(editor, 0)
  const html = sources.map((src) => `<img src="${src}" alt="" style="max-width:100%;height:auto">`).join('')
  // Fires the editor's input event itself: the draft autosaves like after typing.
  document.execCommand('insertHTML', false, html)
}

/** Puts the caret under the pointer: where a dropped picture lands. */
export function caretAt(x: number, y: number): void {
  const at = document.caretRangeFromPoint(x, y)
  if (!at) return
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(at)
}

/** Opens the system picker for pictures. */
export function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.addEventListener('change', () => resolve(imageFiles(input.files)))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}
