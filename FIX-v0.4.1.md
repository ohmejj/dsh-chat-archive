# dsh-chat-archive v0.4.1 修复说明

## 问题描述

插件在 dsh@0.1.5-rc.1 上无法加载，错误信息：
```
The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
```

## 根本原因

`@deepseek-ai/dsh-settings@0.1.5-rc.2` 重构了 API：
- **移除**：独立函数 `installSettingsSection()` 和 `settingsNamespace()`
- **新增**：实例方法 `ctx.settings.installSection()`

这是 dsh 从 0.1.1-rc.2 到 0.1.5-rc.1 的 **破坏性变更**。

## 修复内容

### 1. 更新 API 调用（`src/archiver.ts`）

**旧代码：**
```typescript
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

// 在 start() 中
installSettingsSection<ChatArchiveConfig>(
  this.ctx as never,
  settingsNamespace(SETTINGS_NAMESPACE),
  configSchema as never,
  DEFAULT_CONFIG as ChatArchiveConfig,
  { ... }
)
```

**新代码：**
```typescript
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'

// 在 start() 中
this.ctx.settings.installSection(
  this.ctx as never,
  SETTINGS_NAMESPACE,
  configSchema as never,
  DEFAULT_CONFIG,
  { ... }
)
```

### 2. 添加 settings 服务依赖

**`src/archiver.ts` - RunnerServices 接口：**
```typescript
export interface RunnerServices {
  // ... 其他服务
  settings: SettingsProvider  // 新增
  // ...
}
```

**`src/index.ts` - inject 声明：**
```typescript
export const inject = ['sessionPersistence', 'workspaceRegistry', 'sessions', 'settings']
//                                                                            ^^^^^^^^^ 新增
```

### 3. 更新 peerDependencies 版本（`package.json`）

```json
"peerDependencies": {
  "@deepseek-ai/dsh-session": "^0.1.5-rc.1",
  "@deepseek-ai/dsh-session-persistence": "^0.1.5-rc.1",
  "@deepseek-ai/dsh-settings": "^0.1.5-rc.2",
  "@deepseek-ai/dsh-workspace": "^0.1.5-rc.1"
}
```

## API 变更对比

| 旧 API (0.1.1-rc.2) | 新 API (0.1.5-rc.2) |
|---------------------|---------------------|
| `installSettingsSection(ctx, ns, schema, entry, hooks)` | `ctx.settings.installSection(ctx, ns, schema, entry, hooks)` |
| `settingsNamespace(name)` | 直接传字符串 `name` |
| 独立导入的函数 | 服务实例方法 |

## 验证

编译成功：
```bash
npm run build
# ✓ 编译通过，无 TypeScript 错误
```

运行测试（如有）：
```bash
npm test
```

## 兼容性

- **dsh@0.1.5-rc.1+**：✅ 兼容
- **dsh@0.1.1-rc.2 及更早**：❌ 不兼容（需使用 v0.4.0 及之前版本）

## 相关链接

- [dsh skill - plugin incompatibility reference](~/.hermes/skills/software-development/dsh/references/plugin-incompatibility.md)
- dsh-settings API 变更：移除独立函数，改为服务实例方法
