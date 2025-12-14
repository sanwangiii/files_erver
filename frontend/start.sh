#!/bin/bash

# 前端启动脚本 - 显示所有可访问地址

echo "========================================="
echo "前端服务启动中..."
echo "========================================="

# 获取当前IP地址
IP_ADDRESS=$(ifconfig | grep 'inet ' | grep -v 127.0.0.1 | cut -d' ' -f2 | head -n 1)

# 获取主机名
HOSTNAME=$(hostname)

# 显示可访问地址
echo ""
echo "✅ 前端服务即将启动在端口 3001"
echo ""
echo "📱 可访问地址列表："
echo "   本地访问：http://localhost:3001"
echo "   局域网访问：http://${IP_ADDRESS}:3001"
echo "   mDNS访问：http://${HOSTNAME}.local:3001"
echo ""
echo "========================================="
echo ""

# 启动Vite开发服务器
npm run dev
