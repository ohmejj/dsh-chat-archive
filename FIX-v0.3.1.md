# DSH Chat Archive v0.3.1 修复说明

## 问题
在 DSH 0.1.2-rc.1 中，chat-archive 插件的自动归档功能无法正常工作。

## 根本原因
1. **版本不兼容**: v0.4.1 要求 DSH >= 0.1.5-rc.1
2. **配置合并 Bug**: `current()` 方法未正确处理部分配置

## 修复内容
```typescript
// src/archiver.ts:74
// 之前
current(): ChatArchiveConfig {
  return this.source() ?? DEFAULT_CONFIG
}

// 之后
current(): ChatArchiveConfig {
  const resolved = this.source() ?? DEFAULT_CONFIG
  return { ...DEFAULT_CONFIG, ...resolved }
}
```

## 测试
- ✅ 8/8 单元测试通过
- ✅ 配置合并测试覆盖
- ✅ TypeScript 编译通过

## 安装
```bash
cd /Users/zhangjunjie/Projects/github/dsh-chat-archive
npm link
# 重启 DSH
```

## 验证
1. 打开 DSH Settings > Chat Archive
2. 启用自动归档
3. 设置时间阈值 (例如 7 天)
4. 检查旧会话是否被正确归档

## 版本信息
- 版本: v0.3.1
- 提交: 42be235
- 兼容: DSH 0.1.2-rc.1

