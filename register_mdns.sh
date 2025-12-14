#!/bin/bash

# 注册sanwangi.file域名的mDNS服务

# 服务名称
SERVICE_NAME="sanwangi"
# 域名
DOMAIN="sanwangi.file"
# 服务类型
SERVICE_TYPE="_http._tcp"
# 端口
PORT=3001

# 获取当前IP地址
IP_ADDRESS=$(ifconfig | grep 'inet ' | grep -v 127.0.0.1 | cut -d' ' -f2)

if [ -z "$IP_ADDRESS" ]; then
    echo "无法获取IP地址"
    exit 1
fi

echo "正在注册mDNS服务..."
echo "服务名称: $SERVICE_NAME"
echo "域名: $DOMAIN"
echo "IP地址: $IP_ADDRESS"
echo "端口: $PORT"

# 使用dns-sd注册mDNS服务
dns-sd -R "$SERVICE_NAME" "$SERVICE_TYPE" local $PORT "$DOMAIN" "$IP_ADDRESS" &

# 保存进程ID
echo $! > mdns_process.pid

echo "mDNS服务注册成功！"
echo "可以通过 http://$DOMAIN:$PORT 访问前端应用"
echo "或者使用 http://$SERVICE_NAME.local:$PORT"
