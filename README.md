# DSH Chat Archive - DSH 对话自动归档插件

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

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

### 方式一：一键安装（推荐）

```bash
# 克隆仓库
git clone https://github.com/ohmejj/dsh-chat-archive.git
cd dsh-chat-archive

# 构建项目
npm install
npm run build

# 一键接入到 DSH web profile
bash scripts/enable-in-profile.sh web
```

按脚本提示重启 DSH Web GUI 即可使用。

### 方式二：手动安装

```bash
# 1. 构建项目
npm install
npm run build

# 2. 创建全局链接
npm link

# 3. 链接到 DSH web profile
cd ~/.dsh/profiles/web
npm link @ohmejj/dsh-chat-archive

# 4. 配置 cordis.patch.yml
# 编辑 ~/.dsh/profiles/web/cordis.patch.yml，添加以下内容：
```

```yaml
- insert:
    - id: chat-archive
      name: '@ohmejj/dsh-chat-archive'
```

```bash
# 5. 重启 DSH Web GUI
kill "$(cat ~/.dsh/dsh-web.pid)"
dsh --profile web
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

## 🧪 测试与验证

```bash
# 运行单元测试
npm test

# 运行 Host 端逻辑自检（无需 DSH 环境）
node scripts/selfcheck-host.mjs
```

## 🗑️ 卸载

### 使用脚本卸载（推荐）

```bash
bash scripts/disable-from-profile.sh web
```

### 手动卸载

```bash
# 1. 移除 profile 中的链接
cd ~/.dsh/profiles/web
npm unlink @ohmejj/dsh-chat-archive

# 2. 还原 cordis.patch.yml
# 编辑 ~/.dsh/profiles/web/cordis.patch.yml，删除插件配置或改为 []

# 3. 重启 DSH Web GUI
```

**注意**：卸载插件不会影响已归档的会话，这些会话仍然存在于归档集中，可通过 DSH 原生功能恢复。

## 📁 项目结构

```
dsh-chat-archive/
├── src/                      # 源代码
│   ├── index.ts             # 插件入口
│   ├── config.ts            # 配置 schema 和验证
│   ├── archiver.ts          # 归档引擎（Host 端）
│   ├── scan.ts              # 扫描决策逻辑
│   └── client.ts            # 浏览器端设置界面
├── scripts/                  # 工具脚本
│   ├── enable-in-profile.sh # 一键安装
│   ├── disable-from-profile.sh # 一键卸载
│   ├── preview-archive.mjs  # 预览归档
│   └── selfcheck-host.mjs   # Host 端自检
├── tests/                    # 测试文件
│   └── archive-logic.test.mjs
├── dist/                     # 构建输出
├── docs/                     # 文档
│   └── plugin-guide.zh.md   # 详细使用指南
├── package.json
├── cordis.patch.yml         # Cordis 补丁配置
├── tsconfig.json            # TypeScript 配置（Host）
└── tsconfig.client.json     # TypeScript 配置（Client）
```

## 🛠️ 开发

```bash
# 安装依赖
npm install

# 构建
npm run build

# 监听模式构建
npm run build:watch

# 类型检查
npm run check
```

## ❓ 常见问题

### 左侧菜单没有"对话自动归档"选项？

依次检查：
1. 确认包已链接到 web profile：检查 `~/.dsh/profiles/web/node_modules/@ohmejj/dsh-chat-archive` 是否存在
2. 确认 `cordis.patch.yml` 包含插件配置
3. **重启 DSH Web GUI**（必须重启才能加载新插件）
4. 刷新浏览器页面后重新打开设置

### 保存配置时提示"保存失败"？

- 检查配置值是否合法（必须是 ≥1 的整数）
- 确认 DSH 设置服务正常运行
- 查看控制台是否有错误信息

### 如何验证插件是否在工作？

1. 使用预览脚本查看将被归档的会话
2. 临时设置较小的阈值（如 1 分钟）和间隔，保存后观察效果
3. 打开包含老会话的工作区，观察会话是否从列表中消失

## 📄 许可证

[MIT License](LICENSE)

## 👤 作者

**ohmejj**
- Email: ohmezhang@gmail.com
- GitHub: [@ohmejj](https://github.com/ohmejj)

## 🔗 相关链接

- [GitHub 仓库](https://github.com/ohmejj/dsh-chat-archive)
- [详细使用指南](docs/plugin-guide.zh.md)
- [DeepSeek Harness](https://github.com/anywhere-labs/dsh-desktop)
- [DSH 插件开发文档](https://github.com/anywhere-labs/dsh-desktop/blob/master/docs/plugin-development.md)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**注意**：本插件使用 DSH 原生的归档机制，归档操作是可逆的，归档的会话可以随时通过 DSH 的归档管理功能恢复。
