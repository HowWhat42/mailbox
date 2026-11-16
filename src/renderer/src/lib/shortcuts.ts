import { useEffect } from 'react'
import { threadKey, useStore } from '../store'
import { startReply } from './threadActions'

export function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function overlayOpen(): boolean {
  const s = useStore.getState()
  return !!(s.paletteOpen || s.setupOpen || s.movePicker || s.dialog || document.querySelector('[role=menu]'))
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
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        s.toggleSidebar()
        return
      }
      if (isTyping(e) || overlayOpen() || e.ctrlKey || e.metaKey || e.altKey) return
      if (s.mode === 'settings') {
        if (e.key === 'Escape') s.setMode('mail')
        return
      }

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
      if (e.key === 'z') {
        s.undoLast()
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
      if (s.mode !== 'mail' || s.composer) return

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
          if (s.checked.size) s.setChecked([])
          else s.select(null)
          return
        case 'x':
          if (s.selected) s.toggleCheck(s.selected)
          return
      }

      const targets = s.targets()
      if (!targets.length) return
      const current = s.threads.find((t) => threadKey(t) === s.selected)
      switch (e.key) {
        case 'e':
          void s.act(targets, 'archive')
          break
        case '#':
        case 'Delete':
          void s.act(targets, 'trash')
          break
        case '!':
          void s.act(targets, 'junk')
          break
        case 's':
          void s.act(targets, targets.every((t) => t.flagged) ? 'unflag' : 'flag')
          break
        case 'u':
          void s.act(targets, targets.some((t) => t.unread) ? 'read' : 'unread')
          break
        case 'v':
          e.preventDefault()
          if (new Set(targets.map((t) => t.accountId)).size === 1) s.openMovePicker(targets)
          break
        case 'r':
        case 'a':
        case 'f':
          e.preventDefault()
          if (current) startReply(current, e.key === 'r' ? 'reply' : e.key === 'a' ? 'replyAll' : 'forward')
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
