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
 */
import { stat } from 'node:fs/promises'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { type ChatArchiveConfig, DEFAULT_CONFIG, SETTINGS_NAMESPACE, configSchema, effectiveIdleMs, validateConfig } from './config.js'
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
  settings: SettingsProvider
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

  /** Current authoritative configuration (settings section when attached). */
  current(): ChatArchiveConfig {
    const resolved = this.source() ?? DEFAULT_CONFIG
    return { ...DEFAULT_CONFIG, ...resolved }
  }

  /** Mount everything: settings namespace + initial scan. */
  start(): void {
    console.log('chat-archive: start() called')
    try {
      console.log('chat-archive: calling installSection...')
      this.ctx.settings.installSection(
        this.ctx as never,
        SETTINGS_NAMESPACE,
        configSchema as never,
        DEFAULT_CONFIG,
        {
          validate: validateConfig,
          setSource: (next: () => ChatArchiveConfig) => {
            console.log('chat-archive: setSource called')
            this.source = next
          },
          onChange: () => {
            console.log('chat-archive: onChange triggered')
            if (this.disposed) return
            const config = this.current()
            this.rearm(config)
            // A bumped runNowTick is the card's explicit “Archive now”.
            const manual = config.runNowTick > this.lastRunNowTick
            if (manual) this.lastRunNowTick = config.runNowTick
            console.log(`chat-archive: scheduling scan (trigger: ${manual ? 'manual' : 'config-change'})`)
            void this.runScan(manual ? 'manual' : 'config-change')
          },
        },
      )
      console.log('chat-archive: installSection completed')
      this.log('chat-archive: settings section registered; archiver started')
    } catch (error) {
      console.error('chat-archive: installSection failed:', error)
      this.log(`chat-archive: failed to register settings section: ${String(error)}`)
    }
    // Catch up on inactivity that accumulated while this profile was down.
    console.log('chat-archive: scheduling initial scan')
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null
      console.log('chat-archive: running initial boot scan')
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
    console.log(`chat-archive: runScan called (trigger: ${trigger})`)
    const config = this.current()
    console.log(`chat-archive: config - enabled: ${config.enabled}, threshold: ${config.threshold} ${config.unit}`)
    if (!config.enabled) {
      this.log('chat-archive: archiver disabled — skipping scan')
      console.log('chat-archive: archiver disabled — skipping scan')
      return null
    }
    if (this.scanning) {
      console.log('chat-archive: scan already in progress — skipping')
      return null
    }
    this.scanning = true
    console.log('chat-archive: starting scan execution...')
    try {
      const now = Date.now()
      // idle ≥ max(threshold, one full scan interval): never archive a session
      // that conversed during the most recent interval.
      const cutoff = now - effectiveIdleMs(config)
      console.log(`chat-archive: cutoff time: ${new Date(cutoff).toISOString()}`)
      const archivedIds = new Set<unknown>(this.ctx.workspaceRegistry.archivedSessionIds)
      console.log(`chat-archive: fetching session list...`)
      const snapshots = await this.ctx.sessionPersistence.list()
      console.log(`chat-archive: found ${snapshots.length} total sessions`)
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
      console.log(`chat-archive: ${activities.length} sessions to evaluate, ${liveList.length} live sessions`)
      const decision = decideArchivable(activities, archivedIds, liveIds, cutoff)
      console.log(`chat-archive: decision - ${decision.selected.length} to archive, ${decision.recent.length} recent, ${decision.undeterminable.length} undeterminable`)
      for (const id of decision.selected) {
        if (this.disposed) break
        try {
          console.log(`chat-archive: archiving session ${String(id)}`)
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
      console.log(`chat-archive: scan completed - ${summary(outcome)}`)
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
      if (location === undefined) {
        console.log(`chat-archive: locate returned undefined for session ${String(header.id)}`)
        return undefined
      }
      console.log(`chat-archive: checking mtime for ${location.path}`)
      
      // 尝试读取文件 mtime
      try {
        const info = await stat(location.path)
        console.log(`chat-archive: session ${String(header.id)} mtime: ${new Date(info.mtimeMs).toISOString()}`)
        return info.mtimeMs
      } catch (error: any) {
        // 如果文件不存在且路径包含 .v3.jsonl，尝试回退到旧格式 .jsonl
        if (error?.code === 'ENOENT' && location.path.includes('.v3.jsonl')) {
          const fallbackPath = location.path.replace('.v3.jsonl', '.jsonl')
          console.log(`chat-archive: trying fallback path: ${fallbackPath}`)
          try {
            const info = await stat(fallbackPath)
            console.log(`chat-archive: session ${String(header.id)} mtime (fallback): ${new Date(info.mtimeMs).toISOString()}`)
            return info.mtimeMs
          } catch (fallbackError: any) {
            console.error(`chat-archive: fallback also failed for session ${String(header.id)}:`, fallbackError)
            return undefined
          }
        }
        throw error
      }
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