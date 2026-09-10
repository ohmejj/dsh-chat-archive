/**
 * Host runner of the chat-archive plugin.
 *
 * Wires three things together:
 *  1. the settings namespace (registering it makes the resolved section the
 *     authoritative configuration AND lets the browser card edit it);
 *  2. a periodic scan over durable sessions (idle > threshold → archive via
 *     the workspace registry — DSH's native, reversible archive set);
 *  3. immediate scans on every committed config change and on the card's
 *     “Archive now” request (a runNowTick bump).
 *
 * Only NON-live sessions are ever archived, and only sessions the workspace
 * registry does not already hold in its archive set — so this is idempotent
 * and never hides a conversation that is currently running.
 *
 * DSH >= 0.1.5 note: the durable session-persistence seam no longer exposes a
 * `locate()` that returns the backend artifact path, so idle time can no
 * longer be read via a service call. Instead we resolve the `session.jsonl.*`
 * artifact directly under the harness home (`$DSH_HOME/sessions/…`, by
 * default `~/.dsh/sessions/…`) with a per-scan tree walk keyed by session id,
 * then stat its mtime as the last-activity signal. Sessions whose artifact
 * cannot be found are treated as “undeterminable” and never archived.
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { type ChatArchiveConfig, DEFAULT_CONFIG, SETTINGS_NAMESPACE, configSchema, effectiveIdleMs, validateConfig } from './config.js'
import { decideArchivable, type SessionActivity } from './scan.js'

/** Structural slice of the Host context this runner needs. */
export interface RunnerServices {
  sessionPersistence: {
    list(signal?: AbortSignal): Promise<readonly { header: SessionHeader }[]>
  }
  workspaceRegistry: {
    readonly archivedSessionIds: readonly SessionId[]
    archiveSession(sessionId: SessionId): Promise<void>
  }
  sessions: {
    get(sessionId: SessionId): unknown
  }
  settings: {
    installSection<const Namespace extends string, T>(
      owner: unknown,
      ns: Namespace,
      schema: unknown,
      entry: T,
      hooks: {
        setSource(current: () => T): void
        onChange(): void
        validate?: (value: T) => void
      },
    ): void
  }
  effect<T>(fn: (() => T | void), label?: string): T | void
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
/** File name of a durable session log artifact (compressed or plain). */
const SESSION_LOG_FILE = 'session.jsonl'

/** Human summary for logs. */
function summary(outcome: ScanOutcome): string {
  const parts = [`archived=${outcome.archived.length}`, `recent=${outcome.recent.length}`, `unknown=${outcome.undeterminable.length}`, `live=${outcome.live.length}`]
  return `[${outcome.trigger}] ${parts.join(' ')}`
}

/** Root directory that contains per-workspace session directories. */
function sessionsRoot(): string {
  const configured = process.env.DSH_HOME
  const home = configured !== undefined && configured.trim().length > 0 ? configured.trim() : join(homedir(), '.dsh')
  return join(home, 'sessions')
}

/**
 * Walk the sessions tree once and index every durable log artifact by session
 * id. The per-session directory is either `<id>` or `session-<id>` (both
 * spellings appear across DSH versions), so the parent basename is normalized
 * by stripping a leading `session-` prefix.
 * @returns map from session id to its resolved artifact path.
 */
async function indexSessionLogs(root: string): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) continue
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue // missing or unreadable subtree — skip it
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name))
      } else if (entry.isFile() && entry.name.startsWith(SESSION_LOG_FILE)) {
        const id = normalizeSessionDirName(basename(dirname(join(current, entry.name))))
        if (id !== undefined && !index.has(id)) index.set(id, join(current, entry.name))
      }
    }
  }
  return index
}

/** Strip the optional `session-` prefix from a session directory's basename. */
function normalizeSessionDirName(name: string): string | undefined {
  const core = name.startsWith('session-') ? name.slice('session-'.length) : name
  return core.length > 0 ? core : undefined
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

  /** Current authoritative configuration (settings section when attached). */
  current(): ChatArchiveConfig {
    return this.source() ?? DEFAULT_CONFIG
  }

  /** Mount everything: settings namespace + initial scan. */
  start(): void {
    try {
      this.ctx.settings.installSection(
        this.ctx,
        SETTINGS_NAMESPACE,
        configSchema,
        DEFAULT_CONFIG,
        {
          validate: validateConfig,
          setSource: (next: () => ChatArchiveConfig) => {
            this.source = next
          },
          onChange: () => {
            if (this.disposed) return
            const config = this.current()
            this.rearm(config)
            // A bumped runNowTick is the card's explicit “Archive now”.
            const manual = config.runNowTick > this.lastRunNowTick
            if (manual) {
              this.lastRunNowTick = config.runNowTick
              void this.runScan('manual')
            }
            // Config changes don't trigger immediate scan; wait for next interval
          },
        },
      )
      this.log('chat-archive: settings section registered; archiver started')
    } catch (error) {
      this.log(`chat-archive: failed to register settings section: ${String(error)}`)
    }
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

  /** One full scan: list → locate → stat → decide → archive. */
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
      const indexed = await indexSessionLogs(sessionsRoot())
      if (this.disposed) return null
      const headers = await this.ctx.sessionPersistence.list()
      if (this.disposed) return null
      const activities: SessionActivity[] = []
      const liveIds = new Set<unknown>()
      const liveList: unknown[] = []
      for (const snapshot of headers) {
        const id = snapshot.header.id
        if (archivedIds.has(id)) continue
        if (this.ctx.sessions.get(id) !== undefined) {
          liveIds.add(id)
          liveList.push(id)
          continue
        }
        activities.push({ id, activityMs: await this.lastActivityMs(id, indexed) })
      }
      const decision = decideArchivable(activities, archivedIds, liveIds, cutoff)
      for (const id of decision.selected) {
        if (this.disposed) break
        try {
          await this.ctx.workspaceRegistry.archiveSession(id as SessionId)
        } catch (error) {
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
  private async lastActivityMs(id: SessionId, indexed: Map<string, string>): Promise<number | undefined> {
    const path = indexed.get(String(id))
    if (path === undefined) return undefined
    try {
      const info = await stat(path)
      return info.mtimeMs
    } catch {
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
