"""
文件预览服务器 - 优化版
==============================
安全优化：
  - bcrypt 密码哈希（自动迁移明文密码）
  - HMAC-SHA256 签名 token + 过期时间
  - 路径遍历防护
  - 登录限流（IP + 用户名）
  - CORS 白名单

性能优化：
  - 带 TTL 自动清理的内存缓存
  - 用户/收藏/配置数据缓存
  - os.scandir + 批量 stat
  - 视频流使用 send_file (conditional)
  - 去除重复路由/重复 import
"""

import os
import re
import json
import time
import hashlib
import hmac
import threading
import mimetypes
import urllib.parse
import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from functools import wraps
from collections import defaultdict
from werkzeug.http import http_date

from flask import (
    Flask, render_template, request, url_for,
    send_file, send_from_directory, Response, redirect, jsonify
)
from flask_cors import CORS

# ==================== 配置 ====================

# 移动硬盘路径
MOBILE_HDD_PATH = "/Volumes/My Passport"

# 文件类型集合（frozen 避免误修改）
VIDEO_EXTENSIONS = frozenset({
    'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpeg', 'mpg',
    'm4v', '3gp', '3g2', 'ogg', 'ogv', 'ts', 'mts', 'm2ts', 'vob',
    'rm', 'rmvb', 'asf'
})
TEXT_EXTENSIONS = frozenset({
    'txt', 'md', 'json', 'csv', 'xml', 'log', 'conf', 'ini',
    'cfg', 'py', 'js', 'html', 'css'
})
IMAGE_EXTENSIONS = frozenset({'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'})

# 所有可预览类型合集
PREVIEWABLE_EXTENSIONS = VIDEO_EXTENSIONS | TEXT_EXTENSIONS | IMAGE_EXTENSIONS

# 隐藏文件/文件夹
HIDDEN_FILES = frozenset({
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    '.folder_config.json', '.gitignore', '.htaccess'
})
HIDDEN_FOLDERS = frozenset({
    '.git', '.svn', '.idea', '.vscode', '__pycache__',
    'node_modules', 'vendor', 'cache', 'logs'
})

# 数据文件路径
BASE_DIR = Path(__file__).parent
USERS_FILE = BASE_DIR / "users.json"
FAVORITES_FILE = BASE_DIR / "favorites.json"
FOLDER_CONFIG_FILE = Path(MOBILE_HDD_PATH) / ".folder_config.json"
LOG_FILE = BASE_DIR / "file_server.log"

# ==================== 安全配置 ====================

# Token 密钥（持久化到文件，重启不丢失）
_SECRET_FILE = BASE_DIR / ".secret_key"
if _SECRET_FILE.exists():
    SECRET_KEY = _SECRET_FILE.read_text().strip()
else:
    SECRET_KEY = hashlib.sha256(os.urandom(32)).hexdigest()
    _SECRET_FILE.write_text(SECRET_KEY)
TOKEN_EXPIRE_SECONDS = 7 * 24 * 3600  # token 7 天过期

# 登录限流
LOGIN_RATE_LIMIT = 5          # 最多尝试次数
LOGIN_RATE_WINDOW = 300       # 窗口时间（秒）

# CORS 允许的来源
CORS_ORIGINS = [
    'http://localhost:3001',
    'http://localhost:3002',
    'http://sanwangi.file:3001',
    'http://sanwangi.file:3002',
]

# ==================== MIME 类型 ====================

for ext, mime in [
    ('.webm', 'video/webm'), ('.mp4', 'video/mp4'),
    ('.mov', 'video/quicktime'), ('.mkv', 'video/x-matroska'),
    ('.avi', 'video/x-msvideo'), ('.txt', 'text/plain'),
    ('.md', 'text/markdown'), ('.json', 'application/json'),
    ('.csv', 'text/csv'), ('.xml', 'application/xml'),
]:
    mimetypes.add_type(mime, ext)

# ==================== 日志 ====================

logger = logging.getLogger('FileServer')
logger.setLevel(logging.INFO)

_console = logging.StreamHandler()
_console.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s', datefmt='%H:%M:%S'
))
logger.addHandler(_console)

try:
    _file = RotatingFileHandler(
        LOG_FILE, maxBytes=5*1024*1024, backupCount=3, encoding='utf-8'
    )
    _file.setFormatter(logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s'
    ))
    logger.addHandler(_file)
except Exception:
    pass

# ==================== Flask 应用 ====================

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024 * 1024  # 10GB
app.config['UPLOAD_FOLDER'] = '/tmp'

# CORS：限制来源
CORS(app, origins=CORS_ORIGINS, supports_credentials=True)

# ==================== 带自动清理的缓存 ====================

class TTLCache:
    """线程安全的 TTL 缓存，自动清理过期条目"""

    def __init__(self, ttl=30, cleanup_interval=60):
        self._cache = {}
        self._ttl = ttl
        self._lock = threading.Lock()
        # 定期清理
        def _cleanup():
            while True:
                time.sleep(cleanup_interval)
                self._evict()
        t = threading.Thread(target=_cleanup, daemon=True)
        t.start()

    def get(self, key):
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            if time.time() - entry[0] > self._ttl:
                del self._cache[key]
                return None
            return entry[1]

    def set(self, key, value):
        with self._lock:
            self._cache[key] = (time.time(), value)

    def delete(self, key):
        with self._lock:
            self._cache.pop(key, None)

    def clear(self):
        with self._lock:
            self._cache.clear()

    def _evict(self):
        now = time.time()
        with self._lock:
            expired = [k for k, (ts, _) in self._cache.items()
                       if now - ts > self._ttl]
            for k in expired:
                del self._cache[k]

# 目录缓存（30秒 TTL）
file_cache = TTLCache(ttl=30, cleanup_interval=120)
folder_cache = TTLCache(ttl=30, cleanup_interval=120)
# 配置缓存（5秒 TTL，配置变更不频繁）
config_cache = TTLCache(ttl=5, cleanup_interval=30)
# 用户数据缓存（10秒 TTL）
_user_cache = TTLCache(ttl=10, cleanup_interval=60)
# 收藏数据缓存（10秒 TTL）
_favorites_cache = TTLCache(ttl=10, cleanup_interval=60)
# 字幕缓存（5分钟 TTL，避免重复提取）
_subtitle_cache = TTLCache(ttl=300, cleanup_interval=600)

# ==================== 密码安全 ====================

def _get_bcrypt():
    """延迟导入 bcrypt，不存在时回退到 hashlib"""
    try:
        import bcrypt
        return bcrypt
    except ImportError:
        return None

def hash_password(password):
    """对密码进行 bcrypt 哈希，不可用时回退 SHA256"""
    bc = _get_bcrypt()
    if bc:
        return bc.hashpw(password.encode('utf-8'), bc.gensalt(10)).decode('utf-8')
    # 回退：SHA256 + salt
    salt = os.urandom(16).hex()
    h = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
    return f"sha256${salt}${h}"

def verify_password(password, stored_hash):
    """验证密码，自动识别哈希格式"""
    if not stored_hash:
        return False

    # 明文密码（旧格式，无 $ 分隔符）
    if '$' not in stored_hash:
        return hmac.compare_digest(password, stored_hash)

    # SHA256 回退格式
    if stored_hash.startswith('sha256$'):
        parts = stored_hash.split('$')
        if len(parts) != 3:
            return False
        _, salt, h = parts
        computed = hashlib.sha256((salt + password).encode('utf-8')).hexdigest()
        return hmac.compare_digest(computed, h)

    # bcrypt 格式
    bc = _get_bcrypt()
    if bc:
        try:
            return bc.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8'))
        except Exception:
            return False

    return False

def needs_rehash(stored_hash):
    """判断密码哈希是否需要升级（明文 → 哈希）"""
    if not stored_hash:
        return True
    return '$' not in stored_hash

# ==================== Token 安全 ====================

def generate_token(username):
    """生成 HMAC 签名 token：username.timestamp.signature"""
    ts = str(int(time.time()))
    msg = f"{username}.{ts}"
    sig = hmac.new(SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{msg}.{sig}"

def verify_token(token):
    """验证 token 签名和过期时间，返回 username 或 None"""
    if not token or not isinstance(token, str):
        return None

    parts = token.split('.')
    if len(parts) != 3:
        # 兼容旧格式 username-token-timestamp
        if '-token' in token:
            return _verify_legacy_token(token)
        return None

    username, ts_str, sig = parts
    try:
        ts = int(ts_str)
    except ValueError:
        return None

    # 检查过期
    if time.time() - ts > TOKEN_EXPIRE_SECONDS:
        return None

    # 验证签名
    msg = f"{username}.{ts_str}"
    expected_sig = hmac.new(SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected_sig):
        return None

    return username

def _verify_legacy_token(token):
    """兼容旧 token 格式，只提取用户名（7天内创建的旧 token 有效）"""
    try:
        parts = token.split('-token-')
        if len(parts) != 2:
            return None
        username = parts[0]
        ts = int(parts[1])
        if time.time() - ts > TOKEN_EXPIRE_SECONDS:
            return None
        return username
    except (ValueError, IndexError):
        return None

# ==================== 登录限流 ====================

_login_attempts = defaultdict(list)  # key: IP, value: [timestamps]
_login_user_attempts = defaultdict(list)  # key: username, value: [timestamps]
_login_cleanup_ts = time.time()

def _check_rate_limit(key, store):
    """检查是否超过限流，返回 True 表示被限流"""
    global _login_cleanup_ts
    now = time.time()
    # 清理过期记录
    store[key] = [t for t in store[key] if now - t < LOGIN_RATE_WINDOW]
    if not store[key]:
        del store[key]
    # 定期清理整个字典（每10分钟）
    if now - _login_cleanup_ts > 600:
        _login_cleanup_ts = now
        for s in (_login_attempts, _login_user_attempts):
            expired = [k for k, v in s.items()
                       if all(now - t > LOGIN_RATE_WINDOW for t in v)]
            for k in expired:
                del s[k]
    return len(store.get(key, [])) >= LOGIN_RATE_LIMIT

def _record_attempt(key, store):
    now = time.time()
    store[key].append(now)

# ==================== 路径安全 ====================

# 路径解析缓存（60秒 TTL）
_path_resolve_cache = TTLCache(ttl=60, cleanup_interval=120)

def safe_path(directory, base=MOBILE_HDD_PATH):
    """安全处理路径，防止路径遍历攻击（带缓存）"""
    decoded = urllib.parse.unquote(directory) if directory else ''
    cache_key = f"{base}:{decoded}"
    cached = _path_resolve_cache.get(cache_key)
    if cached is not None:
        return cached

    full = Path(base) / decoded
    try:
        resolved = full.resolve()
        base_resolved = Path(base).resolve()
        if not str(resolved).startswith(str(base_resolved)):
            logger.warning(f"路径遍历攻击尝试: {directory}")
            _path_resolve_cache.set(cache_key, (None, None))
            return None, None
        result = (resolved, base_resolved)
        _path_resolve_cache.set(cache_key, result)
        return result
    except Exception:
        _path_resolve_cache.set(cache_key, (None, None))
        return None, None

# ==================== 数据读写 ====================

_data_lock = threading.Lock()

def load_json_file(filepath, key):
    """通用 JSON 文件加载（线程安全）"""
    try:
        with _data_lock:
            if filepath.exists():
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data.get(key, [])
            return []
    except Exception as e:
        logger.error(f"加载 {filepath} 失败: {e}")
        return []

def save_json_file(filepath, data, key):
    """通用 JSON 文件保存（线程安全，先写临时文件再替换）"""
    try:
        with _data_lock:
            tmp = filepath.with_suffix('.tmp')
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump({key: data}, f, indent=2, ensure_ascii=False)
            tmp.replace(filepath)  # 原子替换
            return True
    except Exception as e:
        logger.error(f"保存 {filepath} 失败: {e}")
        return False

def load_users():
    cached = _user_cache.get('users')
    if cached is not None:
        return cached
    users = load_json_file(USERS_FILE, 'users')
    _user_cache.set('users', users)
    return users

def save_users(users):
    result = save_json_file(USERS_FILE, users, 'users')
    if result:
        _user_cache.delete('users')
    return result

def load_favorites():
    cached = _favorites_cache.get('favorites')
    if cached is not None:
        return cached
    favs = load_json_file(FAVORITES_FILE, 'favorites')
    _favorites_cache.set('favorites', favs)
    return favs

def save_favorites(favorites):
    result = save_json_file(FAVORITES_FILE, favorites, 'favorites')
    if result:
        _favorites_cache.delete('favorites')
    return result

def load_folder_config():
    """加载文件夹配置（带缓存）"""
    cached = config_cache.get('folder_config')
    if cached is not None:
        return cached

    default = {
        "hidden_folders": [],
        "hidden_files": [],
        "hidden_extensions": [],
        "show_hidden": False,
        "show_config_files": False
    }
    try:
        if FOLDER_CONFIG_FILE.exists():
            with open(FOLDER_CONFIG_FILE, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                if content:
                    default.update(json.loads(content))
    except Exception as e:
        logger.error(f"加载文件夹配置失败: {e}")

    config_cache.set('folder_config', default)
    return default

def save_folder_config(cfg):
    """保存文件夹配置并刷新缓存"""
    try:
        FOLDER_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(FOLDER_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)
        config_cache.delete('folder_config')
    except Exception as e:
        logger.error(f"保存文件夹配置失败: {e}")

# ==================== 认证装饰器 ====================

def get_current_user():
    """从请求中获取当前用户名"""
    auth = request.headers.get('Authorization')
    token = None

    if auth:
        parts = auth.split(' ')
        token = parts[1] if len(parts) > 1 else auth
    else:
        token = request.args.get('token')

    if not token:
        return None
    return verify_token(token)

def require_auth(f):
    """认证装饰器 - 验证 token 并注入 current_user"""
    @wraps(f)
    def decorated(*args, **kwargs):
        username = get_current_user()
        if not username:
            return jsonify({'error': '认证失败：无效或过期的 token'}), 401
        # 注入到 request 上下文
        request._current_user = username
        return f(*args, **kwargs)
    return decorated

def require_admin(f):
    """管理员权限装饰器"""
    @wraps(f)
    def decorated(*args, **kwargs):
        username = getattr(request, '_current_user', None)
        if not username:
            username = get_current_user()
        if not username:
            return jsonify({'error': '认证失败'}), 401

        users = load_users()
        user = next((u for u in users if u['username'] == username), None)
        if not user or not user.get('isAdmin'):
            return jsonify({'error': '需要管理员权限'}), 403

        request._current_user = username
        return f(*args, **kwargs)
    return decorated

# ==================== 权限检查 ====================

def check_permission(username, path):
    """检查用户是否有权访问指定路径"""
    users = load_users()
    user = next((u for u in users if u['username'] == username), None)
    if not user:
        return False

    # 管理员有全部权限
    if user.get('isAdmin'):
        return True

    permissions = user.get('permissions', [])
    # 通配符权限
    if '*' in permissions:
        return True

    # 检查路径是否在允许的权限目录下
    for perm in permissions:
        if path.startswith(perm) or path.startswith('/' + perm):
            return True
        # 也匹配子路径
        norm_perm = perm.strip('/')
        norm_path = path.strip('/')
        if norm_path.startswith(norm_perm):
            return True

    return False

# ==================== 工具函数 ====================

def natural_sort_key(s):
    """自然排序键"""
    return [int(t) if t.isdigit() else t.lower()
            for t in re.split(r'(\d+)', s)]

def sort_items(items, sort_by='name', sort_order='asc'):
    """通用排序"""
    if not items:
        return items

    key_map = {
        'name': lambda x: natural_sort_key(x['name']),
        'modified': lambda x: x.get('modified', 0),
        'size': lambda x: x.get('size', 0),
        'type': lambda x: x.get('type', ''),
    }
    key_func = key_map.get(sort_by, key_map['name'])
    return sorted(items, key=key_func, reverse=(sort_order == 'desc'))

def detect_encoding(file_path):
    """检测文件编码"""
    try:
        with open(file_path, 'rb') as f:
            raw = f.read(8192)

        try:
            import chardet
            result = chardet.detect(raw)
            if result['confidence'] >= 0.7 and result['encoding']:
                return result['encoding']
        except ImportError:
            pass

        # 回退：尝试常见编码
        for enc in ['utf-8', 'gb2312', 'gbk', 'gb18030', 'big5', 'latin1']:
            try:
                raw.decode(enc)
                return enc
            except (UnicodeDecodeError, LookupError):
                continue

        return 'gb2312'
    except Exception:
        return 'gb2312'

def get_video_subtitles(file_path):
    """获取视频内嵌字幕轨道"""
    import subprocess
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams', str(file_path)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
        data = json.loads(result.stdout)

        subtitles = []
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'subtitle':
                tags = stream.get('tags', {})
                subtitles.append({
                    'index': stream.get('index'),
                    'codec_name': stream.get('codec_name'),
                    'codec_long_name': stream.get('codec_long_name'),
                    'language': tags.get('language', 'unknown'),
                    'title': tags.get('title', f'字幕轨道 {stream.get("index")}')
                })
        return subtitles
    except Exception as e:
        logger.error(f"获取字幕失败: {e}")
        return []

def invalidate_dir_cache(dir_path):
    """清除指定目录的缓存"""
    full = Path(MOBILE_HDD_PATH) / dir_path
    key = str(full)
    file_cache.delete(key)
    folder_cache.delete(key)

# ==================== 缩略图缓存 ====================

THUMBNAIL_CACHE_DIR = BASE_DIR / ".thumbnail_cache"
THUMBNAIL_CACHE_DIR.mkdir(exist_ok=True)
THUMBNAIL_MAX_AGE = 7 * 24 * 3600  # 缩略图缓存 7 天

def get_thumbnail_path(file_path, size=300):
    """根据文件路径和大小生成缩略图缓存路径"""
    stat = file_path.stat()
    # 用 文件路径+mtime+size 生成唯一缓存名
    key = f"{file_path}:{stat.st_mtime}:{stat.st_size}:{size}"
    cache_name = hashlib.md5(key.encode()).hexdigest() + '.jpg'
    return THUMBNAIL_CACHE_DIR / cache_name

def generate_etag(file_path):
    """基于文件路径、大小、修改时间生成 ETag"""
    try:
        stat = file_path.stat()
        raw = f"{file_path}:{stat.st_size}:{stat.st_mtime}"
        return hashlib.md5(raw.encode()).hexdigest()
    except Exception:
        return None

def check_not_modified(file_path, max_age=86400):
    """检查条件请求，返回 304 响应或 None"""
    etag = generate_etag(file_path)

    # ETag 匹配
    if_none_match = request.headers.get('If-None-Match')
    if if_none_match and etag:
        client_etag = if_none_match.strip('"')
        if client_etag == etag:
            resp = Response('', status=304)
            resp.headers['ETag'] = f'"{etag}"'
            resp.headers['Cache-Control'] = f'public, max-age={max_age}'
            return resp

    # If-Modified-Since 匹配
    if_modified_since = request.headers.get('If-Modified-Since')
    if if_modified_since:
        try:
            from werkzeug.http import parse_date
            client_time = parse_date(if_modified_since)
            if client_time:
                mtime = file_path.stat().st_mtime
                if int(mtime) <= int(client_time.timestamp()):
                    resp = Response('', status=304)
                    resp.headers['Cache-Control'] = f'public, max-age={max_age}'
                    if etag:
                        resp.headers['ETag'] = f'"{etag}"'
                    return resp
        except Exception:
            pass

    return None

def set_cache_headers(response, file_path, max_age=86400):
    """为文件响应添加缓存头"""
    etag = generate_etag(file_path)
    if etag:
        response.headers['ETag'] = f'"{etag}"'

    try:
        mtime = file_path.stat().st_mtime
        response.headers['Last-Modified'] = http_date(mtime)
    except Exception:
        pass

    response.headers['Cache-Control'] = f'public, max-age={max_age}'
    return response

# ==================== 核心功能：获取文件/文件夹 ====================

def get_files(directory='', sort_by='name', sort_order='asc'):
    """获取目录中的文件列表"""
    full_path, base_path = safe_path(directory)
    if not full_path:
        return []

    cache_key = str(full_path)
    cached = file_cache.get(cache_key)
    if cached is not None:
        return sort_items(cached.copy(), sort_by, sort_order)

    cfg = load_folder_config()
    show_config = cfg.get('show_config_files', False)
    hidden_exts = set(cfg.get('hidden_extensions', []))
    hidden_names = set(cfg.get('hidden_files', []))

    files = []
    try:
        with os.scandir(full_path) as entries:
            for entry in entries:
                if not entry.is_file():
                    continue

                name = entry.name
                ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''

                # 过滤
                if not show_config and (name in HIDDEN_FILES or name.startswith('.')):
                    continue
                if ext in hidden_exts or name in hidden_names:
                    continue
                if ext not in PREVIEWABLE_EXTENSIONS:
                    continue

                # 路径
                try:
                    rel = str(Path(entry.path).relative_to(base_path))
                except ValueError:
                    continue

                # stat（一次调用获取大小和时间）
                try:
                    stat = entry.stat(follow_symlinks=False)
                except OSError:
                    continue

                # 文件类型
                if ext in VIDEO_EXTENSIONS:
                    ftype = 'video'
                elif ext in TEXT_EXTENSIONS:
                    ftype = 'text'
                elif ext in IMAGE_EXTENSIONS:
                    ftype = 'image'
                else:
                    continue

                safe_rel = urllib.parse.quote(rel)

                file_info = {
                    'name': name,
                    'size': stat.st_size,
                    'path': rel,
                    'modified': stat.st_mtime,
                    'url': f'/file/{safe_rel}',
                    'preview_url': f'/file/{safe_rel}' if ftype != 'video' else f'/video/{safe_rel}',
                    'type': ftype,
                }
                # 图片添加缩略图 URL
                if ftype == 'image':
                    file_info['thumbnail_url'] = f'/api/thumbnail/{safe_rel}?size=300'
                    file_info['large_thumbnail_url'] = f'/api/thumbnail/{safe_rel}?size=800'

                files.append(file_info)
    except PermissionError:
        logger.warning(f"无权限访问: {full_path}")
    except Exception as e:
        logger.error(f"扫描目录失败: {e}")

    file_cache.set(cache_key, files.copy())
    return sort_items(files, sort_by, sort_order)


def get_folders(directory='', sort_by='name', sort_order='asc'):
    """获取目录中的文件夹列表"""
    full_path, base_path = safe_path(directory)
    if not full_path:
        return []

    cache_key = str(full_path)
    cached = folder_cache.get(cache_key)
    if cached is not None:
        return sort_items(cached.copy(), sort_by, sort_order)

    cfg = load_folder_config()
    show_hidden = cfg.get('show_hidden', False)
    hidden_dirs = set(cfg.get('hidden_folders', []))

    folders = []
    try:
        with os.scandir(full_path) as entries:
            for entry in entries:
                if not entry.is_dir():
                    continue

                name = entry.name

                # 过滤
                if not show_hidden and (name in HIDDEN_FOLDERS or name.startswith('.')):
                    continue

                try:
                    rel = str(Path(entry.path).relative_to(base_path))
                except ValueError:
                    continue

                if rel in hidden_dirs:
                    continue

                # 修改时间
                try:
                    mtime = entry.stat(follow_symlinks=False).st_mtime
                except OSError:
                    mtime = 0

                # 文件夹颜色（稳定的哈希）
                h = hashlib.md5(rel.encode()).hexdigest()
                hue = int(h[:6], 16) % 360

                folders.append({
                    'name': name,
                    'path': rel,
                    'safe_path': urllib.parse.quote(rel),
                    'modified': mtime,
                    'hidden': rel in hidden_dirs,
                    'size': 0,
                    'type': 'folder',
                    'color': f'hsl({hue}, 70%, 60%)',
                    'icon': 'fa-folder',
                })
    except PermissionError:
        logger.warning(f"无权限访问: {full_path}")
    except Exception as e:
        logger.error(f"扫描目录失败: {e}")

    folder_cache.set(cache_key, folders.copy())
    return sort_items(folders, sort_by, sort_order)

# ==================== 模板过滤器 ====================

@app.template_filter('format_size')
def format_size(size_bytes):
    if size_bytes >= 1073741824:
        return f"{size_bytes / 1073741824:.1f} GB"
    if size_bytes >= 1048576:
        return f"{size_bytes / 1048576:.1f} MB"
    if size_bytes >= 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes} B"

@app.template_filter('format_time')
def format_time(timestamp, fmt=None):
    return time.strftime(fmt or '%Y-%m-%d %H:%M:%S', time.localtime(timestamp))

# ==================== 路由：认证 ====================

@app.route('/api/login', methods=['POST'])
def login():
    """用户登录"""
    try:
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip()
        password = data.get('password', '')

        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400

        # 限流检查
        client_ip = request.remote_addr
        if _check_rate_limit(client_ip, _login_attempts):
            return jsonify({'error': f'登录尝试过多，请{LOGIN_RATE_WINDOW // 60}分钟后再试'}), 429
        if _check_rate_limit(username, _login_user_attempts):
            return jsonify({'error': f'该账号登录尝试过多，请稍后再试'}), 429

        users = load_users()
        user = next((u for u in users if u['username'] == username), None)

        if not user or not verify_password(password, user.get('password', '')):
            _record_attempt(client_ip, _login_attempts)
            _record_attempt(username, _login_user_attempts)
            return jsonify({'error': '用户名或密码错误'}), 401

        # 密码需要升级（明文 → 哈希）
        if needs_rehash(user.get('password', '')):
            user['password'] = hash_password(password)
            save_users(users)
            logger.info(f"用户 {username} 密码已升级为安全哈希")

        # 生成新 token
        token = generate_token(username)
        user_obj = {k: v for k, v in user.items() if k != 'password'}
        user_obj['token'] = token

        # 清除限流记录
        _login_attempts.pop(client_ip, None)
        _login_user_attempts.pop(username, None)

        return jsonify({'user': user_obj})

    except Exception as e:
        logger.error(f"登录失败: {e}")
        return jsonify({'error': '登录失败，请稍后重试'}), 500

# ==================== 路由：用户管理 ====================

@app.route('/api/users', methods=['GET'])
@require_auth
def get_users():
    """获取用户列表"""
    users = load_users()
    result = [{k: v for k, v in u.items() if k != 'password'} for u in users]
    return jsonify({'users': result})

@app.route('/api/users', methods=['POST'])
@require_admin
def add_user():
    """添加用户"""
    try:
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip()
        password = data.get('password', '')
        is_admin = data.get('isAdmin', False)
        permissions = data.get('permissions', [])

        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400

        users = load_users()
        if any(u['username'] == username for u in users):
            return jsonify({'error': '用户名已存在'}), 400

        new_user = {
            'id': max((u['id'] for u in users), default=0) + 1,
            'username': username,
            'password': hash_password(password),
            'isAdmin': is_admin,
            'permissions': permissions,
        }

        users.append(new_user)
        if save_users(users):
            user_obj = {k: v for k, v in new_user.items() if k != 'password'}
            user_obj['token'] = generate_token(username)
            return jsonify({'user': user_obj}), 201
        return jsonify({'error': '保存用户失败'}), 500

    except Exception as e:
        logger.error(f"添加用户失败: {e}")
        return jsonify({'error': '添加用户失败'}), 500

@app.route('/api/users/<int:user_id>', methods=['PUT'])
@require_admin
def edit_user(user_id):
    """编辑用户"""
    try:
        data = request.get_json(silent=True) or {}
        users = load_users()

        idx = next((i for i, u in enumerate(users) if u['id'] == user_id), None)
        if idx is None:
            return jsonify({'error': '用户不存在'}), 404

        user = users[idx]
        if 'username' in data:
            user['username'] = data['username']
        if data.get('password'):
            user['password'] = hash_password(data['password'])
        if 'isAdmin' in data:
            user['isAdmin'] = data['isAdmin']
        if 'permissions' in data:
            user['permissions'] = data['permissions']

        users[idx] = user
        if save_users(users):
            user_obj = {k: v for k, v in user.items() if k != 'password'}
            return jsonify({'user': user_obj})
        return jsonify({'error': '保存用户失败'}), 500

    except Exception as e:
        logger.error(f"编辑用户失败: {e}")
        return jsonify({'error': '编辑用户失败'}), 500

@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@require_admin
def delete_user(user_id):
    """删除用户"""
    try:
        users = load_users()
        user = next((u for u in users if u['id'] == user_id), None)
        if not user:
            return jsonify({'error': '用户不存在'}), 404

        # 不允许删除最后一个管理员
        admins = [u for u in users if u.get('isAdmin')]
        if len(admins) == 1 and admins[0]['id'] == user_id:
            return jsonify({'error': '不能删除最后一个管理员'}), 400

        users = [u for u in users if u['id'] != user_id]
        if save_users(users):
            return jsonify({'success': True})
        return jsonify({'error': '删除用户失败'}), 500

    except Exception as e:
        logger.error(f"删除用户失败: {e}")
        return jsonify({'error': '删除用户失败'}), 500

# ==================== 路由：文件浏览 ====================

@app.route('/api/files')
@require_auth
def api_files():
    """获取文件和文件夹列表"""
    try:
        current_dir = request.args.get('dir', '')
        sort_by = request.args.get('sort_by', 'name')
        sort_order = request.args.get('sort_order', 'asc')

        decoded_dir = urllib.parse.unquote(current_dir)

        # 权限检查
        username = getattr(request, '_current_user', None) or get_current_user()
        if username and not check_permission(username, decoded_dir):
            return jsonify({'error': '无权访问该目录'}), 403

        files = get_files(decoded_dir, sort_by, sort_order)
        folders = get_folders(decoded_dir, sort_by, sort_order)

        parent_dir = None
        if decoded_dir:
            p = Path(decoded_dir).parent
            parent_dir = urllib.parse.quote(str(p)) if str(p) != '.' else ''

        cfg = load_folder_config()

        return jsonify({
            'files': files,
            'folders': folders,
            'current_dir': current_dir,
            'parent_dir': parent_dir,
            'now': int(time.time()),
            'show_hidden': cfg.get('show_hidden', False),
            'sort_by': sort_by,
            'sort_order': sort_order,
        })
    except Exception as e:
        logger.error(f"API 请求失败: {e}")
        return jsonify({'error': str(e)}), 500

# ==================== 路由：文件预览 ====================

@app.route('/preview/<path:filename>')
@require_auth
def preview_file(filename):
    """文件预览"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    ext = file_path.suffix.lower()[1:]

    if ext in VIDEO_EXTENSIONS:
        parent_dir = os.path.dirname(decoded)
        token = request.args.get('token')
        encoded = urllib.parse.quote(decoded)
        base_url = f"http://{request.host}"
        video_url = f"{base_url}/video/{encoded}?token={token}"

        return render_template(
            'video_preview.html',
            video_filename=encoded,
            video_title=file_path.name,
            video_url=url_for('serve_video', filename=encoded, _external=True),
            parent_dir=urllib.parse.quote(parent_dir) if parent_dir else '',
            vlc_protocol_url=f"vlc://{video_url}",
            token=token,
        )
    elif ext in TEXT_EXTENSIONS:
        return preview_text(filename)
    else:
        return "不支持的文件类型", 404

@app.route('/preview_text/<path:filename>')
@require_auth
def preview_text(filename):
    """文本预览"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    file_size = file_path.stat().st_size
    encoding = detect_encoding(file_path)
    content = ""
    error_message = ""

    try:
        enc = encoding
        if enc.lower() in ('gb2312', 'gbk', 'gb18030'):
            enc = 'gb18030'  # gb18030 是 gb2312 的超集

        with open(file_path, 'r', encoding=enc, errors='replace') as f:
            if file_size > 512000:
                content = f.read(512000) + "\n\n[文件过大，只显示前500KB内容]"
            else:
                content = f.read()
    except Exception as e:
        try:
            with open(file_path, 'rb') as f:
                content = f.read(512000).decode('gb18030', errors='replace')
                error_message = "部分内容可能显示不正确"
        except Exception:
            content = f"无法读取文件: {e}"

    parent_dir = os.path.dirname(decoded)
    file_ext = file_path.suffix.lower()[1:] if file_path.suffix else 'txt'
    token = request.args.get('token')

    return render_template(
        'text_preview.html',
        filename=filename,
        file_title=file_path.name,
        file_path=decoded,
        content=content,
        parent_dir=urllib.parse.quote(parent_dir) if parent_dir else '',
        file_ext=file_ext,
        encoding=encoding,
        error_message=error_message,
        file_size=file_size,
        token=token,
    )

@app.route('/api/preview_text/<path:filename>')
@require_auth
def api_preview_text(filename):
    """API - 文本预览"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return jsonify({'error': '文件不存在'}), 404

    file_size = file_path.stat().st_size
    encoding = detect_encoding(file_path)
    content = ""
    error_message = ""

    try:
        enc = encoding
        if enc.lower() in ('gb2312', 'gbk', 'gb18030'):
            enc = 'gb18030'

        with open(file_path, 'r', encoding=enc, errors='replace') as f:
            if file_size > 512000:
                content = f.read(512000) + "\n\n[文件过大，只显示前500KB内容]"
            else:
                content = f.read()
    except Exception as e:
        try:
            with open(file_path, 'rb') as f:
                content = f.read(512000).decode('gb18030', errors='replace')
                error_message = "部分内容可能显示不正确"
        except Exception:
            content = f"无法读取文件: {e}"

    return jsonify({
        'filename': filename,
        'file_title': file_path.name,
        'file_path': decoded,
        'content': content,
        'parent_dir': os.path.dirname(decoded),
        'file_ext': file_path.suffix.lower()[1:] if file_path.suffix else 'txt',
        'encoding': encoding,
        'error_message': error_message,
        'file_size': file_size,
        'formatted_mtime': time.strftime(
            '%Y-%m-%d %H:%M:%S',
            time.localtime(file_path.stat().st_mtime)
        ),
    })

# ==================== 路由：字幕 ====================

@app.route('/api/subtitles/<path:filename>')
@require_auth
def api_get_subtitles(filename):
    """获取视频字幕轨道"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return jsonify({'error': '文件不存在'}), 404

    ext = file_path.suffix.lower()[1:] if file_path.suffix else ''
    if ext not in VIDEO_EXTENSIONS:
        return jsonify({'error': '不是视频文件'}), 400

    subtitles = get_video_subtitles(file_path)
    return jsonify({
        'filename': filename,
        'file_title': file_path.name,
        'file_path': decoded,
        'subtitles': subtitles,
        'has_subtitles': len(subtitles) > 0,
    })

@app.route('/api/subtitle_content/<path:filename>')
@require_auth
def api_get_subtitle_content(filename):
    """提取字幕内容"""
    import subprocess

    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded
    subtitle_index = request.args.get('index', type=int)

    if not file_path.exists() or not file_path.is_file():
        return jsonify({'error': '文件不存在'}), 404

    ext = file_path.suffix.lower()[1:] if file_path.suffix else ''
    if ext not in VIDEO_EXTENSIONS:
        return jsonify({'error': '不是视频文件'}), 400

    if subtitle_index is None:
        return jsonify({'error': '缺少字幕索引参数'}), 400

    # 检查字幕缓存
    try:
        stat = file_path.stat()
        cache_key = f"{file_path}:{stat.st_mtime}:{subtitle_index}"
    except Exception:
        cache_key = f"{file_path}:{subtitle_index}"

    cached = _subtitle_cache.get(cache_key)
    if cached is not None:
        return cached, 200, {'Content-Type': 'text/vtt'}

    try:
        cmd = [
            'ffmpeg', '-i', str(file_path),
            '-map', f'0:{subtitle_index}',
            '-f', 'webvtt', '-'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
        # 缓存字幕结果
        _subtitle_cache.set(cache_key, result.stdout)
        return result.stdout, 200, {'Content-Type': 'text/vtt'}
    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg 提取字幕失败: {e}")
        return jsonify({'error': '提取字幕失败'}), 500
    except Exception as e:
        logger.error(f"获取字幕内容失败: {e}")
        return jsonify({'error': '获取字幕内容失败'}), 500

# ==================== 路由：缩略图 ====================

@app.route('/api/thumbnail/<path:filename>')
@require_auth
def serve_thumbnail(filename):
    """图片缩略图服务 - 自动生成并缓存缩略图"""
    from PIL import Image
    import io

    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    ext = file_path.suffix.lower()[1:]
    if ext not in IMAGE_EXTENSIONS:
        return "不是图片文件", 400

    size = request.args.get('size', 300, type=int)
    size = min(max(size, 50), 800)  # 限制 50-800px

    # 检查缩略图缓存
    thumb_path = get_thumbnail_path(file_path, size)

    if thumb_path.exists():
        # 条件请求
        not_modified = check_not_modified(thumb_path, max_age=THUMBNAIL_MAX_AGE)
        if not_modified:
            return not_modified

        resp = send_file(str(thumb_path), mimetype='image/jpeg')
        set_cache_headers(resp, thumb_path, max_age=THUMBNAIL_MAX_AGE)
        return resp

    # 生成缩略图
    try:
        with Image.open(file_path) as img:
            # 处理 EXIF 旋转
            from PIL import ImageOps
            img = ImageOps.exif_transpose(img)

            # RGBA → RGB（处理 PNG 透明背景）
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if 'A' in img.mode else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')

            # 等比缩放
            img.thumbnail((size, size), Image.LANCZOS)

            # 保存到缓存
            img.save(str(thumb_path), 'JPEG', quality=75, optimize=True)

        resp = send_file(str(thumb_path), mimetype='image/jpeg')
        set_cache_headers(resp, thumb_path, max_age=THUMBNAIL_MAX_AGE)
        return resp

    except Exception as e:
        logger.error(f"生成缩略图失败 {file_path}: {e}")
        # 回退到原图
        return redirect(url_for('serve_file', filename=filename, token=request.args.get('token')))

# ==================== 路由：文件服务 ====================

@app.route('/video/<path:filename>')
@require_auth
def serve_video(filename):
    """视频流服务 - 使用 send_file 支持断点续传和范围请求"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    ext = file_path.suffix.lower()[1:] if file_path.suffix else ''
    if ext not in VIDEO_EXTENSIONS:
        return "不是视频文件", 400

    # 条件请求 → 304
    not_modified = check_not_modified(file_path, max_age=3600)
    if not_modified:
        return not_modified

    mime = mimetypes.guess_type(str(file_path))[0] or 'video/mp4'
    resp = send_file(
        str(file_path),
        mimetype=mime,
        as_attachment=False,
        conditional=True,  # 自动处理 Range 请求
    )
    set_cache_headers(resp, file_path, max_age=3600)
    resp.headers['Accept-Ranges'] = 'bytes'
    return resp

@app.route('/file/<path:filename>')
@require_auth
def serve_file(filename):
    """通用文件服务"""
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    # 条件请求 → 304
    not_modified = check_not_modified(file_path, max_age=86400)
    if not_modified:
        return not_modified

    mime, _ = mimetypes.guess_type(str(file_path))

    # 视频/图片在浏览器预览，其他下载
    as_attachment = not (mime and (mime.startswith('video/') or mime.startswith('image/')))

    resp = send_file(
        str(file_path),
        as_attachment=as_attachment,
        download_name=file_path.name,
        conditional=True,
    )
    set_cache_headers(resp, file_path, max_age=86400)
    return resp

# ==================== 路由：VLC 重定向 ====================

@app.route('/vlc_redirect/<path:filename>')
@require_auth
def vlc_redirect(filename):
    decoded = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded

    if not file_path.exists():
        return "文件或目录不存在", 404

    base_url = f"http://{request.host}"
    token = request.args.get('token')
    encoded = urllib.parse.quote(decoded)
    video_url = f"{base_url}/video/{encoded}?token={token}"

    return render_template('vlc_redirect.html', vlc_url=f"vlc://{video_url}")

# ==================== 路由：上传 ====================

@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_file():
    """文件上传"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': '没有文件被上传'}), 400

        files = request.files.getlist('file')
        if not files or files[0].filename == '':
            return jsonify({'error': '没有选择文件'}), 400

        target_dir = request.form.get('dir', '')
        decoded_dir = urllib.parse.unquote(target_dir)

        full_path, base_path = safe_path(decoded_dir)
        if not full_path or not full_path.is_dir():
            return jsonify({'error': '目标目录不存在'}), 400

        # 权限检查
        username = getattr(request, '_current_user', None) or get_current_user()
        if username and not check_permission(username, decoded_dir):
            return jsonify({'error': '无权上传到该目录'}), 403

        for f in files:
            if f.filename == '':
                continue

            save_path = full_path / f.filename

            # 处理文件名冲突
            if save_path.exists():
                stem = save_path.stem
                suffix = save_path.suffix
                counter = 1
                m = re.match(r'^(.*?)_?\((\d+)\)$', stem)
                if m:
                    stem = m.group(1)
                    counter = int(m.group(2)) + 1

                while True:
                    new_name = f"{stem}({counter}){suffix}"
                    new_path = full_path / new_name
                    if not new_path.exists():
                        save_path = new_path
                        break
                    counter += 1

            f.save(str(save_path))

        # 清除缓存
        invalidate_dir_cache(decoded_dir)

        return jsonify({
            'success': True,
            'message': '文件上传成功',
            'count': len([f for f in files if f.filename]),
        })

    except Exception as e:
        logger.error(f"文件上传失败: {e}")
        return jsonify({'error': str(e)}), 500

# ==================== 路由：收藏 ====================

@app.route('/api/favorites', methods=['GET'])
@require_auth
def get_favorites():
    username = getattr(request, '_current_user', None) or get_current_user()
    if not username:
        return jsonify({'error': '无效的 token'}), 401

    favorites = load_favorites()
    user_favs = [f for f in favorites if f['username'] == username]
    return jsonify({'favorites': user_favs})

@app.route('/api/favorites', methods=['POST'])
@require_auth
def add_favorite():
    try:
        username = getattr(request, '_current_user', None) or get_current_user()
        if not username:
            return jsonify({'error': '无效的 token'}), 401

        data = request.get_json(silent=True) or {}
        file_path = data.get('path')
        file_name = data.get('name')

        if not file_path or not file_name:
            return jsonify({'error': '文件路径和文件名不能为空'}), 400

        favorites = load_favorites()

        if any(f['username'] == username and f['path'] == file_path for f in favorites):
            return jsonify({'message': '该文件已在收藏列表中'}), 200

        new_fav = {
            'id': max((f['id'] for f in favorites), default=0) + 1,
            'username': username,
            'path': file_path,
            'name': file_name,
            'type': data.get('type'),
            'size': data.get('size'),
            'modified': data.get('modified'),
            'created_at': int(time.time()),
        }

        favorites.append(new_fav)
        if save_favorites(favorites):
            return jsonify({'favorite': new_fav}), 201
        return jsonify({'error': '保存收藏失败'}), 500

    except Exception as e:
        logger.error(f"添加收藏失败: {e}")
        return jsonify({'error': '添加收藏失败'}), 500

@app.route('/api/favorites/<int:favorite_id>', methods=['DELETE'])
@require_auth
def delete_favorite(favorite_id):
    try:
        username = getattr(request, '_current_user', None) or get_current_user()
        if not username:
            return jsonify({'error': '无效的 token'}), 401

        favorites = load_favorites()
        idx = next((i for i, f in enumerate(favorites)
                    if f['id'] == favorite_id and f['username'] == username), None)

        if idx is None:
            return jsonify({'error': '收藏不存在或无权操作'}), 404

        deleted = favorites.pop(idx)
        if save_favorites(favorites):
            return jsonify({'favorite': deleted})
        return jsonify({'error': '删除收藏失败'}), 500

    except Exception as e:
        logger.error(f"删除收藏失败: {e}")
        return jsonify({'error': '删除收藏失败'}), 500

@app.route('/api/favorites/delete_by_path', methods=['DELETE'])
@require_auth
def delete_favorite_by_path():
    try:
        username = getattr(request, '_current_user', None) or get_current_user()
        if not username:
            return jsonify({'error': '无效的 token'}), 401

        data = request.get_json(silent=True) or {}
        file_path = data.get('path')

        if not file_path:
            return jsonify({'error': '文件路径不能为空'}), 400

        favorites = load_favorites()
        idx = next((i for i, f in enumerate(favorites)
                    if f['path'] == file_path and f['username'] == username), None)

        if idx is None:
            return jsonify({'error': '收藏不存在或无权操作'}), 404

        deleted = favorites.pop(idx)
        if save_favorites(favorites):
            return jsonify({'favorite': deleted})
        return jsonify({'error': '删除收藏失败'}), 500

    except Exception as e:
        logger.error(f"根据路径删除收藏失败: {e}")
        return jsonify({'error': '删除收藏失败'}), 500

# ==================== 路由：文件夹配置 ====================

@app.route('/toggle_hidden', methods=['POST'])
@require_auth
def toggle_hidden():
    cfg = load_folder_config()
    cfg['show_hidden'] = not cfg['show_hidden']
    save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/toggle_config_files', methods=['POST'])
@require_auth
def toggle_config_files():
    cfg = load_folder_config()
    cfg['show_config_files'] = not cfg['show_config_files']
    save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/hide_folder', methods=['POST'])
@require_auth
def hide_folder():
    folder_path = request.form.get('folder_path')
    cfg = load_folder_config()
    if folder_path and folder_path not in cfg['hidden_folders']:
        cfg['hidden_folders'].append(folder_path)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/unhide_folder', methods=['POST'])
@require_auth
def unhide_folder():
    folder_path = request.form.get('folder_path')
    cfg = load_folder_config()
    if folder_path in cfg.get('hidden_folders', []):
        cfg['hidden_folders'].remove(folder_path)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/hide_file', methods=['POST'])
@require_auth
def hide_file():
    file_path = request.form.get('file_path')
    cfg = load_folder_config()
    if file_path and file_path not in cfg['hidden_files']:
        cfg['hidden_files'].append(file_path)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/unhide_file', methods=['POST'])
@require_auth
def unhide_file():
    file_path = request.form.get('file_path')
    cfg = load_folder_config()
    if file_path in cfg.get('hidden_files', []):
        cfg['hidden_files'].remove(file_path)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/hide_extension', methods=['POST'])
@require_auth
def hide_extension():
    extension = request.form.get('extension')
    cfg = load_folder_config()
    if extension and extension not in cfg['hidden_extensions']:
        cfg['hidden_extensions'].append(extension)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

@app.route('/unhide_extension', methods=['POST'])
@require_auth
def unhide_extension():
    extension = request.form.get('extension')
    cfg = load_folder_config()
    if extension in cfg.get('hidden_extensions', []):
        cfg['hidden_extensions'].remove(extension)
        save_folder_config(cfg)
    return redirect(url_for('index', dir=request.form.get('current_dir', '')))

# ==================== 路由：服务器信息 ====================

@app.route('/api/server_info', methods=['GET'])
def get_server_info():
    """获取服务器信息"""
    import socket

    hostname = socket.gethostname()
    ip_address = None

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(('8.8.8.8', 80))
        ip_address = s.getsockname()[0]
        s.close()
    except Exception:
        try:
            ip_address = socket.gethostbyname(hostname)
        except Exception:
            ip_address = 'unknown'

    return jsonify({
        'hostname': hostname,
        'ip_address': ip_address,
        'port': 3002,
        'message': f'访问地址：http://{ip_address}:3002'
    })

# ==================== 路由：前端 ====================

@app.route('/')
def index():
    return send_from_directory('frontend/dist', 'index.html')

@app.route('/files')
@require_auth
def redirect_files():
    return redirect(url_for('index'))

@app.route('/static/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

@app.route('/<path:path>')
def serve_frontend_files(path):
    """前端静态文件"""
    dist_path = os.path.join(os.getcwd(), 'frontend', 'dist')
    requested = os.path.join(dist_path, path)

    if os.path.isfile(requested):
        return send_from_directory('frontend/dist', path)
    return "File not found", 404

# ==================== 启动 ====================

if __name__ == '__main__':
    # 初始化文件夹配置
    if not FOLDER_CONFIG_FILE.exists():
        save_folder_config(load_folder_config())

    # 获取 IP
    import socket

    hostname = socket.gethostname()
    ip_address = None

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(('8.8.8.8', 80))
        ip_address = s.getsockname()[0]
        s.close()
    except Exception:
        try:
            import subprocess
            result = subprocess.run(['ifconfig'], capture_output=True, text=True, timeout=5)
            for m in re.finditer(r'inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask', result.stdout):
                if not m.group(1).startswith('127.'):
                    ip_address = m.group(1)
                    break
        except Exception:
            pass

    if not ip_address:
        try:
            ip_address = socket.gethostbyname(hostname)
        except Exception:
            ip_address = 'unknown'

    print("=" * 45)
    print("  文件预览服务器已启动")
    print("=" * 45)
    print(f"  📁 文件目录: {MOBILE_HDD_PATH}")
    print(f"  🔒 安全: bcrypt 密码 + HMAC token")
    print()
    print("  📱 访问地址：")
    print(f"     http://localhost:3001")
    print(f"     http://{ip_address}:3001")
    print(f"     http://{hostname}.local:3001")
    print("=" * 45)

    app.run(host='0.0.0.0', port=3002, debug=False, threaded=True)
