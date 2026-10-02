/**
 * dsh-chat-archive — automatic conversation archiving for DeepSeek Harness.
 *
 * Host half entry. Loaded by a profile layer row (see cordis.patch.yml); the
 * browser half (./client) is served from the same loader entry so Settings →
 * Plugins renders the configuration card.
 *
 * 0.2.0-native settings model:
 *  - `Config` is the plugin's config schema. The Loader derives a settings
 *    form from it automatically.
 *  - chat-archive is mounted as a `- insert:` row, which the built-in
 *    SettingsForms does NOT surface for editing (that subsystem only serves
 *    Include-entry plugins). So this plugin exposes its own configuration
 *    card (see ./client) that reads/writes through a JSON route registered on
 *    the host's web server (see `webServer` below).
 *  - `apply(ctx, config)` is called by cordis with the resolved config on boot
 *    and again after every committed config edit (including after our own
 *    profile-patch write triggers a reconcile). We feed it to the runner so
 *    scan/archive reacts to changes (including the “Archive now” tick bump).
 */
import { type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { ChatArchiveRunner, type RunnerServices } from './archiver.js'
import { configSchema, DEFAULT_CONFIG, validateConfig, type ChatArchiveConfig } from './config.js'
import { writeConfigToProfile } from './patch.js'

export const name = '@ohmejj/dsh-chat-archive'
export const description = '自动归档超过闲置阈值的 DSH 会话（对话自动归档）'

/** Config schema — cordis resolves & validates against this before apply. */
export const Config = configSchema

/** Services the runner & web route need. */
export const inject = ['sessionPersistence', 'workspaceRegistry', 'sessions', 'webServer']

/** Host JSON route the client card uses to read/write this plugin's config. */
export const CONFIG_ROUTE = '/api/plugins/chat-archive/config'
/** Direct manual-scan route. Unlike a config write, this does not rely on a
 * profile reconciliation before the scan can begin. */
export const RUN_ROUTE = '/api/plugins/chat-archive/run'
/** Read-only progress route used to diagnose a scan without starting another. */
export const STATUS_ROUTE = '/api/plugins/chat-archive/status'

/** Minimal JSON body reader. */
function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1_000_000) {
        reject(new Error('payload too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(data.length === 0 ? undefined : JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

/** Single small helper to send a JSON response. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

const runners = new WeakMap<object, ChatArchiveRunner>()
let lastObservedRunNowTick: number | undefined

/**
 * Plugin entry: each Cordis runtime context owns its runner and route. A
 * profile reconciliation disposes the old context before creating its
 * replacement, so module-scoped route/runner singletons would otherwise leave
 * the replacement with a disposed runner and no route.
 */
export function apply(ctx: Context, userConfig?: Partial<ChatArchiveConfig>): void {
  const logger = (ctx as { logger?: { info(message: string): void; warn(message: string): void } }).logger
  const log = (message: string): void => {
    if (logger !== undefined) {
      try {
        logger.info(message)
        return
      } catch {
        // fall through to console when the logger is not usable yet
      }
    }
    console.log(message)
  }
  const rootCtx = (ctx as { root?: Context }).root ?? ctx
  // cordis already resolved & validated `Config` before calling apply; treat it
  // as the authoritative resolved config.
  const resolved = { ...DEFAULT_CONFIG, ...(userConfig ?? {}) } as ChatArchiveConfig
  const manual = lastObservedRunNowTick !== undefined && resolved.runNowTick > lastObservedRunNowTick
  lastObservedRunNowTick = Math.max(lastObservedRunNowTick ?? resolved.runNowTick, resolved.runNowTick)

  let currentRunner = runners.get(ctx as unknown as object)
  try {
    if (currentRunner === undefined) {
      currentRunner = new ChatArchiveRunner(ctx as unknown as RunnerServices, log)
      runners.set(ctx as unknown as object, currentRunner)
      currentRunner.start()
      log('chat-archive: runner started')
    }
    currentRunner.setConfig(resolved, manual)
  } catch (error) {
    console.error('chat-archive: runner failed to start:', error)
    log(`chat-archive: runner failed to start: ${String(error)}`)
    return
  }

  // The route lifetime must match this runtime context.  It is registered
  // again after every profile reconciliation and automatically disposed with
  // the replaced context.
  const webServer = (ctx as { webServer?: RunnerServices['webServer'] }).webServer
  if (webServer !== undefined) {
    try {
      const configDisposer = webServer.register({
        kind: 'exact',
        path: CONFIG_ROUTE,
        handler: (req, res) => {
          void handleConfigRoute(req as import('node:http').IncomingMessage, res, rootCtx, currentRunner, log)
        },
      })
      const runDisposer = webServer.register({
        kind: 'exact',
        path: RUN_ROUTE,
        handler: (req, res) => {
          void handleRunRoute(req as import('node:http').IncomingMessage, res, currentRunner, log)
        },
      })
      const statusDisposer = webServer.register({
        kind: 'exact',
        path: STATUS_ROUTE,
        handler: (_req, res) => {
          sendJson(res, 200, currentRunner.status())
        },
      })
      ctx.effect(
        () => () => {
          statusDisposer()
          runDisposer()
          configDisposer()
        },
        'chat-archive: web route disposal',
      )
      log(`chat-archive: routes ${CONFIG_ROUTE}, ${RUN_ROUTE}, and ${STATUS_ROUTE} registered`)
    } catch (error) {
      console.error('chat-archive: failed to register config route:', error)
    }
  }
}

/** Route handler for the user-visible “Archive now” action. */
async function handleRunRoute(
  req: import('node:http').IncomingMessage,
  res: ServerResponse,
  runner: ChatArchiveRunner,
  log: (message: string) => void,
): Promise<void> {
  if ((req.method ?? 'POST') !== 'POST') {
    sendJson(res, 405, { error: `method ${req.method ?? 'POST'} not allowed` })
    return
  }
  try {
    const outcome = await runner.runScan('manual', { allowWhenDisabled: true })
    if (outcome === null) {
      sendJson(res, 409, { error: 'a scan is already running or the runner was stopped' })
      return
    }
    sendJson(res, 200, { ok: true, outcome })
  } catch (error) {
    console.error('chat-archive: manual scan route error:', error)
    log(`chat-archive: manual scan route error: ${String(error)}`)
    sendJson(res, 500, { error: String(error) })
  }
}

/** Route handler: GET returns the current config, POST persists a new one. */
async function handleConfigRoute(
  req: import('node:http').IncomingMessage,
  res: ServerResponse,
  rootCtx: Context,
  runner: ChatArchiveRunner,
  log: (message: string) => void,
): Promise<void> {
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET') {
      const config = runner.current()
      sendJson(res, 200, config)
      return
    }
    if (method === 'POST') {
      const body = (await readJsonBody(req)) as Partial<ChatArchiveConfig> | undefined
      if (body === undefined || typeof body !== 'object') {
        sendJson(res, 400, { error: 'expected a JSON config object' })
        return
      }
      const next: ChatArchiveConfig = { ...DEFAULT_CONFIG, ...body } as ChatArchiveConfig
      try {
        validateConfig(next)
      } catch (error) {
        sendJson(res, 400, { error: String(error) })
        return
      }
      // Write the override row + reconcile, which re-runs apply() with the new
      // config (the runner's setConfig then reacts, including a runNowTick bump).
      await writeConfigToProfile(rootCtx, next)
      sendJson(res, 200, { ok: true })
      return
    }
    sendJson(res, 405, { error: `method ${method} not allowed` })
  } catch (error) {
    console.error('chat-archive: config route error:', error)
    log(`chat-archive: config route error: ${String(error)}`)
    sendJson(res, 500, { error: String(error) })
  }
}

export { SETTINGS_NAMESPACE, DEFAULT_CONFIG, type ArchiveUnit, thresholdMs, effectiveIdleMs, validateConfig, UNIT_LABELS } from './config.js'
export { decideArchivable, type SessionActivity, type ScanDecision } from './scan.js'
