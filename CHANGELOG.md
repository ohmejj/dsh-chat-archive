# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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