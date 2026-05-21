/**
 * Writes dist/health.json after `npm run build` (Docker image release metadata).
 * Env: APP_VERSION, GIT_COMMIT, BUILD_TIME (ISO); falls back to package.json + unknown.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = process.env.APP_VERSION?.trim() || pkg.version
const gitCommit = process.env.GIT_COMMIT?.trim() || 'unknown'
const builtAt = process.env.BUILD_TIME?.trim() || new Date().toISOString()

const payload = {
  status: 'ok',
  name: pkg.name,
  version,
  gitTag: `v${version}`,
  gitCommit,
  builtAt
}

const out = join(root, 'dist', 'health.json')
writeFileSync(out, `${JSON.stringify(payload)}\n`)
console.log(`Wrote ${out}: v${version} (${gitCommit})`)
