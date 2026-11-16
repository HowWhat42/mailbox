// CHANGELOG.md helpers, shared by the release script and the release workflow.
// CLI: node scripts/changelog.mjs notes <version>   prints that version's notes (empty if none)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const UPCOMING = '## À venir'

/** Text of a "## …" section: from its heading line to the next "## " heading or the end. */
function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `))
  if (start < 0) return null
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '))
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}

/** Notes waiting under "## À venir". */
export function upcomingNotes(markdown) {
  return section(markdown, UPCOMING) ?? ''
}

/** Notes of a released version ("## 0.1.5 — 16 novembre 2026"). */
export function versionNotes(markdown, version) {
  return section(markdown, `## ${version} —`) ?? ''
}

/** Turns "À venir" into the new version's section, leaving an empty "À venir" above it. */
export function releaseUpcoming(markdown, version, date) {
  return markdown.replace(/^## À venir$/m, `${UPCOMING}\n\n## ${version} — ${date}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'notes') {
  process.stdout.write(versionNotes(readFileSync('CHANGELOG.md', 'utf8'), process.argv[3] ?? ''))
}
