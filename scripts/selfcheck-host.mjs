#!/usr/bin/env node
/**
 * Host self-check WITHOUT a live dsh profile: boots the real ChatArchiveRunner
 * against fake services and a throwaway session store under a temp DSH_HOME,
 * then verifies that (1) an idle session is archived, (2) a recent session is
 * not, (3) a live session is never archived, (4) repeat scans are idempotent.
 *
 * DSH >= 0.1.5: the runner locates durable session artifacts by walking
 * $DSH_HOME/sessions (the service no longer exposes a locate()); this check
 * points DSH_HOME at a temp dir so the runner scans only its own fixtures.
 *
 * Run: node scripts/selfcheck-host.mjs
 */
import { mkdtemp, mkdir, writeFile, utimes, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatArchiveRunner } from '../dist/archiver.js'

const log = []
const now = Date.now()
const day = 86_400_000

// Point the runner at an isolated, throwaway harness home.
const home = await mkdtemp(join(tmpdir(), 'chat-archive-selfcheck-'))
process.env.DSH_HOME = home
const store = join(home, 'sessions')
const sessions = new Map()

async function makeSession(id, ageMs) {
  const dir = join(store, 'session-' + id)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'session.jsonl.zstd')
  await writeFile(path, 'header\nevent\n')
  const mtime = new Date(now - ageMs)
  await utimes(path, mtime, mtime)
  sessions.set(id, path)
  return { id, path }
}
await makeSession('old-1', 20 * day)
await makeSession('fresh-1', 1 * 3_600_000)
await makeSession('live-1', 40 * day)

const archived = []
const ctx = {
  effect: () => () => {},
  sessionPersistence: {
    list: async () => Array.from(sessions.keys()).map((id) => ({ header: { id } })),
  },
  workspaceRegistry: {
    archivedSessionIds: archived,
    archiveSession: async (id) => { archived.push(id) },
  },
  sessions: {
    get: (id) => (id === 'live-1' ? { live: true } : undefined),
  },
  settings: {
    installSection: () => {},
  },
}
const runner = new ChatArchiveRunner(ctx, (m) => log.push(m))
runner.source = () => ({ enabled: true, unit: 'hours', threshold: 72, intervalMinutes: 30, runNowTick: 0 })

const out = await runner.runScan('test')
if (out.archived.length !== 1 || out.archived[0] !== 'old-1') {
  throw new Error('expected exactly old-1 archived, got ' + JSON.stringify(out))
}
if (out.live.length !== 1 || out.live[0] !== 'live-1') throw new Error('expected live-1 skipped as live')
if (out.recent.length !== 1 || out.recent[0] !== 'fresh-1') throw new Error('expected fresh-1 skipped as recent')
if (out.undeterminable.length !== 0) throw new Error('unexpected undeterminable')

// second scan: idempotent
const out2 = await runner.runScan('test2')
if (out2.archived.length !== 0) throw new Error('second scan must archive nothing')

// interval guard: idle >= max(threshold, interval) — isolated store
{
  const sessions2 = new Map()
  const ctx2 = {
    effect: () => () => {},
    sessionPersistence: {
      list: async () => Array.from(sessions2.keys()).map((id) => ({ header: { id } })),
    },
    workspaceRegistry: { archivedSessionIds: [], archiveSession: async () => {} },
    sessions: { get: () => undefined },
    settings: { installSection: () => {} },
  }
  const r2 = new ChatArchiveRunner(ctx2, (m) => log.push(m))
  r2.source = () => ({ enabled: true, unit: 'minutes', threshold: 5, intervalMinutes: 30, runNowTick: 0 })
  async function makeSession2(id, ageMs) {
    const dir = join(store, 'session-' + id)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'session.jsonl.zstd')
    await writeFile(path, 'header\nevent\n')
    const mtime = new Date(now - ageMs)
    await utimes(path, mtime, mtime)
    sessions2.set(id, path)
  }
  await makeSession2('fresh-20min', 20 * 60_000)
  await makeSession2('idle-40min', 40 * 60_000)
  const res = await r2.runScan('interval-guard')
  if (res.archived.length !== 1 || res.archived[0] !== 'idle-40min') {
    throw new Error('expected only idle-40min archived under max(5min,30min) rule, got ' + JSON.stringify(res))
  }
  if (res.recent.some((id) => id === 'fresh-20min') !== true) {
    throw new Error('expected fresh-20min kept as recent (20 < 30 min floor), got ' + JSON.stringify(res))
  }
  console.log('interval-guard passed: 20-min idle kept, 40-min idle archived')
}
// disabled scan does nothing
runner.source = () => ({ enabled: false, unit: 'hours', threshold: 1, intervalMinutes: 30, runNowTick: 0 })
const out3 = await runner.runScan('disabled')
if (out3 !== null) throw new Error('disabled scan must return null')

console.log('selfcheck passed: archive=old-1, live/live-1, recent/fresh-1, idempotent, disabled-safe')
console.log('runner logs:')
for (const line of log) console.log('  ' + line)
await rm(home, { recursive: true, force: true })
