import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIG, thresholdMs, effectiveIdleMs, validateConfig } from '../dist/index.js'
import { decideArchivable } from '../dist/index.js'

const day = 86_400_000

test('thresholdMs converts minutes, hours and days', () => {
  assert.equal(thresholdMs({ unit: 'minutes', threshold: 5 }), 5 * 60_000)
  assert.equal(thresholdMs({ unit: 'hours', threshold: 72 }), 72 * 3_600_000)
  assert.equal(thresholdMs({ unit: 'days', threshold: 7 }), 7 * day)
  assert.equal(thresholdMs({ unit: 'minutes', threshold: 1 }), 60_000)
})

test('effectiveIdleMs requires idle across a full scan interval too', () => {
  const base = { enabled: true, unit: 'minutes', threshold: 5, intervalMinutes: 30, runNowTick: 0 }
  // interval (30 min) > threshold (5 min) → the interval becomes the floor.
  assert.equal(effectiveIdleMs(base), 30 * 60_000)
  // threshold (72 h) > interval (30 min) → threshold governs.
  assert.equal(effectiveIdleMs({ ...base, unit: 'hours', threshold: 72 }), 72 * 3_600_000)
  // threshold (30 min) > interval (5 min) → threshold governs.
  assert.equal(effectiveIdleMs({ ...base, intervalMinutes: 5, threshold: 30 }), 30 * 60_000)
})

test('default config is valid and safe (archiving off)', () => {
  assert.equal(DEFAULT_CONFIG.enabled, false)
  assert.doesNotThrow(() => validateConfig(DEFAULT_CONFIG))
})

test('validateConfig rejects bad values', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, unit: 'weeks' }))
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, threshold: 0 }))
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, threshold: 1.5 }))
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, intervalMinutes: 0 }))
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, intervalMinutes: 20000 }))
})

test('decideArchivable buckets candidates correctly', () => {
  const now = Date.now()
  const cutoff = now - 2 * day
  const sessions = [
    { id: 'old-1', activityMs: now - 10 * day },
    { id: 'fresh-1', activityMs: now - 1 * 3_600_000 },
    { id: 'live-1', activityMs: now - 30 * day },
    { id: 'gone-1', activityMs: undefined },
    { id: 'archived-1', activityMs: now - 30 * day },
  ]
  const decision = decideArchivable(
    sessions,
    new Set(['archived-1']),
    new Set(['live-1']),
    cutoff,
  )
  assert.deepEqual(decision.selected, ['old-1'])
  assert.deepEqual(decision.recent, ['fresh-1'])
  assert.deepEqual(decision.live, ['live-1'])
  assert.deepEqual(decision.undeterminable, ['gone-1'])
  assert.deepEqual(decision.alreadyArchived, ['archived-1'])
})

test('decideArchivable is idempotent for archived ids', () => {
  const now = Date.now()
  const cutoff = now - day
  const sessions = [{ id: 'x', activityMs: now - 5 * day }]
  const first = decideArchivable(sessions, new Set(), new Set(), cutoff)
  const second = decideArchivable(first.selected.map((id) => ({ id, activityMs: now - 5 * day })), new Set(first.selected), new Set(), cutoff)
  assert.equal(first.selected.length, 1)
  assert.equal(second.selected.length, 0)
  assert.equal(second.alreadyArchived.length, 1)
})