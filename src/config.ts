/**
 * Configuration model of the chat-archive plugin.
 *
 * The whole user-tunable surface lives in ONE settings namespace
 * (`chat-archive`), persisted by the DSH settings service (settings.yaml on
 * the Host). The Host archiver reads the resolved section, and the browser
 * Settings section edits exactly these fields.
 */
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this plugin (branded by dsh-settings). */
export const SETTINGS_NAMESPACE = 'chat-archive'

/** Time unit chosen by the user for the idle threshold. */
export type ArchiveUnit = 'minutes' | 'hours' | 'days'

/** Complete resolved configuration of the archiver. */
export interface ChatArchiveConfig {
  /** Master switch: no scan runs while disabled. */
  enabled: boolean
  /** Unit of {@link threshold}. */
  unit: ArchiveUnit
  /** A conversation idle for at least this many {@link unit}s is archived. */
  threshold: number
  /** How often the host re-scans durable sessions, in minutes. */
  intervalMinutes: number
  /**
   * Written by the section's “Archive now” button; the Host treats any
   * increase as a request to run one scan immediately.
   */
  runNowTick: number
}

/** Safe built-in defaults — archiving is OFF until the user turns it on. */
export const DEFAULT_CONFIG: Readonly<ChatArchiveConfig> = Object.freeze({
  enabled: false,
  unit: 'hours',
  threshold: 72,
  intervalMinutes: 30,
  runNowTick: 0,
})

/** Millisecond length of one {@link ArchiveUnit}. */
const UNIT_MS: Record<ArchiveUnit, number> = Object.freeze({
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
})

/** Human label of one unit, used by the settings schema description. */
export const UNIT_LABELS: Record<ArchiveUnit, string> = Object.freeze({
  minutes: '分钟 (minutes)',
  hours: '小时 (hours)',
  days: '天 (days)',
})

/** Schema resolving the namespace (schemastery). */
export const configSchema = z.object({
  enabled: z.boolean().default(false).description('启用自动归档'),
  unit: z.union([z.const('minutes'), z.const('hours'), z.const('days')]).default('hours'),
  threshold: z.number().step(1).min(1).default(72).description('闲置阈值'),
  intervalMinutes: z.number().step(1).min(1).max(10080).default(30).description('扫描间隔（分钟）'),
  runNowTick: z.number().step(1).min(0).default(0).hidden(),
})

/** Idle duration that triggers archiving, in milliseconds. */
export function thresholdMs(config: Pick<ChatArchiveConfig, 'unit' | 'threshold'>): number {
  return config.threshold * UNIT_MS[config.unit]
}

/**
 * The effective idle requirement of one scan pass.
 *
 * A session may only be archived when it has been idle for at least
 * `thresholdMs` AND has had NO conversation during a full scan interval —
 * i.e. idle for at least `max(threshold, interval)`. When the interval is the
 * larger value (e.g. threshold 5 minutes with a 30-minute interval) the
 * interval becomes the real floor, so a conversation that happened within the
 * last interval is never archived by the scan that follows it.
 */
export function effectiveIdleMs(config: ChatArchiveConfig): number {
  const intervalMs = Math.max(1, Math.round(config.intervalMinutes)) * 60_000
  return Math.max(thresholdMs(config), intervalMs)
}

/**
 * Validate a resolved section. The schema already constrains ranges; this
 * hook exists for constraints no schema expresses and to give the Host a
 * single rejection point (a bad value blocks the write before persisting).
 */
export function validateConfig(config: ChatArchiveConfig): void {
  if (!Object.prototype.hasOwnProperty.call(UNIT_MS, config.unit)) {
    throw new Error(`chat-archive: unit must be one of minutes/hours/days, got ${JSON.stringify(config.unit)}`)
  }
  if (!Number.isInteger(config.threshold) || config.threshold < 1) {
    throw new Error(`chat-archive: threshold must be a positive integer, got ${JSON.stringify(config.threshold)}`)
  }
  if (!Number.isInteger(config.intervalMinutes) || config.intervalMinutes < 1 || config.intervalMinutes > 10080) {
    throw new Error(`chat-archive: intervalMinutes must be an integer in [1, 10080], got ${JSON.stringify(config.intervalMinutes)}`)
  }
}
