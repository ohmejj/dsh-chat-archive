# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.5] - 2026-10-03

### Fixed
- 🐛 **修复“立即归档”未实际处理会话**：改为由独立 Host 路由直接执行扫描，不再依赖配置重载时的 `runNowTick`；每个 Web 路由闭包绑定所属 Cordis 上下文的 runner，避免重载后请求落到已失效或错误的扫描器。
- 🐛 **修复立即归档与定时扫描忽略活跃会话**：超过阈值的活跃会话现在调用 DSH 原生 `archiveSession(..., { stopActivity: true })`，先持久化归档标记、再停止活动，避免停止操作唤醒会话后继续运行。
- 🐛 **修复恢复旧会话后被误判为“未到阈值”**：不再采用压缩日志文件 mtime；改为读取最后一条真实会话事件时间，并忽略 `session/end-seed` 等恢复生命周期记录。DSH 重启/恢复不会再重置闲置计时。
- 🐛 **修复配置保存的竞态失败**：配置页面以一次完整的原子 POST 保存所有字段，避免逐字段写入触发 profile reconcile 后使后续请求命中旧 runner。
- 🐛 **修复设置页与路由在 profile reconcile 后失效**：路由注册及释放与对应 Cordis 上下文绑定，确保配置保存、立即归档和状态读取在重载后持续可用。

### Changed
- ✨ **立即归档结果可观测**：设置页现在同时展示新归档数量、未达到阈值数量和活跃会话数量，避免将“已扫描但仍未超过阈值”误解为扫描失败。
- 📝 设置说明明确：闲置时间以最后一条真实会话事件计算；满足阈值的活跃会话会被停止并归档。

[0.5.5]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.5

## [0.5.4] - 2026-10-02

### Fixed
- 🐛 **修复设置界面卡片不渲染**：`dsh.client.inject` 里声明的 `@deepseek-ai/dsh-client-store` 不是 client 模块提供者，导致 client 依赖图无法满足、我们的 client.js 永不执行（设置面板出现"对话自动归档"导航项但卡片空白、无任何表单控件）。移除该依赖后 client.js 正常加载执行，卡片完整渲染。
- 🐛 **修复保存时 `Cannot read properties of undefined (reading 'length')`**：`yaml.load()` 传 `{ schema: 'default' }` 字符串参数导致 js-yaml 内部崩溃。去掉 schema 参数后保存正常，配置正确写入 profile patch。

[0.5.4]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.4

## [0.5.3] - 2026-10-02

### Fixed
- 🐛 **修复设置卡片空白与保存失败**：配置 schema 上所有字段的 `.volatile()` 会使 DSH 0.2.0 的 schemastery 把每个解析值包装成 `Volatile` 引用对象（`{enabled:{}}`），JSON 序列化后变成空对象——导致设置面板展示不出默认配置、保存时抛 `Cannot read properties of undefined (reading 'length')`。移除 volatile 包装，字段恢复为普通标量，GET 正常返回默认值、POST 正常写回 profile patch。

[0.5.3]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.3

## [0.5.2] - 2026-10-02

### Fixed
- 🐛 **修复 0.2.0 会话 mtime 检测**：DSH 0.2.0 会话存储使用 zstd 压缩（`.v3.jsonl.zstd` / `.v4.jsonl.zstd`），旧回退逻辑只能处理未压缩的 `.jsonl`/`.v3.jsonl`，导致这些会话无法判定空闲状态而被跳过归档。新增候选路径展开（自动匹配 `.jsonl`、`.vN.jsonl`、`.jsonl.zstd`、`.vN.jsonl.zstd` 变体），恢复对各会话格式的 mtime 检测。

[0.5.2]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.2

## [0.5.1] - 2026-10-02

### Fixed
- 🐛 **修复 cordis 运行时加载错误**：改用模块级状态（不再在 `ctx` 上挂自定义字段 `chatArchiveRunner`/`chatArchiveRouteDone`），修复 `Cannot get property "..." without inject` 导致插件无法激活的问题。

[0.5.1]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.1

## [0.5.0] - 2026-10-02

### Changed
- 🔼 **适配 DeepSeek Harness 0.2.0 运行时**（CLI / Desktop / Web）：peerDependencies 更新为 `^0.2.0-rc.2` 系列（dsh-session / dsh-session-persistence / dsh-settings / dsh-workspace）。
- 🧹 清理 0.4.x 遗留的调试 `console.log` 噪声，仅保留必要错误日志与功能汇总。

### Fixed
- 无（0.4.1 的行为保持不变，仅提升运行时兼容范围）。

[0.5.0]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.5.0

## [0.4.1] - 2026-09-14

### Changed
- 🔼 **适配 DeepSeek Harness 0.1.5**：peerDependencies 更新为 `^0.1.5-rc.x`（dsh-settings 提升至 `^0.1.5-rc.2`）。
- ⚙️ **设置命名空间注册改为 `ctx.settings.installSection(...)`**（0.1.5 移除了自由函数 `installSettingsSection`/`settingsNamespace`），并在插件 inject 列表中加入 `settings` 服务。
- 🎨 **客户端快照存储依赖迁移**：`@deepseek-ai/dsh-client-runtime`（已不再发布）→ `@deepseek-ai/dsh-client-store`，并同步更新 `dsh.client.inject`。

### Fixed
- 修复 settings.yaml 缺省 `unit`/`intervalMinutes` 字段时归档器无法启动的问题：`current()` 现在会正确地将部分配置与默认值合并。
- `lastActivityMs()` 兼容 `.v3.jsonl` 与旧版 `.jsonl` 工件，文件缺失时优雅回退而不中断扫描。
- 插件启动增加异常保护与诊断日志，避免因单个设置区块注册失败导致整个插件加载失败。

### Added
- 版本兼容性验证报告（`VERSION_COMPATIBILITY.md`）与 DSH profile 重建脚本（`fix-dsh-profile.sh`）。
- `verify-install.sh` 一键安装验证脚本。

[0.4.1]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.4.1

## [0.4.0] - 2026-09-10

### Changed
- 🔼 **适配 DeepSeek Harness 0.1.5-rc.1（最新版）**：peerDependencies 更新为 `^0.1.5-rc.1`。

[0.4.0]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.4.0

## [0.3.1] - 2025-01-12

### Fixed
- Fixed configuration merge issue where missing `unit` and `intervalMinutes` fields in settings.yaml would prevent the archiver from starting
- The `current()` method now properly merges partial configuration with default values

[0.3.1]: https://github.com/ohmejj/dsh-chat-archive/compare/v0.3.0...v0.3.1

## [0.3.0] - 2025-01-09

### Added
- 🎯 独立的设置界面，在 DSH 设置面板中提供专属的左侧菜单项
- 🤖 自动归档功能：根据闲置时间自动归档会话
- ⚙️ 灵活配置：支持分钟/小时/天为单位设置闲置阈值
- 💾 配置持久化：设置自动保存到 `$DSH_HOME/settings.yaml`
- 🔄 实时生效：保存配置后立即触发一次扫描
- 👁️ 预览脚本：可在不修改数据的情况下查看哪些会话将被归档
- 🛡️ 防误归档机制：会话须连续闲置超过阈值才会被归档
- 📝 完整的使用文档和操作手册
- 🧪 单元测试和 Host 端逻辑自检脚本
- 🔧 一键安装/卸载脚本

### Features
- 混合插件架构：Host 端归档引擎 + 浏览器端设置界面
- 使用 DSH 原生 `workspaceRegistry.archiveSession` API，归档操作可逆
- 支持通过 `dsh plugin` 命令安装
- 完整的 TypeScript 类型定义
- 兼容 DeepSeek Harness Web GUI

### Configuration
- **启用自动归档**：总开关（默认关闭）
- **闲置阈值**：可配置为分钟/小时/天（默认 72 小时）
- **扫描间隔**：定期扫描的时间间隔（默认 30 分钟）
- **立即归档**：手动触发一次扫描

### Technical
- Node.js >= 22.18.0
- TypeScript 编译到 ESM
- Peer dependencies: cordis, dsh-session, dsh-settings, dsh-workspace, schemastery
- MIT License

[0.3.0]: https://github.com/ohmejj/dsh-chat-archive/releases/tag/v0.3.0
