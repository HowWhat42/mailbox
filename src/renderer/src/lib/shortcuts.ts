import { useEffect } from 'react'
import { threadKey, useStore } from '../store'
import { replyDraft } from './reply'

export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function modalOpen(): boolean {
  const s = useStore.getState()
  return !!(s.composer || s.paletteOpen || s.setupOpen || s.settingsOpen)
}

/** Global keyboard map. Single keys only fire outside text fields; "g" starts a two-key jump. */
export function useMailShortcuts(): void {
  useEffect(() => {
    let pendingG = 0

    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        s.setPalette(!s.paletteOpen)
        return
      }
      if (isTyping(e) || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return

      if (pendingG && Date.now() - pendingG < 1000) {
        pendingG = 0
        const jumps: Record<string, () => void> = {
          i: () => s.setView({ type: 'unified', role: 'inbox' }),
          s: () => s.setView({ type: 'unified', role: 'flagged' }),
          t: () => s.setView({ type: 'unified', role: 'sent' }),
          d: () => s.setView({ type: 'unified', role: 'drafts' }),
          c: () => s.setMode('calendar')
        }
        jumps[e.key]?.()
        e.preventDefault()
        return
      }
      if (e.key === 'g') {
        pendingG = Date.now()
        return
      }

      if (e.key === 'c') {
        e.preventDefault()
        s.compose()
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
        return
      }
      if (s.mode !== 'mail') return

      const current = s.threads.find((t) => threadKey(t) === s.selected)
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          s.move(1)
          return
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          s.move(-1)
          return
        case 'Escape':
          s.select(null)
          return
      }
      if (!current) return
      switch (e.key) {
        case 'e':
          void s.act(current, 'archive')
          break
        case '#':
        case 'Delete':
          void s.act(current, 'trash')
          break
        case 's':
          void s.act(current, current.flagged ? 'unflag' : 'flag')
          break
        case 'u':
          void s.act(current, current.unread ? 'read' : 'unread')
          break
        case '!':
          void s.act(current, 'junk')
          break
        case 'r':
        case 'a':
        case 'f':
          e.preventDefault()
          void replyDraft(current, e.key === 'r' ? 'reply' : e.key === 'a' ? 'replyAll' : 'forward').then((d) => s.compose(d))
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
