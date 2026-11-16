// Cuts a release: bumps the version, commits, tags vX.Y.Z and pushes. CI builds and publishes it.
// Usage: pnpm release [patch|minor|major]   (default: patch)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const kind = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(kind)) {
  console.error('Usage: pnpm release [patch|minor|major]')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })

if (git('branch', '--show-current') !== 'main') throw new Error('Release from main.')
if (git('status', '--porcelain')) throw new Error('Commit or stash your changes first.')
git('fetch', 'origin', 'main')
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('main is not in sync with origin/main.')

run('pnpm', ['check'])

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)
const next = kind === 'major' ? `${major + 1}.0.0` : kind === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
writeFileSync('package.json', readFileSync('package.json', 'utf8').replace(`"version": "${pkg.version}"`, `"version": "${next}"`))

git('add', 'package.json')
git('commit', '-m', `Release v${next}`)
git('tag', '-a', `v${next}`, '-m', `Mailbox ${next}`)
git('push', 'origin', 'main', `v${next}`)
console.log(`v${next} pushed: https://github.com/HowWhat42/mailbox/actions`)
