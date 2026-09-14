#!/bin/bash
# DSH Profile 重建脚本

echo "🔧 重建 DSH web profile"
echo "========================"
echo ""

# 备份配置
echo "1. 备份当前配置..."
cp ~/.dsh/profiles/web/cordis.patch.yml ~/cordis.patch.yml.backup 2>/dev/null
cp ~/.dsh/profiles/web/package.json ~/dsh-web-package.json.backup 2>/dev/null

# 删除旧 profile
echo "2. 删除旧 profile..."
rm -rf ~/.dsh/profiles/web

# 重新安装插件
echo "3. 重新安装插件..."
dsh plugin --profile web add @ohmejj/dsh-chat-archive

# 恢复配置
echo "4. 恢复配置..."
cp ~/cordis.patch.yml.backup ~/.dsh/profiles/web/cordis.patch.yml 2>/dev/null

echo ""
echo "✅ 完成！现在可以启动 DSH 了："
echo "   dsh web"
