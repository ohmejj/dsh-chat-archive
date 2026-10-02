/**
 * Host runner of the chat-archive plugin.
 *
 * Wires two things together:
 *  1. a resolved configuration source (provided by the plugin entry, which
 *     reads it from the profile row's `config:` via cordis's `apply(ctx,
 *     config)` — the 0.2.0-native settings model);
 *  2. a periodic scan over durable sessions (idle > threshold → archive via
 *     the workspace registry — DSH's native, reversible archive set);
 *  3. an immediate scan when the configuration's `runNowTick` has been bumped
 *     (the card's “Archive now” writes a higher tick through the generic
 *     SettingsForms writer, which re-runs the plugin with the new config).
 *
 * Only NON-live sessions are ever archived, and only sessions the workspace
 * registry does not already hold in its archive set — so this is idempotent
 * and never hides a conversation that is currently running.
 */
import { stat } from 'node:fs/promises'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { type ChatArchiveConfig, DEFAULT_CONFIG, effectiveIdleMs } from './config.js'
import { decideArchivable, type SessionActivity } from './scan.js'

/** Structural slice of the Host context this runner needs. */
export interface RunnerServices {
  sessionPersistence: {
    list(signal?: AbortSignal): Promise<readonly { header: SessionHeader; revision: unknown; sizeBytes?: number }[]>
    locate(meta: SessionHeader): { kind: string; path: string } | undefined
  }
  workspaceRegistry: {
    readonly archivedSessionIds: readonly SessionId[]
    archiveSession(sessionId: SessionId): Promise<void>
  }
  sessions: {
    get(sessionId: SessionId): unknown
  }
  webServer?: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void | Promise<void>
    }): () => void
  }
  effect<T>(fn: (() => T | void), label?: string): T | void
  on<K extends string>(event: K, listener: (...args: any[]) => void): () => void
}

/** One scan attempt's outcome (what was archived + why others were skipped). */
export interface ScanOutcome {
  trigger: string
  archived: unknown[]
  recent: unknown[]
  undeterminable: unknown[]
  live: unknown[]
}

const MS = 1000
const INITIAL_SCAN_DELAY_MS = 3 * MS

/**
 * Expand a located session path into the set of on-disk artifact variants the
 * DSH session store may actually use. The store has changed backends across
 * versions (`.jsonl`, `.v3.jsonl`, `.v4.jsonl`, and current zstd-compressed
 * `.jsonl.zstd` / `.v3.jsonl.zstd` / `.v4.jsonl.zstd`), and `locate` may point
 * at a path the on-disk file doesn't match exactly. We try the primary then
 * each plausible variant so a renamed/compressed artifact still yields its
 * mtime (the real activity signal).
 */
function candidates(path: string): string[] {
  const out = new Set<string>([path])
  // strip compression and version to get a bare fragment, then re-add variants
  const bare = path.replace(/\.v\d+\.jsonl(\.zstd)?$/, '').replace(/\.jsonl(\.zstd)?$/, '')
  if (bare !== path) {
    for (const suffix of ['.jsonl', '.v3.jsonl', '.v4.jsonl', '.jsonl.zstd', '.v3.jsonl.zstd', '.v4.jsonl.zstd']) {
      out.add(bare + suffix)
    }
  }
  return Array.from(out)
}

/** Return the mtime of the first existing candidate, else undefined. */
async function statOneOf(paths: string[]): Promise<number | undefined> {
  let lastError: unknown
  for (const p of paths) {
    try {
      const info = await stat(p)
      return info.mtimeMs
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        lastError = error
        continue
      }
      throw error
    }
  }
  // All variants missing: inspect the containing dir to avoid spurious errors
  // if the session simply has no artifact yet (fresh) — treated as "no mtime".
  void lastError
  return undefined
}

/** Human summary for logs. */
function summary(outcome: ScanOutcome): string {
  const parts = [`archived=${outcome.archived.length}`, `recent=${outcome.recent.length}`, `unknown=${outcome.undeterminable.length}`, `live=${outcome.live.length}`]
  return `[${outcome.trigger}] ${parts.join(' ')}`
}

export class ChatArchiveRunner {
  private source: () => ChatArchiveConfig | undefined = () => undefined
  private interval: ReturnType<typeof setInterval> | null = null
  private initialTimer: ReturnType<typeof setTimeout> | null = null
  private scanning = false
  private disposed = false
  private lastRunNowTick = DEFAULT_CONFIG.runNowTick

  constructor(
    private readonly ctx: RunnerServices,
    private readonly log: (message: string) => void,
  ) {
    this.ctx.effect(() => () => this.dispose(), 'chat-archive: runner disposal')
  }

  /** Current authoritative configuration (provided by the plugin entry). */
  current(): ChatArchiveConfig {
    const resolved = this.source() ?? DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...resolved }
  }

  /**
   * Feed the resolved configuration. Called by the plugin entry on every
   * `apply(ctx, config)` — i.e. on boot and on every committed config edit —
   * so a `runNowTick` bump (the card's “Archive now”) triggers one scan.
   */
  setConfig(config: ChatArchiveConfig): void {
    this.source = () => config
    const manual = config.runNowTick > this.lastRunNowTick
    this.lastRunNowTick = Math.max(this.lastRunNowTick, config.runNowTick)
    if (this.disposed) return
    this.rearm(config)
    void this.runScan(manual ? 'manual' : 'config-change')
  }

  /** Mount everything: initial scan (on boot config is set before start). */
  start(): void {
    // Catch up on inactivity that accumulated while this profile was down.
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      void this.runScan('boot')
    }, INITIAL_SCAN_DELAY_MS)
  }

  /** (Re)arm the periodic scanner to the current interval. */
  private rearm(config: ChatArchiveConfig): void {
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (!config.enabled || !Number.isFinite(config.intervalMinutes)) return
    const delayMs = Math.max(1, Math.round(config.intervalMinutes)) * 60 * MS
    this.interval = setInterval(() => {
      void this.runScan('interval')
    }, delayMs)
  }

  /** One full scan: list → stat → decide → archive. */
  async runScan(trigger: string): Promise<ScanOutcome | null> {
    const config = this.current()
    if (!config.enabled) {
      this.log('chat-archive: archiver disabled — skipping scan')
      return null
    }
    if (this.scanning) return null
    this.scanning = true
    try {
      const now = Date.now()
      // idle ≥ max(threshold, one full scan interval): never archive a session
      // that conversed during the most recent interval.
      const cutoff = now - effectiveIdleMs(config)
      const archivedIds = new Set<unknown>(this.ctx.workspaceRegistry.archivedSessionIds)
      const snapshots = await this.ctx.sessionPersistence.list()
      if (this.disposed) return null
      const activities: SessionActivity[] = []
      const liveIds = new Set<unknown>()
      const liveList: unknown[] = []
      for (const snapshot of snapshots) {
        const header = snapshot.header
        if (archivedIds.has(header.id)) continue
        if (this.ctx.sessions.get(header.id) !== undefined) {
          liveIds.add(header.id)
          liveList.push(header.id)
          continue
        }
        activities.push({ id: header.id, activityMs: await this.lastActivityMs(header) })
      }
      const decision = decideArchivable(activities, archivedIds, liveIds, cutoff)
      for (const id of decision.selected) {
        if (this.disposed) break
        try {
          await this.ctx.workspaceRegistry.archiveSession(id as SessionId)
        } catch (error) {
          console.error(`chat-archive: archiveSession failed for ${String(id)}:`, error)
          this.log(`chat-archive: archiveSession failed for ${String(id)}: ${String(error)}`)
        }
      }
      const outcome: ScanOutcome = {
        trigger,
        archived: decision.selected,
        recent: decision.recent,
        undeterminable: decision.undeterminable,
        live: liveList,
      }
      this.log(`chat-archive: ${summary(outcome)}${decision.selected.length > 0 ? ` (${decision.selected.join(', ')})` : ''}`)
      return outcome
    } catch (error) {
      this.log(`chat-archive: scan failed: ${String(error)}`)
      return null
    } finally {
      this.scanning = false
    }
  }

  /** Last durable activity of one session = mtime of its backend artifact. */
  private async lastActivityMs(header: SessionHeader): Promise<number | undefined> {
    try {
      const location = this.ctx.sessionPersistence.locate(header)
      if (location === undefined) return undefined
      return await statOneOf(candidates(location.path))
    } catch (error) {
      console.error(`chat-archive: failed to get mtime for session ${String(header.id)}:`, error)
      return undefined
    }
  }

  /** Stop timers; safe to call more than once. */
  dispose(): void {
    this.disposed = true
    if (this.interval !== null) {
      clearInterval(this.interval)
      this.interval = null
    }
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer)
      this.initialTimer = null
    }
  }
}