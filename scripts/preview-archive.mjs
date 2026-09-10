#!/usr/bin/env node
/**
 * Dry-run preview: list which durable conversations WOULD be archived under a
 * given configuration. Reads real session artifacts under $DSH_HOME/sessions
 * but archives NOTHING — safe to run anytime.
 *
 * The rule mirrors the plugin: a session is a candidate only after it has been
 * continuously idle for max(threshold, one full scan interval).
 *
 * Usage:
 *   node scripts/preview-archive.mjs                       # 72 hours, interval 30 min
 *   node scripts/preview-archive.mjs 7 days                # threshold 7 days, interval 30 min
 *   node scripts/preview-archive.mjs 10 minutes 5          # threshold 10 min, interval 5 min
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

const [rawNumber = '72', unit = 'hours', rawInterval = '30'] = process.argv.slice(2)
const value = Number(rawNumber)
const intervalMinutes = Number(rawInterval)
if (!Number.isInteger(value) || value < 1) {
  console.error('threshold must be a positive integer')
  process.exit(2)
}
if (!['minutes', 'hours', 'days'].includes(unit)) {
  console.error("unit must be 'minutes', 'hours' or 'days'")
  process.exit(2)
}
if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
  console.error('interval must be a positive integer (minutes)')
  process.exit(2)
}
const unitMs = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }
const thresholdMs = value * unitMs[unit]
const effectiveMs = Math.max(thresholdMs, intervalMinutes * 60_000)
const cutoffMs = effectiveMs
const now = Date.now()

function isSessionId(name) {
  return name.startsWith('session-') || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(name)
}

async function walk(dir, out, workspace) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue
    const full = join(dir, entry.name)
    if (!entry.isDirectory()) continue
    if (isSessionId(entry.name)) {
      try {
        const files = await readdir(full)
        for (const file of files) {
          if (!/^session\.jsonl(\.[a-z0-9]+)?$/.test(file)) continue
          const info = await stat(join(full, file))
          out.push({ id: entry.name, workspace: workspace ?? dir.split('/').pop(), path: join(full, file), activityMs: info.mtimeMs })
          break
        }
      } catch {
        // unreadable session dir — skip
      }
    } else {
      await walk(full, out, entry.name)
    }
  }
  return out
}

const sessions = await walk(sessionsRoot, [])
sessions.sort((a, b) => a.activityMs - b.activityMs)
const idle = sessions.filter((s) => now - s.activityMs >= cutoffMs)
const fresh = sessions.filter((s) => now - s.activityMs < cutoffMs)
const fmt = (ms) => {
  const age = now - ms
  if (age < 3_600_000) return Math.round(age / 60000) + ' min ago'
  if (age < 86_400_000) return Math.round(age / 3_600_000) + ' h ago'
  return Math.round(age / 86_400_000) + ' d ago'
}
console.log('sessions root :', sessionsRoot)
console.log('threshold     : idle >= ' + value + ' ' + unit)
console.log('scan interval : ' + intervalMinutes + ' min')
console.log('rule          : idle >= max(threshold, interval) = ' + Math.round(effectiveMs / 60000) + ' min')
console.log('cutoff        : ' + new Date(now - cutoffMs).toISOString())
console.log('found         :', sessions.length, 'durable session(s)')
console.log('')
console.log('— WOULD ARCHIVE (' + idle.length + ') —')
for (const s of idle) console.log('  ' + s.workspace + '/' + s.id + '  (last activity ' + fmt(s.activityMs) + ')')
console.log('')
console.log('— still recent (' + fresh.length + ') —')
for (const s of fresh) console.log('  ' + s.workspace + '/' + s.id + '  (last activity ' + fmt(s.activityMs) + ')')
console.log('')
console.log('Dry run only — nothing was archived.')
