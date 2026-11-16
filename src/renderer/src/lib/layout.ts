import { useStore } from '../store'

/** Width breakpoints of the app window, in CSS px. */
export const BREAKPOINTS = { rail: 1360, single: 1100, drawer: 760 }

export interface Layout {
  /** Sidebar shows icons only. */
  rail: boolean
  /** One pane at a time: the list, or the open conversation / composer. */
  single: boolean
  /** Sidebar is hidden and opens as an overlay drawer. */
  drawer: boolean
  sidebarWidth: number
}

export function layoutFor(width: number, userCollapsed: boolean): Layout {
  const drawer = width < BREAKPOINTS.drawer
  const rail = !drawer && (userCollapsed || width < BREAKPOINTS.rail)
  return { rail, drawer, single: width < BREAKPOINTS.single, sidebarWidth: drawer ? 0 : rail ? 60 : 232 }
}

export function useLayout(): Layout {
  const width = useStore((s) => s.viewport)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  return layoutFor(width, collapsed)
}
