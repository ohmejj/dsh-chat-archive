# DSH Chat Archive - DSH 对话自动归档插件

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@ohmejj/dsh-chat-archive.svg)](https://www.npmjs.com/package/@ohmejj/dsh-chat-archive)

一个 DeepSeek Harness 插件，用于自动归档闲置会话。超过设定闲置时间的会话将被自动归档，从侧边栏隐藏但数据完整保留，可随时恢复。

## ✨ 功能特性

- 🤖 **自动归档**：根据闲置时间自动归档会话
- ⚙️ **灵活配置**：支持分钟/小时/天为单位设置闲置阈值
- 🎯 **独立设置界面**：在 DSH 设置面板中提供独立的左侧菜单项
- 💾 **配置持久化**：设置自动保存到 `$DSH_HOME/settings.yaml`
- 🔄 **实时生效**：保存配置后立即触发一次扫描
- 👁️ **预览功能**：提供预览脚本，可在不修改数据的情况下查看哪些会话将被归档

## 📦 安装

### 前置要求

- Node.js >= 22.18.0
- DeepSeek Harness (DSH) 已安装并配置

### 使用 DSH 命令安装（推荐）

```bash
# 安装到默认 profile
dsh plugin --profile default add @ohmejj/dsh-chat-archive

# 或安装到 web profile
dsh plugin --profile web add @ohmejj/dsh-chat-archive

# 或安装到 tui profile
dsh plugin --profile tui add @ohmejj/dsh-chat-archive
```

安装完成后，在 profile 目录下的 `cordis.patch.yml` 中添加插件配置：

**编辑文件**：`~/.dsh/profiles/web/cordis.patch.yml`（根据你的 profile 调整路径）

```yaml
- insert:
    - id: chat-archive
      name: '@ohmejj/dsh-chat-archive'
```

然后重启 DSH：

```bash
# 如果是 web profile
kill "$(cat ~/.dsh/dsh-web.pid)"
dsh --profile web

# 如果是其他 profile，使用对应的启动命令
```

### 本地开发安装

如果你需要从本地源码安装（用于开发或测试）：

```bash
# 克隆仓库
git clone https://github.com/ohmejj/dsh-chat-archive.git
cd dsh-chat-archive

# 安装依赖（包括 TypeScript 和类型定义）
npm install

# 构建
npm run build

# 使用一键脚本安装到 web profile
bash scripts/enable-in-profile.sh web
```

## 🎮 使用指南

### 访问设置界面

1. 启动 DSH Web GUI 后，点击侧边栏底部的 **设置** 图标
2. 在设置弹窗的左侧菜单中找到 **对话自动归档** (Auto-archive conversations)
3. 进入配置界面

### 配置项说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **启用自动归档** | 总开关，关闭后不扫描不归档 | 关闭 |
| **闲置阈值** | 会话闲置超过该时间后将被归档<br>支持单位：分钟/小时/天 | 72 小时 |
| **扫描间隔** | Host 端每隔多久扫描一次（分钟） | 30 分钟 |
| **立即归档** | 点击后立即按当前配置扫描一次 | - |

### 使用说明

- **修改配置**：在界面中修改配置后，点击 **保存** 按钮才会生效（可点击 **放弃** 取消修改）
- **配置生效**：保存成功后会立即触发一次扫描，并显示"已保存，立即生效"提示
- **持久化**：配置自动保存到 `$DSH_HOME/settings.yaml` 的 `chat-archive` 章节
- **周期执行**：首次扫描后，按设定的扫描间隔定期执行

### 归档规则

- ✅ **会被归档**：闲置时间超过阈值的非活跃会话
- ❌ **不会归档**：
  - 当前正在运行的会话
  - 已经在归档集中的会话
  - 无法确定活动时间的会话
- 📏 **闲置时间判定**：基于会话持久化日志文件（`session.jsonl`）的最后修改时间（mtime）
- 🛡️ **防误归档**：会话须连续闲置 `max(阈值, 一个完整扫描间隔)` 才会被归档

## 🔍 预览功能

在实际启用归档前，可以使用预览脚本查看哪些会话将被归档：

```bash
# 使用默认配置预览（72 小时阈值，30 分钟间隔）
node scripts/preview-archive.mjs

# 自定义阈值和间隔
node scripts/preview-archive.mjs 10 minutes 5    # 10 分钟阈值，5 分钟间隔
node scripts/preview-archive.mjs 7 days          # 7 天阈值
node scripts/preview-archive.mjs 48 hours        # 48 小时阈值
```

预览脚本会列出：
- 将被归档的会话及其最后活动时间
- 仍然活跃的会话
- 不会触及的会话（正在运行、已归档等）

**注意**：预览功能需要从插件源码目录运行。

## 🗑️ 卸载

### 使用 DSH 命令卸载

```bash
# 从指定 profile 卸载
dsh plugin --profile web remove @ohmejj/dsh-chat-archive
```

卸载后，还需要从 `cordis.patch.yml` 中移除插件配置，然后重启 DSH。

### 使用脚本卸载（本地安装）

```bash
bash scripts/disable-from-profile.sh web
```

**注意**：卸载插件不会影响已归档的会话，这些会话仍然存在于归档集中，可通过 DSH 原生功能恢复。

## ❓ 常见问题

### 左侧菜单没有"对话自动归档"选项？

依次检查：
1. 确认插件已安装：`ls ~/.dsh/profiles/web/node_modules/@ohmejj/dsh-chat-archive`
2. 确认 `cordis.patch.yml` 包含插件配置
3. **重启 DSH**（必须重启才能加载新插件）
4. 刷新浏览器页面后重新打开设置

### 保存配置时提示"保存失败"？

- 检查配置值是否合法（必须是 ≥1 的整数）
- 确认 DSH 设置服务正常运行
- 查看控制台是否有错误信息

### 如何验证插件是否在工作？

1. 使用预览脚本查看将被归档的会话（需要从插件源码目录运行）
2. 临时设置较小的阈值（如 1 小时）和间隔（如 5 分钟），保存后观察效果
3. 打开包含老会话的工作区，观察会话是否从列表中消失

### 插件安装后如何配置自动加载？

插件安装到 profile 后，需要在对应 profile 目录下的 `cordis.patch.yml` 文件中添加插件配置。DSH 启动时会读取该文件并加载配置的插件。

## 📄 许可证

MIT License - 详见 [LICENSE](https://github.com/ohmejj/dsh-chat-archive/blob/main/LICENSE) 文件

## 👤 作者

**ohmejj**
- Email: ohmezhang@gmail.com
- GitHub: [@ohmejj](https://github.com/ohmejj)

## 🔗 相关链接

- [GitHub 仓库](https://github.com/ohmejj/dsh-chat-archive)
- [详细使用指南](https://github.com/ohmejj/dsh-chat-archive/blob/main/docs/plugin-guide.zh.md)
- [DeepSeek Harness](https://github.com/anywhere-labs/dsh-desktop)
- [DSH 插件开发文档](https://github.com/anywhere-labs/dsh-desktop/blob/master/docs/plugin-development.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**注意**：本插件使用 DSH 原生的归档机制，归档操作是可逆的，归档的会话可以随时通过 DSH 的归档管理功能恢复。
