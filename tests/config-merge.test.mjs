import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChatArchiveRunner } from '../dist/archiver.js'
import { DEFAULT_CONFIG } from '../dist/index.js'

test('current() merges partial config with defaults', () => {
  const mockCtx = {
    sessionPersistence: { list: async () => [] },
    workspaceRegistry: { archivedSessionIds: [], archiveSession: async () => {} },
    sessions: { get: () => undefined },
    settings: { installSection: () => {} },
    effect: () => {}
  }
  
  const runner = new ChatArchiveRunner(mockCtx, () => {})
  
  // 模拟 settings 只返回部分字段（就像 settings.yaml 的情况）
  runner['source'] = () => ({
    enabled: true,
    threshold: 48,
    runNowTick: 17,
    // 缺少 unit 和 intervalMinutes
  })
  
  const config = runner.current()
  
  // 验证返回的配置包含所有必需字段
  assert.equal(config.enabled, true, 'enabled should be from settings')
  assert.equal(config.threshold, 48, 'threshold should be from settings')
  assert.equal(config.runNowTick, 17, 'runNowTick should be from settings')
  assert.equal(config.unit, 'hours', 'unit should be from DEFAULT_CONFIG')
  assert.equal(config.intervalMinutes, 30, 'intervalMinutes should be from DEFAULT_CONFIG')
})

test('current() handles completely missing config', () => {
  const mockCtx = {
    sessionPersistence: { list: async () => [] },
    workspaceRegistry: { archivedSessionIds: [], archiveSession: async () => {} },
    sessions: { get: () => undefined },
    settings: { installSection: () => {} },
    effect: () => {}
  }
  
  const runner = new ChatArchiveRunner(mockCtx, () => {})
  // source 返回 undefined（插件未初始化）
  runner['source'] = () => undefined
  
  const config = runner.current()
  
  // 应该返回完整的 DEFAULT_CONFIG
  assert.deepEqual(config, DEFAULT_CONFIG)
})
