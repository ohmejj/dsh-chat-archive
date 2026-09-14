#!/bin/bash
# 快速验证脚本

echo "🔍 验证 DSH Chat Archive v0.3.1"
echo "================================"
echo ""

# 1. 检查插件是否已链接
echo "1️⃣ 检查全局链接:"
npm ls -g --depth=0 | grep dsh-chat-archive

# 2. 检查 DSH 版本
echo ""
echo "2️⃣ DSH 版本:"
dsh --version 2>&1 || echo "   未找到 dsh 命令"

# 3. 提示下一步
echo ""
echo "3️⃣ 下一步操作:"
echo "   - 重启 DSH"
echo "   - 打开 Settings > Chat Archive"
echo "   - 启用自动归档并设置时间阈值"
echo ""
echo "✅ v0.3.1 已准备就绪，等待测试！"

