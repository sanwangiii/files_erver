#!/bin/bash

# ============================================
#  文件服务器 快速启动脚本
#  用法: ./dev.sh [选项]
#    无参数   → 启动前后端
#    backend  → 仅启动后端
#    frontend → 仅启动前端
#    stop     → 停止所有服务
#    status   → 查看运行状态
# ============================================

set -euo pipefail

# ---------- 配置 ----------
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=3002
FRONTEND_PORT=3001
PID_DIR="$PROJECT_DIR/.pids"
LOG_DIR="$PROJECT_DIR/.logs"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ---------- 工具函数 ----------
info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✖${NC} $*" >&2; }

ensure_dirs() {
    mkdir -p "$PID_DIR" "$LOG_DIR"
}

get_ip() {
    # macOS: 优先取 en0 的 IP，兼容有线和 Wi-Fi
    local ip
    ip=$(ifconfig en0 2>/dev/null | awk '/inet /{print $2}' | head -1)
    if [ -z "$ip" ]; then
        ip=$(ifconfig | awk '/inet / && !/127.0.0.1/{print $2}' | head -1)
    fi
    echo "${ip:-未知}"
}

is_port_in_use() {
    lsof -iTCP:"$1" -sTCP:LISTEN -P &>/dev/null
}

kill_port() {
    local pids
    pids=$(lsof -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill 2>/dev/null || true
        sleep 1
        # 如果还没死，强制杀
        pids=$(lsof -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true)
        if [ -n "$pids" ]; then
            echo "$pids" | xargs kill -9 2>/dev/null || true
        fi
    fi
}

# ---------- 前置检查 ----------
check_deps() {
    local missing=0

    if ! command -v python3 &>/dev/null; then
        err "未找到 python3，请先安装"
        missing=1
    fi

    if ! command -v node &>/dev/null; then
        err "未找到 node，请先安装"
        missing=1
    fi

    if ! command -v npm &>/dev/null; then
        err "未找到 npm，请先安装"
        missing=1
    fi

    if [ "$missing" -eq 1 ]; then
        exit 1
    fi

    ok "python3: $(python3 --version 2>&1)"
    ok "node:    $(node --version 2>&1)"
    ok "npm:     $(npm --version 2>&1)"
}

check_python_deps() {
    if ! python3 -c "import flask" &>/dev/null; then
        warn "Flask 未安装，正在安装依赖..."
        pip3 install -r "$PROJECT_DIR/requirements.txt" || {
            err "Python 依赖安装失败"
            exit 1
        }
    fi
}

check_node_deps() {
    if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
        warn "node_modules 不存在，正在安装..."
        cd "$PROJECT_DIR/frontend"
        npm install || {
            err "前端依赖安装失败"
            exit 1
        }
    fi
}

check_hdd() {
    if [ ! -d "/Volumes/My Passport" ]; then
        warn "外接硬盘 '/Volumes/My Passport' 未挂载"
        warn "服务器仍可启动，但部分文件不可访问"
    else
        ok "外接硬盘已挂载"
    fi
}

# ---------- 启动/停止 ----------
start_backend() {
    if is_port_in_use "$BACKEND_PORT"; then
        warn "端口 $BACKEND_PORT 已被占用，正在释放..."
        kill_port "$BACKEND_PORT"
    fi

    info "启动后端 (端口 $BACKEND_PORT)..."
    cd "$PROJECT_DIR"
    python3 app.py > "$LOG_DIR/backend.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_DIR/backend.pid"

    # 等待后端启动（最多 10 秒）
    local i=0
    while [ $i -lt 10 ]; do
        if is_port_in_use "$BACKEND_PORT"; then
            ok "后端已启动 (PID: $pid)"
            return 0
        fi
        # 检查进程是否还活着
        if ! kill -0 "$pid" 2>/dev/null; then
            err "后端启动失败！查看日志: $LOG_DIR/backend.log"
            tail -20 "$LOG_DIR/backend.log" 2>/dev/null
            return 1
        fi
        sleep 1
        i=$((i + 1))
    done
    warn "后端启动超时，请检查日志"
    return 1
}

start_frontend() {
    if is_port_in_use "$FRONTEND_PORT"; then
        warn "端口 $FRONTEND_PORT 已被占用，正在释放..."
        kill_port "$FRONTEND_PORT"
    fi

    info "启动前端 (端口 $FRONTEND_PORT)..."
    cd "$PROJECT_DIR/frontend"
    npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_DIR/frontend.pid"

    # 等待前端启动（最多 15 秒）
    local i=0
    while [ $i -lt 15 ]; do
        if is_port_in_use "$FRONTEND_PORT"; then
            ok "前端已启动 (PID: $pid)"
            return 0
        fi
        if ! kill -0 "$pid" 2>/dev/null; then
            err "前端启动失败！查看日志: $LOG_DIR/frontend.log"
            tail -20 "$LOG_DIR/frontend.log" 2>/dev/null
            return 1
        fi
        sleep 1
        i=$((i + 1))
    done
    warn "前端启动超时，请检查日志"
    return 1
}

start_mdns() {
    if command -v dns-sd &>/dev/null; then
        # 检查是否已经在运行
        if [ -f "$PROJECT_DIR/mdns_process.pid" ] && kill -0 "$(cat "$PROJECT_DIR/mdns_process.pid")" 2>/dev/null; then
            ok "mDNS 已在运行"
            return
        fi
        info "注册 mDNS 服务 (sanwangi.file)..."
        cd "$PROJECT_DIR"
        bash register_mdns.sh &>/dev/null &
        ok "mDNS 已注册"
    else
        warn "dns-sd 不可用，跳过 mDNS 注册"
    fi
}

stop_all() {
    info "正在停止所有服务..."

    # 先尝试用 PID 文件
    for svc in backend frontend; do
        if [ -f "$PID_DIR/${svc}.pid" ]; then
            local pid
            pid=$(cat "$PID_DIR/${svc}.pid")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                ok "${svc} (PID: $pid) 已停止"
            fi
            rm -f "$PID_DIR/${svc}.pid"
        fi
    done

    # 兜底：杀掉占用端口的进程
    kill_port "$BACKEND_PORT"
    kill_port "$FRONTEND_PORT"

    # 停止 mDNS
    if [ -f "$PROJECT_DIR/mdns_process.pid" ]; then
        local mdns_pid
        mdns_pid=$(cat "$PROJECT_DIR/mdns_process.pid")
        if kill -0 "$mdns_pid" 2>/dev/null; then
            kill "$mdns_pid" 2>/dev/null || true
            ok "mDNS 已停止"
        fi
        rm -f "$PROJECT_DIR/mdns_process.pid"
    fi

    ok "所有服务已停止"
}

show_status() {
    local ip
    ip=$(get_ip)
    local hostname
    hostname=$(hostname -s 2>/dev/null || hostname)

    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  文件服务器状态${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # 后端
    if is_port_in_use "$BACKEND_PORT"; then
        echo -e "  ${GREEN}● 后端${NC}  端口 $BACKEND_PORT  运行中"
        echo "    → http://localhost:$BACKEND_PORT"
        echo "    → http://$ip:$BACKEND_PORT"
        echo "    → http://$hostname.local:$BACKEND_PORT"
    else
        echo -e "  ${RED}○ 后端${NC}  端口 $BACKEND_PORT  未运行"
    fi

    echo ""

    # 前端
    if is_port_in_use "$FRONTEND_PORT"; then
        echo -e "  ${GREEN}● 前端${NC}  端口 $FRONTEND_PORT  运行中"
        echo "    → http://localhost:$FRONTEND_PORT"
        echo "    → http://$ip:$FRONTEND_PORT"
        echo "    → http://$hostname.local:$FRONTEND_PORT"
        echo "    → http://sanwangi.file:$FRONTEND_PORT"
    else
        echo -e "  ${RED}○ 前端${NC}  端口 $FRONTEND_PORT  未运行"
    fi

    echo ""
    echo -e "  📁 外接硬盘: $( [ -d '/Volumes/My Passport' ] && echo '已挂载' || echo '未挂载')"
    echo -e "  📋 日志目录: $LOG_DIR/"
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

show_urls() {
    local ip
    ip=$(get_ip)
    local hostname
    hostname=$(hostname -s 2>/dev/null || hostname)

    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  🚀 服务已就绪！访问地址：${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  ${CYAN}前端 (本地):${NC}   http://localhost:$FRONTEND_PORT"
    echo -e "  ${CYAN}前端 (局域网):${NC} http://$ip:$FRONTEND_PORT"
    echo -e "  ${CYAN}前端 (mDNS):${NC}   http://$hostname.local:$FRONTEND_PORT"
    echo -e "  ${CYAN}前端 (域名):${NC}   http://sanwangi.file:$FRONTEND_PORT"
    echo ""
    echo -e "  ${CYAN}后端 (本地):${NC}   http://localhost:$BACKEND_PORT"
    echo -e "  ${CYAN}后端 (局域网):${NC} http://$ip:$BACKEND_PORT"
    echo -e "  ${CYAN}后端 (mDNS):${NC}   http://$hostname.local:$BACKEND_PORT"
    echo ""
    echo -e "  停止服务: ${YELLOW}./dev.sh stop${NC}  或  ${YELLOW}Ctrl+C${NC}"
    echo -e "  查看日志: ${YELLOW}tail -f $LOG_DIR/backend.log${NC}"
    echo -e "           ${YELLOW}tail -f $LOG_DIR/frontend.log${NC}"
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# ---------- 主逻辑 ----------
main() {
    ensure_dirs
    local cmd="${1:-all}"

    case "$cmd" in
        backend)
            echo -e "\n${BOLD}🔧 仅启动后端${NC}\n"
            check_deps
            check_python_deps
            check_hdd
            start_backend
            show_urls
            # 挂住进程
            info "按 Ctrl+C 停止..."
            wait
            ;;
        frontend)
            echo -e "\n${BOLD}🎨 仅启动前端${NC}\n"
            check_deps
            check_node_deps
            start_frontend
            show_urls
            info "按 Ctrl+C 停止..."
            wait
            ;;
        stop)
            stop_all
            ;;
        status)
            show_status
            ;;
        all|"")
            echo -e "\n${BOLD}🚀 启动文件服务器${NC}\n"
            check_deps
            check_python_deps
            check_node_deps
            check_hdd

            # 注册退出时的清理
            trap 'echo ""; info "正在停止服务..."; stop_all; exit 0' INT TERM

            start_backend
            start_frontend
            start_mdns
            show_urls

            info "按 Ctrl+C 停止所有服务"
            wait
            ;;
        *)
            echo "用法: $0 [backend|frontend|stop|status]"
            echo ""
            echo "  (无参数)   启动前后端 + mDNS"
            echo "  backend   仅启动后端"
            echo "  frontend  仅启动前端"
            echo "  stop      停止所有服务"
            echo "  status    查看运行状态"
            exit 1
            ;;
    esac
}

main "$@"
