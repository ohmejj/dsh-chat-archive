# DSH Chat Archive

本项目用于 DeepSeek Harness 插件开发学习和实践。

## 1. DeepSeek Harness 插件开发指南

DeepSeek Harness (DSH) 是一个 "一切皆插件" 的 Agent 框架，支持灵活的插件扩展机制。

### 插件开发资源

- [官方插件开发文档（中文）](https://github.com/anywhere-labs/dsh-desktop/blob/master/docs/plugin-development.md)
- [官方插件开发文档（英文）](https://github.com/anywhere-labs/dsh-desktop/blob/master/docs/plugin-development.en.md)
- [插件注册中心](https://github.com/dsh-external/plugin-registry)

### 插件开发基础

DSH 插件采用标准的 npm 包结构，主要包含以下核心概念：

#### 1. 插件类型

- **工具插件（Tool Plugin）**：为 AI Agent 提供可调用的工具能力
- **客户端插件（Client Plugin）**：扩展 DSH 的前端界面和交互功能
- **混合插件**：同时包含工具和客户端功能

#### 2. 插件结构

```
my-dsh-plugin/
├── package.json          # 包配置文件
├── src/
│   ├── tool/            # 工具插件代码
│   │   └── index.ts
│   └── client/          # 客户端插件代码
│       └── index.tsx
├── tsconfig.json        # TypeScript 配置
└── README.md
```

#### 3. 开发步骤

1. **创建插件包**
   ```bash
   mkdir my-dsh-plugin
   cd my-dsh-plugin
   npm init -y
   ```

2. **配置 package.json**
   ```json
   {
     "name": "@my-scope/dsh-plugin-example",
     "version": "1.0.0",
     "dsh": {
       "tool": "./dist/tool/index.js",
       "client": "./dist/client/index.js"
     }
   }
   ```

3. **实现工具插件**
   - 定义工具的输入输出 Schema
   - 实现工具的执行逻辑
   - 导出工具描述符

4. **实现客户端插件**
   - 创建 React 组件
   - 注册 UI 扩展点
   - 处理与 Agent 的交互

5. **构建与测试**
   ```bash
   npm run build
   npm test
   ```

### 参考资料

- [DeepSeek Harness 插件开发完整教程](https://news.qiniu.com/archives/1787709229083)
- [插件准入规范](https://github.com/ccch1mneyyy/dsh-TUI/blob/master/README.md)

---

## 2. npm link 使用指南

`npm link` 是用于本地包开发和调试的重要工具，它可以在不发布到 npm 的情况下，将本地正在开发的包链接到其他项目中使用。

### 基本用法

#### 步骤 1：在包目录中创建全局链接

在你正在开发的包的根目录下运行：

```bash
cd /path/to/my-dsh-plugin
npm link
```

这会在全局 `node_modules` 目录中创建一个符号链接，指向你的包。

#### 步骤 2：在目标项目中使用链接

在需要使用该包的项目目录下运行：

```bash
cd /path/to/my-project
npm link @my-scope/dsh-plugin-example
```

这会在项目的 `node_modules` 中创建一个符号链接，指向全局链接的包。

### 实际应用场景

#### 场景 1：开发 DSH 插件时实时测试

```bash
# 在插件目录
cd ~/projects/my-dsh-plugin
npm link

# 在 DSH 项目目录
cd ~/.nvm/versions/node/v24.14.0/lib/node_modules/@deepseek-ai/dsh
npm link @my-scope/dsh-plugin-example
```

#### 场景 2：同时开发多个相互依赖的包

```bash
# 链接包 A
cd ~/projects/package-a
npm link

# 链接包 B，并使用包 A
cd ~/projects/package-b
npm link
npm link package-a

# 在项目中使用包 B（自动包含包 A）
cd ~/projects/my-project
npm link package-b
```

### 解除链接

#### 解除项目中的链接

```bash
cd /path/to/my-project
npm unlink @my-scope/dsh-plugin-example
# 或者
npm unlink --no-save @my-scope/dsh-plugin-example
```

#### 解除全局链接

```bash
cd /path/to/my-dsh-plugin
npm unlink
# 或者在任意位置
npm unlink -g @my-scope/dsh-plugin-example
```

### 常见问题与注意事项

1. **权限问题**
   - 如果遇到权限错误，可能需要使用 `sudo`（不推荐）或配置 npm 使用用户目录

2. **符号链接失效**
   - 重新安装依赖（`npm install`）可能会移除链接
   - 使用 `npm install --preserve-symlinks` 可以保留链接

3. **TypeScript 项目**
   - 确保被链接的包已经构建（`npm run build`）
   - 考虑启用 watch 模式自动重新构建

4. **查看链接状态**
   ```bash
   # 查看全局链接的包
   npm ls -g --depth=0 --link=true
   
   # 查看项目中的链接
   npm ls --link=true
   ```

### 替代方案

如果 `npm link` 遇到问题，可以考虑以下替代方案：

- **使用相对路径安装**
  ```bash
  npm install ../my-dsh-plugin
  ```

- **使用 `file:` 协议**
  ```json
  {
    "dependencies": {
      "@my-scope/dsh-plugin-example": "file:../my-dsh-plugin"
    }
  }
  ```

### 参考文档

- [npm link 官方文档](https://docs.npmjs.com/cli/v11/commands/npm-link)
- [使用 npm link 进行本地调试](https://cloud.baidu.com/article/2916931)

---

## 项目信息

- **仓库地址**: https://github.com/ohmejj/dsh-chat-archive.git
- **维护者**: ohmejj (ohmezhang@gmail.com)
