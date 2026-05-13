#!/bin/bash

# 统一启动脚本 - 同时启动前后端服务并显示所有可访问地址

echo "========================================="
echo "文件服务器统一启动脚本"
echo "========================================="

# 检查是否在项目根目录
if [ ! -f "app.py" ] || [ ! -d "frontend" ]; then
    echo "错误：请在项目根目录运行此脚本！"
    exit 1
fi

# 获取当前IP地址
IP_ADDRESS=$(ifconfig | grep 'inet ' | grep -v 127.0.0.1 | cut -d' ' -f2 | head -n 1)

# 获取主机名
HOSTNAME=$(hostname)

# 显示系统信息
echo ""
echo "💻 系统信息："
echo "   主机名：${HOSTNAME}"
echo "   IP地址：${IP_ADDRESS}"
echo ""

# 检查Python环境
echo "🔍 检查Python环境..."
if ! command -v python3 &> /dev/null; then
    echo "错误：未找到Python 3环境！"
    exit 1
fi

echo "✅ Python 3已安装"

# 检查Node.js环境
echo "🔍 检查Node.js环境..."
if ! command -v node &> /dev/null; then
    echo "错误：未找到Node.js环境！"
    exit 1
fi

echo "✅ Node.js已安装"

# 显示可访问地址
echo ""
echo "📱 所有可访问地址："
echo "-----------------------------------------"
echo "🔧 后端服务 (端口 3002)："
echo "   本地访问：http://localhost:3002"
echo "   局域网访问：http://${IP_ADDRESS}:3002"
echo "   mDNS访问：http://${HOSTNAME}.local:3002"
echo ""
echo "🎨 前端服务 (端口 3001)："
echo "   本地访问：http://localhost:3001"
echo "   局域网访问：http://${IP_ADDRESS}:3001"
echo "   mDNS访问：http://${HOSTNAME}.local:3001"
echo "-----------------------------------------"
echo ""

# 直接启动服务，无需用户交互
echo "🚀 准备启动服务..."

echo ""
echo "🚀 正在启动服务..."
echo "========================================="

# 启动后端服务
echo ""
echo "🔧 启动后端服务 (端口 3002)..."
python3 app.py &
BACKEND_PID=$!

# 等待后端服务启动
sleep 3

# 启动前端服务
echo ""
echo "🎨 启动前端服务 (端口 3001)..."
cd frontend && npm run dev &
FRONTEND_PID=$!

# 等待前端服务启动
sleep 3

echo ""
echo "========================================="
echo "✅ 所有服务已成功启动！"
echo "========================================="
echo ""
echo "📱 可访问地址列表："
echo "-----------------------------------------"
echo "🔧 后端服务 (端口 3002)："
echo "   本地访问：http://localhost:3002"
echo "   局域网访问：http://${IP_ADDRESS}:3002"
echo "   mDNS访问：http://${HOSTNAME}.local:3002"
echo ""
echo "🎨 前端服务 (端口 3001)："
echo "   本地访问：http://localhost:3001"
echo "   局域网访问：http://${IP_ADDRESS}:3001"
echo "   mDNS访问：http://${HOSTNAME}.local:3001"
echo "-----------------------------------------"
echo ""
echo "📁 文件目录：/Volumes/My Passport"
echo ""
echo "💡 提示："
echo "   - 按 Ctrl+C 停止所有服务"
echo "   - 如需单独启动服务，请分别运行："
echo "     * 后端：python app.py"
echo "     * 前端：cd frontend && npm run dev"
echo ""
echo "========================================="
echo "享受您的文件服务器体验！ 🎉"
echo "========================================="

# 等待用户中断
wait $BACKEND_PID $FRONTEND_PID
