# @ohmejj/dsh-chat-archive 插件使用指南（中文）

DeepSeek Harness 插件：**DSH 对话自动归档**。超过闲置阈值（小时/天）的会话会被自动放入 DSH 自带的“归档集”——从侧边栏/工作区列表中隐藏，但数据完整保留且可在原生归档功能中恢复。

- 插件类型：混合插件（Host 半侧做归档引擎 + 浏览器半侧提供**独立的“设置”左侧菜单项**）
- 开发语言：TypeScript（编译到 `dist/`）
- 引入方式：npm link（把包链接进 dsh profile 的 `node_modules`）

## 1. 目录结构

```
dsh-chat-archive/
├── package.json            # name: "@ohmejj/dsh-chat-archive"
│                           # exports["."]=Host 入口, exports["./client"]=浏览器入口,
│                           # dsh.bundle.patch + dsh.client.platform: web
├── cordis.patch.yml        # bundle 补丁：插入 chat-archive 加载行（name 指向本包）
├── tsconfig.json           # Host 半侧编译（NodeNext ESM）
├── tsconfig.client.json    # 浏览器半侧编译（单文件 classic script，无 import/export）
├── src/
│   ├── index.ts            # 插件入口：name/description/inject/apply
│   ├── config.ts           # 设置命名空间 chat-archive 的 schema/默认值/校验/阈值换算
│   ├── archiver.ts         # Host 运行器：settings 接线、定时扫描、workspaceRegistry.archiveSession
│   ├── scan.ts             # 纯函数决策（可单测）：谁该归档
│   └── client.ts           # 浏览器半侧：注册 “对话自动归档” 设置分区（左侧菜单项）
├── scripts/
│   ├── enable-in-profile.sh    # 一键接入（构建 + 链接 + 写入 profile patch）
│   ├── disable-from-profile.sh # 一键移除
│   ├── preview-archive.mjs     # 干跑预览：列出“如果启用会归档哪些会话”（不改任何数据）
│   └── selfcheck-host.mjs      # 无 dsh 环境下的 Host 逻辑自检
└── tests/archive-logic.test.mjs
```

## 2. 构建与自检

```bash
npm run build     # tsc（Host） + tsc（client）→ dist/
npm test          # 构建 + 纯逻辑单测（阈值换算、配置校验、归档决策分桶/幂等）
node scripts/selfcheck-host.mjs   # 用假服务跑真实 ChatArchiveRunner，验证归档/跳过逻辑
```

## 3. 接入当前机器的 dsh Web GUI（核心步骤）

DSH 的 profile 位于 `$DSH_HOME/profiles/<name>`（本机 `DSH_HOME=~/.dsh`，GUI 是 `web` profile）。

**方式 A：一键脚本**（等价于下面的手动步骤）

```bash
bash scripts/enable-in-profile.sh web
# 按脚本提示重启 GUI 后即可使用
```

**方式 B：手动 npm link（你要求的方式）**

```bash
cd /Users/zhangjunjie/Projects/github/dsh-chat-archive
npm link                            # ① 在插件目录注册全局链接
cd ~/.dsh/profiles/web
npm link @ohmejj/dsh-chat-archive   # ② 在 profile 中建立 node_modules 链接
```

> 注意：如果这台机器的 npm（v11 + Node 26 alpha）执行 `npm link` 会挂起，npm link 的效果就是建符号链接，可手动等价完成：
> ```bash
> mkdir -p ~/.dsh/profiles/web/node_modules/@ohmejj
> ln -s /Users/zhangjunjie/Projects/github/dsh-chat-archive ~/.dsh/profiles/web/node_modules/@ohmejj/dsh-chat-archive
> ```

**③ 让 dsh 加载它**：把下面内容写进 `~/.dsh/profiles/web/cordis.patch.yml`（原文件是空 `[]`，直接替换即可）：

```yaml
- insert:
    - id: chat-archive
      name: '@ohmejj/dsh-chat-archive'
```

**④ 重启 Web GUI**（浏览器启动图只在进程启动时打包 client 模块，必须重启一次）：

```bash
kill "$(cat ~/.dsh/dsh-web.pid)"   # 或者直接 Ctrl+C 关掉原来启动的 dsh web
dsh --profile web                  # 重新启动（沿用你平时的启动方式）
```

## 4. 配置入口在哪里（左侧菜单）

重启后点击侧边栏底部的 **设置** 图标打开设置弹窗 —— **弹窗左侧菜单会多出一项“对话自动归档”**（英文界面显示 Auto-archive conversations），点进去即可看到配置表单。它和“通用设置 / 模型 / 插件”等并列，是插件注册的一个独立设置分区。

## 5. 配置项

| 字段 | 含义 | 默认 |
|---|---|---|
| 启用自动归档 | 总开关，关闭后不扫描不归档 | 关 |
| 闲置超过 N 分钟/小时/天 即归档 | 阈值与单位（可切换分钟/小时/天） | 72 小时 |
| 扫描间隔（分钟） | Host 每隔多久扫描一次 | 30 |
| 立即归档 | 立刻按当前配置扫描一次（触发后 4 秒内有提示） | — |

交互与持久化：
- 修改是**草稿**：点 **保存** 才真正写入；可 **放弃**。
- **保存后立即生效**：保存提交成功后，Host 立刻按新配置扫描一次（界面短暂提示“已保存，立即生效”）；随后按扫描间隔周期执行。
- 保存走 DSH 设置服务，**真实落盘到 `$DSH_HOME/settings.yaml`**（章节名 `chat-archive`）。下次打开页面/重启后仍显示上次保存的值。
- 保存成功会立即触发一次扫描；之后按设置的间隔周期扫描。

## 6. 归档行为（什么是“归档”）

- 用 DSH 原生语义：`ctx.workspaceRegistry.archiveSession(id)` —— 会话进入 registry-global 归档集，从工作区/侧边栏分组视图隐藏，会话日志与数据不动，可被 DSH 归档/恢复机制使用。
- 判定“闲置”：会话持久化日志文件（`session.jsonl`/zstd）的 **mtime**（最后一次 durable 写入）。
- **间隔防误归档**：会话须连续闲置 **max(阈值, 一个完整扫描间隔)** 才会被归档——即“最近一个完整扫描间隔内没有任何对话”的会话才可能被归档（间隔 ≤ 阈值时行为与旧版一致）。
- 永远不会归档：当前正在运行的会话（live）、已在归档集的会话（幂等）、无法确定活动时间的会话。
- 默认 **关闭**；打开并保存后才生效（安全默认）。

## 7. 预览（不改任何数据）

```bash
node scripts/preview-archive.mjs                    # 默认阈值 72 hours、间隔 30 min
node scripts/preview-archive.mjs 10 minutes 5         # 阈值 10 分钟、扫描间隔 5 分钟
node scripts/preview-archive.mjs 7 days                # 阈值 7 天、间隔 30 min
node scripts/preview-archive.mjs 7 days
node scripts/preview-archive.mjs 48 hours
```
它会遍历 `$DSH_HOME/sessions`，列出“如果启用会被归档 / 仍算活跃”的会话及最后活动时间。

## 8. 移除插件

```bash
bash scripts/disable-from-profile.sh web
# 或手动：rm -rf ~/.dsh/profiles/web/node_modules/@ohmejj && 还原 cordis.patch.yml
```
然后重启 GUI。已归档的会话不会因移除插件而受影响（归档集在 workspace store 中）。

## 9. 常见问题

- **左侧菜单没有“对话自动归档”？** 依次确认：① 包已链接进 `web` profile（`~/.dsh/profiles/web/node_modules/@ohmejj/dsh-chat-archive` 存在）；② `cordis.patch.yml` 含上面的 insert 行；③ **GUI 已重启**（必须，否则浏览器侧根本没打包这个插件）；④ 刷新页面后再打开设置。
- **保存后“保存失败”？** 卡片只读（连接只读）或写被 Host 拒绝（schema 校验失败）。请把数值填成 ≥1 的整数。
- **想验证 Host 确实在归档？** 打开一个“老会话”所在工作区，观察它从列表消失；或临时把阈值设为最小（1 小时/1 分钟间隔）保存后看效果，再改回来。预览脚本能先告诉你谁会中招。
- **“已覆盖/重置”**：字段出现“已覆盖”表示当前值来自用户设置层；点“重置”可清除该覆盖、回到默认。