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
 * Sessions crossing the threshold are archived even if live. DSH's native
 * `stopActivity` mode writes the reversible archive marker first, then stops
 * any in-flight work so it cannot resume after archival.
 */
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { type ChatArchiveConfig, DEFAULT_CONFIG, effectiveIdleMs } from './config.js'
import { decideArchivable, type SessionActivity } from './scan.js'

/** Structural slice of the Host context this runner needs. */
export interface RunnerServices {
  sessionPersistence: {
    list(signal?: AbortSignal): Promise<readonly { header: SessionHeader; revision: unknown; sizeBytes?: number }[]>
    open(sessionId: SessionId, mode: 'read'): Promise<{
      read(): Promise<{ events: readonly { type: string; time: number }[] }>
      close(): Promise<void>
    }>
  }
  workspaceRegistry: {
    readonly archivedSessionIds: readonly SessionId[]
    archiveSession(sessionId: SessionId, options?: { stopActivity?: boolean }): Promise<void>
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

/** Read-only progress state for the manual-scan endpoint and diagnostics. */
export interface ScanStatus {
  scanning: boolean
  phase: 'idle' | 'listing' | 'classifying' | 'archiving' | 'complete' | 'failed'
  currentSessionId?: string
  lastError?: string
  lastOutcome?: ScanOutcome
}

const MS = 1000
const INITIAL_SCAN_DELAY_MS = 3 * MS

/** DSH lifecycle records that can be appended by resume/recovery without a conversation. */
const NON_CONVERSATIONAL_EVENTS = new Set(['session/end-seed'])

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
  private scanStatus: ScanStatus = { scanning: false, phase: 'idle' }

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

  /** Snapshot of the active or most recently completed scan. */
  status(): ScanStatus {
    return {
      ...this.scanStatus,
      ...this.scanStatus.lastOutcome === undefined ? {} : { lastOutcome: this.scanStatus.lastOutcome },
    }
  }

  /**
   * Feed the resolved configuration. Called by the plugin entry on every
   * `apply(ctx, config)` — i.e. on boot and on every committed config edit —
   * so a `runNowTick` bump (the card's “Archive now”) triggers one scan.
   */
  setConfig(config: ChatArchiveConfig, manual = false): void {
    this.source = () => config
    if (this.disposed) return
    this.rearm(config)
    void this.runScan(manual ? 'manual' : 'config-change', { allowWhenDisabled: manual })
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
  async runScan(trigger: string, options: { allowWhenDisabled?: boolean } = {}): Promise<ScanOutcome | null> {
    const config = this.current()
    if (!config.enabled && !options.allowWhenDisabled) {
      this.log('chat-archive: archiver disabled — skipping scan')
      return null
    }
    if (this.scanning) return null
    this.scanning = true
    this.scanStatus = { scanning: true, phase: 'listing' }
    try {
      const now = Date.now()
      // idle ≥ max(threshold, one full scan interval): never archive a session
      // that conversed during the most recent interval.
      const cutoff = now - effectiveIdleMs(config)
      const archivedIds = new Set<unknown>(this.ctx.workspaceRegistry.archivedSessionIds)
      const snapshots = await this.ctx.sessionPersistence.list()
      if (this.disposed) return null
      this.scanStatus = { ...this.scanStatus, phase: 'classifying' }
      const activities: SessionActivity[] = []
      const liveIds = new Set<unknown>()
      const liveList: unknown[] = []
      for (const snapshot of snapshots) {
        const header = snapshot.header
        if (archivedIds.has(header.id)) continue
        if (this.ctx.sessions.get(header.id) !== undefined) {
          liveIds.add(header.id)
          liveList.push(header.id)
        }
        activities.push({ id: header.id, activityMs: await this.lastActivityMs(header) })
      }
      // Do not exclude active sessions: selected live sessions use the
      // workspace registry's native archive-then-stop protocol below.
      const decision = decideArchivable(activities, archivedIds, new Set(), cutoff)
      for (const id of decision.selected) {
        if (this.disposed) break
        this.scanStatus = { ...this.scanStatus, phase: 'archiving', currentSessionId: String(id) }
        try {
          await this.ctx.workspaceRegistry.archiveSession(id as SessionId, liveIds.has(id) ? { stopActivity: true } : undefined)
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
      this.scanStatus = { scanning: false, phase: 'complete', lastOutcome: outcome }
      return outcome
    } catch (error) {
      const message = String(error)
      this.log(`chat-archive: scan failed: ${message}`)
      this.scanStatus = { scanning: false, phase: 'failed', lastError: message }
      return null
    } finally {
      this.scanning = false
      if (this.scanStatus.scanning) this.scanStatus = { ...this.scanStatus, scanning: false, phase: 'idle', currentSessionId: undefined }
    }
  }

  /**
   * Last activity is the newest durable conversation event, not the log file
   * mtime. DSH may append a `session/end-seed` recovery marker while reopening
   * a days-old conversation; using mtime would falsely make that conversation
   * look recent and prevent it from being archived.
   */
  private async lastActivityMs(header: SessionHeader): Promise<number | undefined> {
    let handle: Awaited<ReturnType<RunnerServices['sessionPersistence']['open']>> | undefined
    try {
      handle = await this.ctx.sessionPersistence.open(header.id, 'read')
      const { events } = await handle.read()
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (!NON_CONVERSATIONAL_EVENTS.has(event.type) && Number.isFinite(event.time)) return event.time
      }
      return header.createdAt
    } catch (error) {
      console.error(`chat-archive: failed to read activity for session ${String(header.id)}:`, error)
      return undefined
    } finally {
      try {
        await handle?.close()
      } catch (error) {
        console.error(`chat-archive: failed to close session reader for ${String(header.id)}:`, error)
      }
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
