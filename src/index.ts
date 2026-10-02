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

/**
 * Plugin entry: keep a single runner across re-applies (config edits re-run
 * this with a new `config`), routing each resolved config into its
 * `setConfig`, and register the config JSON route once.
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
  const holder = ctx as { chatArchiveRunner?: ChatArchiveRunner; chatArchiveRouteDone?: boolean }
  const rootCtx = (ctx as { root?: Context }).root ?? ctx
  // cordis already resolved & validated `Config` before calling apply; treat it
  // as the authoritative resolved config.
  const resolved = ((userConfig ?? {}) as Partial<ChatArchiveConfig>) as ChatArchiveConfig

  try {
    if (holder.chatArchiveRunner === undefined) {
      const runner = new ChatArchiveRunner(ctx as unknown as RunnerServices, log)
      holder.chatArchiveRunner = runner
      runner.setConfig(resolved)
      runner.start()
      log('chat-archive: runner started')
    } else {
      holder.chatArchiveRunner.setConfig(resolved)
    }
  } catch (error) {
    console.error('chat-archive: runner failed to start:', error)
    log(`chat-archive: runner failed to start: ${String(error)}`)
  }

  // Register the config JSON route exactly once (apply re-runs on every edit).
  if (holder.chatArchiveRouteDone !== true) {
    const webServer = (ctx as { webServer?: RunnerServices['webServer'] }).webServer
    if (webServer !== undefined) {
      try {
        const disposer = webServer.register({
          kind: 'exact',
          path: CONFIG_ROUTE,
          handler: (req, res) => {
            void handleConfigRoute(holder, req as import('node:http').IncomingMessage, res, rootCtx, log)
          },
        })
        holder.chatArchiveRouteDone = true
        if (typeof disposer === 'function') {
          ctx.effect(() => disposer, 'chat-archive: config route disposal')
        }
        log(`chat-archive: config route ${CONFIG_ROUTE} registered`)
      } catch (error) {
        console.error('chat-archive: failed to register config route:', error)
      }
    }
  }
}

/** Route handler: GET returns the current config, POST persists a new one. */
async function handleConfigRoute(
  holder: { chatArchiveRunner?: ChatArchiveRunner },
  req: import('node:http').IncomingMessage,
  res: ServerResponse,
  rootCtx: Context,
  log: (message: string) => void,
): Promise<void> {
  const runner = holder.chatArchiveRunner
  const method = req.method ?? 'GET'
  try {
    if (method === 'GET') {
      const config = runner !== undefined ? runner.current() : { ...DEFAULT_CONFIG }
      sendJson(res, 200, config)
      return
    }
    if (method === 'POST') {
      if (runner === undefined) {
        sendJson(res, 500, { error: 'runner not ready' })
        return
      }
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