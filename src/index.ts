/**
 * dsh-chat-archive — automatic conversation archiving for DeepSeek Harness.
 *
 * Host half entry. Loaded by a profile layer row (see cordis.patch.yml); the
 * browser half (./client) is served from the same loader entry so Settings →
 * Plugins renders the configuration card.
 */
import type { Context } from '@deepseek-ai/cordis'
import { ChatArchiveRunner, type RunnerServices } from './archiver.js'

export const name = '@ohmejj/dsh-chat-archive'
export const description = '自动归档超过闲置阈值的 DSH 会话（对话自动归档）'

/** Services the runner needs; the loader waits for all of them before apply. */
export const inject = ['sessionPersistence', 'workspaceRegistry', 'sessions', 'settings']

/** Plugin entry: wire the archiver into this profile's Host. */
export function apply(ctx: Context): void {
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
  console.log('chat-archive: apply() called, starting runner...')
  log('chat-archive: apply() called, starting runner...')
  try {
    new ChatArchiveRunner(ctx as unknown as RunnerServices, log).start()
    console.log('chat-archive: runner started successfully')
  } catch (error) {
    console.error('chat-archive: runner failed to start:', error)
    log(`chat-archive: runner failed to start: ${String(error)}`)
  }
}

export { SETTINGS_NAMESPACE, DEFAULT_CONFIG, type ChatArchiveConfig, type ArchiveUnit, thresholdMs, effectiveIdleMs, validateConfig, UNIT_LABELS } from './config.js'
export { decideArchivable, type SessionActivity, type ScanDecision } from './scan.js'