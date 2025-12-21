import os
import logging
from logging.handlers import RotatingFileHandler
import mimetypes
import time
import re
import json
import chardet
import urllib.parse
from pathlib import Path
from flask import Flask, render_template, request, url_for, send_file, send_from_directory, Response, redirect, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

# 导入配置文件
import config


# 配置MIME类型
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/quicktime', '.mov')
mimetypes.add_type('video/x-matroska', '.mkv')
mimetypes.add_type('video/x-msvideo', '.avi')
mimetypes.add_type('text/plain', '.txt')
mimetypes.add_type('text/markdown', '.md')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('text/csv', '.csv')
mimetypes.add_type('application/xml', '.xml')

# 移动硬盘路径
MOBILE_HDD_PATH = "/Volumes/My Passport"  # 修改为您的移动硬盘路径
VIDEO_EXTENSIONS = {'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'mpeg', 'mpg', 'm4v', '3gp', '3g2', 'ogg', 'ogv', 'ts', 'mts', 'm2ts', 'vob', 'rm', 'rmvb', 'asf'}
TEXT_EXTENSIONS = {'txt', 'md', 'json', 'csv', 'xml', 'log', 'conf', 'ini', 'cfg', 'py', 'js', 'html', 'css'}
IMAGE_EXTENSIONS = {'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'}

# 初始化Flask应用
app = Flask(__name__)

# 文件上传配置
app.config['MAX_CONTENT_LENGTH'] = config.Config().MAX_CONTENT_LENGTH  # 使用config.py中的10GB限制
app.config['UPLOAD_FOLDER'] = '/tmp'  # 临时上传目录

# 启用CORS，允许所有来源的请求
CORS(app)

# 获取当前服务器IP的API端点
@app.route('/api/server_info', methods=['GET'])
def get_server_info():
    """获取服务器信息，包括当前IP地址"""
    import socket
    
    # 获取当前主机名
    hostname = socket.gethostname()
    
    # 获取当前IP地址
    try:
        # 创建一个UDP套接字连接到外部服务器，以获取当前网络接口的IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip_address = s.getsockname()[0]
        s.close()
    except Exception:
        # 如果无法连接到外部服务器，尝试获取本地IP
        ip_address = socket.gethostbyname(hostname)
    
    # 获取所有网络接口信息（可选，用于调试）
    interfaces = {}
    try:
        import subprocess
        result = subprocess.run(['ifconfig'], capture_output=True, text=True)
        interfaces['ifconfig_output'] = result.stdout
    except Exception:
        pass
    
    return jsonify({
        'hostname': hostname,
        'ip_address': ip_address,
        'interfaces': interfaces,
        'port': 3001,
        'message': '当前文件服务器的访问地址：http://localhost:8000 或 http://{}:8000'.format(ip_address)
    })

# 用户登录API
@app.route('/api/login', methods=['POST'])
def login():
    """用户登录验证"""
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400
        
        users = load_users()
        user = next((u for u in users if u['username'] == username and u['password'] == password), None)
        
        if user:
            # 生成新的token
            import time
            user_with_token = {
                **user,
                'token': f"{username}-token-{int(time.time())}"
            }
            return jsonify({'user': user_with_token})
        else:
            return jsonify({'error': '用户名或密码错误'}), 401
    except Exception as e:
        logger.error(f"登录失败: {e}")
        return jsonify({'error': '登录失败，请稍后重试'}), 500

# 获取用户列表API
@app.route('/api/users', methods=['GET'])
def get_users():
    """获取所有用户列表"""
    try:
        users = load_users()
        # 删除密码字段，避免泄露
        users_without_password = [{k: v for k, v in user.items() if k != 'password'} for user in users]
        return jsonify({'users': users_without_password})
    except Exception as e:
        logger.error(f"获取用户列表失败: {e}")
        return jsonify({'error': '获取用户列表失败'}), 500

# 添加用户API
@app.route('/api/users', methods=['POST'])
def add_user():
    """添加新用户"""
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        is_admin = data.get('isAdmin', False)
        permissions = data.get('permissions', [])
        
        if not username or not password:
            return jsonify({'error': '用户名和密码不能为空'}), 400
        
        users = load_users()
        
        # 检查用户名是否已存在
        if any(u['username'] == username for u in users):
            return jsonify({'error': '用户名已存在'}), 400
        
        # 创建新用户
        new_user = {
            'id': max(u['id'] for u in users) + 1 if users else 1,
            'username': username,
            'password': password,
            'isAdmin': is_admin,
            'permissions': permissions,
            'token': f"{username}-token-{int(time.time())}"
        }
        
        users.append(new_user)
        if save_users(users):
            # 返回不含密码的用户信息
            user_without_password = {k: v for k, v in new_user.items() if k != 'password'}
            return jsonify({'user': user_without_password}), 201
        else:
            return jsonify({'error': '保存用户失败'}), 500
    except Exception as e:
        logger.error(f"添加用户失败: {e}")
        return jsonify({'error': '添加用户失败'}), 500

# 编辑用户API
@app.route('/api/users/<int:user_id>', methods=['PUT'])
def edit_user(user_id):
    """编辑现有用户"""
    try:
        data = request.get_json()
        users = load_users()
        
        # 查找要编辑的用户
        user_index = next((i for i, u in enumerate(users) if u['id'] == user_id), None)
        if user_index is None:
            return jsonify({'error': '用户不存在'}), 404
        
        # 更新用户信息
        user = users[user_index]
        if 'username' in data:
            user['username'] = data['username']
        if 'password' in data and data['password']:
            user['password'] = data['password']
        if 'isAdmin' in data:
            user['isAdmin'] = data['isAdmin']
        if 'permissions' in data:
            user['permissions'] = data['permissions']
        
        # 更新token
        import time
        user['token'] = f"{user['username']}-token-{int(time.time())}"
        
        users[user_index] = user
        if save_users(users):
            # 返回不含密码的用户信息
            user_without_password = {k: v for k, v in user.items() if k != 'password'}
            return jsonify({'user': user_without_password})
        else:
            return jsonify({'error': '保存用户失败'}), 500
    except Exception as e:
        logger.error(f"编辑用户失败: {e}")
        return jsonify({'error': '编辑用户失败'}), 500

# 删除用户API
@app.route('/api/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    """删除现有用户"""
    try:
        users = load_users()
        
        # 检查用户是否存在
        user = next((u for u in users if u['id'] == user_id), None)
        if not user:
            return jsonify({'error': '用户不存在'}), 404
        
        # 不允许删除最后一个管理员
        admin_users = [u for u in users if u['isAdmin']]
        if len(admin_users) == 1 and admin_users[0]['id'] == user_id:
            return jsonify({'error': '不能删除最后一个管理员'}), 400
        
        # 删除用户
        users = [u for u in users if u['id'] != user_id]
        if save_users(users):
            return jsonify({'success': True})
        else:
            return jsonify({'error': '删除用户失败'}), 500
    except Exception as e:
        logger.error(f"删除用户失败: {e}")
        return jsonify({'error': '删除用户失败'}), 500

# 配置日志
logger = logging.getLogger('FilePreviewServer')
logger.setLevel(logging.WARNING)  # 设置为DEBUG级别以便调试

# 控制台日志处理器
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logger.addHandler(console_handler)

# 用户数据存储文件路径
USERS_FILE_PATH = Path(__file__).parent / "users.json"

# 收藏数据存储文件路径
FAVORITES_FILE_PATH = Path(__file__).parent / "favorites.json"

# 加载用户数据
def load_users():
    """从JSON文件加载用户数据"""
    try:
        if USERS_FILE_PATH.exists():
            with open(USERS_FILE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f).get('users', [])
        return []
    except Exception as e:
        logger.error(f"加载用户数据失败: {e}")
        return []

# 保存用户数据
def save_users(users):
    """将用户数据保存到JSON文件"""
    try:
        with open(USERS_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump({'users': users}, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"保存用户数据失败: {e}")
        return False

# 加载收藏数据
def load_favorites():
    """从JSON文件加载收藏数据"""
    try:
        if FAVORITES_FILE_PATH.exists():
            with open(FAVORITES_FILE_PATH, 'r', encoding='utf-8') as f:
                return json.load(f).get('favorites', [])
        return []
    except Exception as e:
        logger.error(f"加载收藏数据失败: {e}")
        return []

# 保存收藏数据
def save_favorites(favorites):
    """将收藏数据保存到JSON文件"""
    try:
        with open(FAVORITES_FILE_PATH, 'w', encoding='utf-8') as f:
            json.dump({'favorites': favorites}, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"保存收藏数据失败: {e}")
        return False

# 简单的认证装饰器
from functools import wraps

def get_username_from_token(token):
    """从token中提取用户名（token格式：username-token-timestamp）"""
    if not token or not isinstance(token, str) or '-token' not in token:
        return None
    return token.split('-token')[0]

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        # 从Authorization头获取token
        auth = request.headers.get('Authorization')
        token = None
        
        if auth:
            # 简单的token验证（实际项目中应该使用JWT或其他安全机制）
            token = auth.split(' ')[1] if len(auth.split(' ')) > 1 else auth
        else:
            # 从URL参数获取token（用于新窗口预览）
            token = request.args.get('token')
        
        if not token:
            return jsonify({'error': '认证失败：未提供token'}), 401
        
        # 简化的token验证（实际项目中应该使用JWT或其他安全机制）
        # 只要token不为空且格式符合预期（如包含'-token'），就允许访问
        # 这种方式允许前端动态生成token
        if not token or not isinstance(token, str) or '-token' not in token:
            return jsonify({'error': '认证失败：无效的token格式'}), 401
        
        return f(*args, **kwargs)
    return decorated

# 文件夹配置路径
FOLDER_CONFIG_PATH = Path(MOBILE_HDD_PATH) / ".folder_config.json"

def natural_sort_key(s):
    """
    自然排序键函数
    将字符串拆分为数字和非数字部分，数字部分转换为整数
    """
    return [int(text) if text.isdigit() else text.lower()
            for text in re.split(r'(\d+)', s)]

def load_folder_config():
    """加载文件夹显示/隐藏配置"""
    config = {
        "hidden_folders": [],
        "hidden_files": [],
        "hidden_extensions": [],
        "show_hidden": False,
        "show_config_files": False
    }

    try:
        if FOLDER_CONFIG_PATH.exists():
            with open(FOLDER_CONFIG_PATH, 'r') as f:
                content = f.read()
                if content.strip():  # 检查内容是否为空
                    config.update(json.loads(content))
                else:
                    logger.warning("文件夹配置文件为空，使用默认配置")
    except Exception as e:
        logger.error(f"加载文件夹配置失败: {e}")

    return config


def save_folder_config(config):
    """保存文件夹显示/隐藏配置"""
    try:
        # 确保父目录存在
        FOLDER_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

        with open(FOLDER_CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        logger.error(f"保存文件夹配置失败: {e}")


def detect_encoding(file_path):
    """更可靠的编码检测函数"""
    try:
        # 读取文件的前10KB来检测编码
        with open(file_path, 'rb') as f:
            raw_data = f.read(10000)

        # 使用chardet检测编码
        result = chardet.detect(raw_data)
        encoding = result['encoding']
        confidence = result['confidence']

        # 如果置信度低，尝试使用常见编码
        if confidence < 0.7:
            # 尝试常见中文编码
            for enc in ['gb2312', 'gbk', 'gb18030', 'big5', 'utf-8']:
                try:
                    # 尝试用该编码解码
                    raw_data.decode(enc)
                    return enc
                except:
                    continue

            # 尝试其他常见编码
            for enc in ['latin1', 'iso-8859-1', 'cp1252']:
                try:
                    raw_data.decode(enc)
                    return enc
                except:
                    continue

        return encoding or 'gb2312'  # 默认使用GB2312
    except Exception as e:
        logger.error(f"检测文件编码失败: {e}")
        return 'gb2312'  # 默认使用GB2312


# 缓存字典，用于存储目录的文件列表，格式：{directory_path: (timestamp, files_list)}
file_cache = {}

# 定义要隐藏的文件列表（移到函数外部，避免重复定义）
HIDDEN_FILES = [
    '.DS_Store', 'Thumbs.db', 'desktop.ini',
    '.folder_config.json', '.gitignore', '.htaccess'
]

# 缓存有效期，单位：秒
CACHE_DURATION = 30

# 通用路径处理和缓存检查函数
def process_directory(directory):
    """处理目录路径和缓存检查的通用函数"""
    base_path = Path(MOBILE_HDD_PATH)
    current_time = time.time()
    
    # 安全处理目录路径
    safe_directory = urllib.parse.unquote(directory)
    full_path = base_path / safe_directory
    cache_key = str(full_path)

    logger.debug(f"扫描目录: {full_path}")

    if not full_path.exists() or not full_path.is_dir():
        logger.warning(f"目录不存在或不是文件夹: {full_path}")
        return None, current_time, cache_key

    return full_path, current_time, cache_key

def get_files(directory='', sort_by='name', sort_order='asc'):
    """获取指定目录中的文件（视频和文本）并排序（优化版）"""
    try:
        # 使用通用目录处理函数
        full_path, current_time, cache_key = process_directory(directory)
        base_path = Path(MOBILE_HDD_PATH)  # 定义base_path变量
        
        if not full_path:
            return []

        # 检查缓存是否有效
        if cache_key in file_cache:
            cached_time, cached_files = file_cache[cache_key]
            if current_time - cached_time < CACHE_DURATION:
                logger.debug(f"使用缓存的文件列表，目录: {cache_key}")
                # 对缓存的文件进行排序后返回
                return sort_items(cached_files.copy(), sort_by, sort_order)

        files = []
        config = load_folder_config()

        # 使用os.scandir()代替Path.iterdir()，更高效
        with os.scandir(full_path) as entries:
            for entry in entries:
                if entry.is_file():
                    file_name = entry.name
                    # 获取文件扩展名（小写，不带点）
                    file_ext = os.path.splitext(file_name)[1].lower()[1:] if '.' in file_name else ''

                    # 跳过隐藏文件和配置文件
                    if not config['show_config_files']:
                        if file_name in HIDDEN_FILES or file_name.startswith('.'):
                            continue

                    # 跳过特定扩展名的文件
                    if file_ext in config['hidden_extensions']:
                        continue

                    # 跳过特定文件
                    if file_name in config['hidden_files']:
                        continue

                    # 检查是否是视频文件、文本文件或图片文件
                    if file_ext in VIDEO_EXTENSIONS or file_ext in TEXT_EXTENSIONS or file_ext in IMAGE_EXTENSIONS:
                        # 使用原始路径
                        rel_path = str(Path(entry.path).relative_to(base_path))

                        # 安全编码路径
                        safe_rel_path = urllib.parse.quote(rel_path)

                        # 获取文件信息
                        stat = entry.stat(follow_symlinks=False)
                        file_size = stat.st_size
                        modified_time = stat.st_mtime

                        # 确定文件类型
                        file_type = 'other'
                        if file_ext in VIDEO_EXTENSIONS:
                            file_type = 'video'
                        elif file_ext in TEXT_EXTENSIONS:
                            file_type = 'text'
                        elif file_ext in IMAGE_EXTENSIONS:
                            file_type = 'image'

                        files.append({
                            'name': file_name,
                            'size': file_size,
                            'path': rel_path,
                            'modified': modified_time,
                            'url': url_for('serve_file', filename=safe_rel_path),
                            'preview_url': url_for('preview_file',
                                                filename=safe_rel_path) if file_type == 'video' else \
                                            url_for('preview_text', filename=safe_rel_path) if file_type == 'text' else \
                                            url_for('serve_file', filename=safe_rel_path),
                            'type': file_type
                        })

        # 将结果存入缓存
        file_cache[cache_key] = (current_time, files.copy())

        # 排序处理
        files = sort_items(files, sort_by, sort_order)

        logger.debug(f"找到 {len(files)} 个文件")
        return files
    except Exception as e:
        logger.error(f"获取文件失败: {e}")
        return []


# 缓存字典，用于存储目录的文件夹列表，格式：{directory_path: (timestamp, folders_list)}
folder_cache = {}

# 定义要隐藏的文件夹列表（移到函数外部，避免重复定义）
HIDDEN_FOLDERS = [
    '.git', '.svn', '.idea', '.vscode', '__pycache__',
    'node_modules', 'vendor', 'cache', 'logs'
]

def get_folders(directory='', sort_by='name', sort_order='asc'):
    """获取指定目录中的文件夹并排序（优化版）"""
    try:
        # 使用通用目录处理函数
        full_path, current_time, cache_key = process_directory(directory)
        base_path = Path(MOBILE_HDD_PATH)  # 定义base_path变量
        
        if not full_path:
            return []

        # 检查缓存是否有效
        if cache_key in folder_cache:
            cached_time, cached_folders = folder_cache[cache_key]
            if current_time - cached_time < CACHE_DURATION:
                logger.debug(f"使用缓存的文件夹列表，目录: {cache_key}")
                # 对缓存的文件夹进行排序后返回
                return sort_items(cached_folders.copy(), sort_by, sort_order)

        folders = []
        config = load_folder_config()

        # 使用os.scandir()代替Path.iterdir()，更高效
        with os.scandir(full_path) as entries:
            for entry in entries:
                if entry.is_dir():
                    folder_name = entry.name
                    folder_path = str(Path(entry.path).relative_to(base_path))

                    # 跳过隐藏文件夹
                    if not config['show_hidden']:
                        if folder_name in HIDDEN_FOLDERS or folder_name.startswith('.'):
                            continue

                    # 跳过特定文件夹
                    if folder_path in config['hidden_folders']:
                        continue

                    hidden = folder_path in config['hidden_folders']

                    # 安全编码路径
                    safe_folder_path = urllib.parse.quote(folder_path)

                    # 为每个文件夹生成一个唯一的颜色标识
                    import hashlib
                    # 使用文件夹路径生成稳定的哈希值，确保相同文件夹始终显示相同的颜色
                    folder_hash = hashlib.md5(folder_path.encode()).hexdigest()
                    color_hue = int(folder_hash[:6], 16) % 360
                    folder_color = f'hsl({color_hue}, 70%, 60%)'
                    
                    # 所有文件夹使用相同的图标
                    folder_icon = 'fa-folder'
                    
                    # 获取修改时间（使用entry.stat(follow_symlinks=False)避免跟随符号链接）
                    try:
                        stat_info = entry.stat(follow_symlinks=False)
                        modified_time = stat_info.st_mtime
                    except Exception as e:
                        logger.warning(f"获取文件夹{folder_path}修改时间失败: {e}")
                        modified_time = 0

                    folders.append({
                        'name': folder_name,
                        'path': folder_path,
                        'safe_path': safe_folder_path,
                        'modified': modified_time,
                        'hidden': hidden,
                        'size': 0,  # 文件夹大小设为0
                        'type': 'folder',
                        'color': folder_color,
                        'icon': folder_icon
                    })

        # 将结果存入缓存
        folder_cache[cache_key] = (current_time, folders.copy())

        # 排序处理
        folders = sort_items(folders, sort_by, sort_order)

        logger.debug(f"找到 {len(folders)} 个文件夹")
        return folders
    except Exception as e:
        logger.error(f"获取文件夹失败: {e}")
        return []


def sort_items(items, sort_by='name', sort_order='asc'):
    """通用排序函数"""
    if not items:
        return items

    # 确定排序键
    if sort_by == 'name':
        # 使用自然排序
        key_func = lambda x: natural_sort_key(x['name'])
    elif sort_by == 'modified':
        key_func = lambda x: x['modified']
    elif sort_by == 'size':
        key_func = lambda x: x['size']
    elif sort_by == 'type':
        key_func = lambda x: x['type']
    else:
        key_func = lambda x: natural_sort_key(x['name'])  # 默认按名称

    # 执行排序
    sorted_items = sorted(items, key=key_func, reverse=(sort_order == 'desc'))

    return sorted_items


@app.template_filter('format_size')
def format_size(size_bytes):
    """字节大小转可读格式"""
    if size_bytes >= 1024 ** 3:  # GB
        return f"{size_bytes / (1024 ** 3):.1f} GB"
    elif size_bytes >= 1024 ** 2:  # MB
        return f"{size_bytes / (1024 ** 2):.1f} MB"
    elif size_bytes >= 1024:  # KB
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes} B"


@app.template_filter('format_time')
def format_time(timestamp, fmt=None):
    """时间戳转可读格式"""
    if fmt:
        return time.strftime(fmt, time.localtime(timestamp))
    return time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(timestamp))


@app.route('/')
def index():
    """主页面 - 直接返回前端构建后的index.html文件"""
    return send_from_directory('frontend/dist', 'index.html')


@app.route('/files')
@require_auth
def redirect_files():
    """Redirect /files to homepage to fix 404 on refresh"""
    return redirect(url_for('index'))

@app.route('/api/files')
@require_auth
def api_files():
    """API端点 - 获取文件和文件夹列表"""
    try:
        current_dir = request.args.get('dir', '')
        logger.debug(f"当前目录参数: {current_dir}")

        # 获取排序参数
        sort_by = request.args.get('sort_by', 'name')  # 默认按名称排序
        sort_order = request.args.get('sort_order', 'asc')  # 默认升序

        # 解码当前目录参数
        decoded_current_dir = urllib.parse.unquote(current_dir)
        logger.debug(f"解码后的目录: {decoded_current_dir}")

        # 获取文件和文件夹（带排序参数）
        files = get_files(decoded_current_dir, sort_by=sort_by, sort_order=sort_order)
        folders = get_folders(decoded_current_dir, sort_by=sort_by, sort_order=sort_order)

        parent_dir = None
        if decoded_current_dir:
            # 安全处理父目录路径
            parent_path = Path(decoded_current_dir).parent
            parent_dir = str(parent_path) if str(parent_path) != '.' else ''
            # 安全编码父目录路径
            parent_dir = urllib.parse.quote(parent_dir) if parent_dir else ''

        # 加载配置
        config = load_folder_config()

        # 计算当前时间
        current_time = int(time.time())

        return jsonify({
            'files': files,
            'folders': folders,
            'current_dir': current_dir,
            'parent_dir': parent_dir,
            'now': current_time,
            'show_hidden': config['show_hidden'],
            'sort_by': sort_by,
            'sort_order': sort_order
        })
    except Exception as e:
        logger.error(f"API请求失败: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/toggle_hidden', methods=['POST'])
@require_auth
def toggle_hidden():
    """切换显示隐藏文件夹"""
    config = load_folder_config()
    config['show_hidden'] = not config['show_hidden']
    save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/hide_folder', methods=['POST'])
@require_auth
def hide_folder():
    """隐藏特定文件夹"""
    folder_path = request.form.get('folder_path')
    config = load_folder_config()

    if folder_path and folder_path not in config['hidden_folders']:
        config['hidden_folders'].append(folder_path)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/unhide_folder', methods=['POST'])
@require_auth
def unhide_folder():
    """取消隐藏特定文件夹"""
    folder_path = request.form.get('folder_path')
    config = load_folder_config()

    if folder_path and folder_path in config['hidden_folders']:
        config['hidden_folders'].remove(folder_path)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/preview/<path:filename>')
@require_auth
def preview_file(filename):
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    # 获取文件扩展名
    file_ext = file_path.suffix.lower()[1:]  # 移除点号并转为小写

    # 检查文件类型
    if file_ext in VIDEO_EXTENSIONS:
        # 视频文件，使用视频预览模板
        
        # 解码文件名，用于显示
        decoded_filename = urllib.parse.unquote(filename)
        
        # 获取文件路径对象，用于获取文件名
        file_path = Path(decoded_filename)
        
        # 获取父目录，用于返回按钮
        parent_dir = os.path.dirname(decoded_filename)
        safe_parent_dir = urllib.parse.quote(parent_dir) if parent_dir else ''

        # 编码文件名用于URL
        encoded_filename = urllib.parse.quote(decoded_filename)
        
        # 获取完整的HTTP视频链接，确保使用正确的主机名
        # 使用request.host来获取当前请求的主机名和端口
        base_url = f"http://{request.host}"
        
        # 获取token参数，确保在URL中包含token用于认证
        token = request.args.get('token')
        
        # 创建视频URL，包含token参数用于认证
        video_url = f"{base_url}/video/{encoded_filename}?token={token}"

        # 创建VLC协议URL
        vlc_protocol_url = f"vlc://{video_url}"
        
        # 获取token参数
        token = request.args.get('token')
        
        return render_template(
            'video_preview.html',
            video_filename=encoded_filename,
            video_title=file_path.name,
            video_url=url_for('serve_video', filename=encoded_filename, _external=True),
            parent_dir=safe_parent_dir,
            vlc_protocol_url=vlc_protocol_url,
            token=token  # 传递token参数给模板
        )
    elif file_ext in TEXT_EXTENSIONS:
        # 文本文件，使用文本预览模板
        return preview_text(filename)
    else:
        # 其他类型文件，返回404
        return "不支持的文件类型", 404

@app.route('/vlc_redirect/<path:filename>')
@require_auth
def vlc_redirect(filename):
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename

    if not file_path.exists():
        return "文件或目录不存在", 404

    # 获取完整的HTTP视频链接，确保使用正确的主机名
    base_url = f"http://{request.host}"
    
    # 获取token参数，确保在URL中包含token用于认证
    token = request.args.get('token')
    
    # 单个文件处理
    encoded_filename = urllib.parse.quote(decoded_filename)
    video_url = f"{base_url}/video/{encoded_filename}?token={token}"
    
    # 创建VLC协议URL，使用vlc://前缀来确保系统调用VLC播放器
    vlc_protocol_url = f"vlc://{video_url}"
    
    return render_template(
        'vlc_redirect.html',
        vlc_url=vlc_protocol_url
    )




@app.route('/api/preview_text/<path:filename>')
@require_auth
def api_preview_text(filename):
    """API端点，返回文本文件的预览内容（JSON格式）"""
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename

    if not file_path.exists() or not file_path.is_file():
        return jsonify({'error': '文件不存在'}), 404

    # 获取文件大小
    file_size = os.path.getsize(file_path)

    # 检测文件编码
    encoding = detect_encoding(file_path)

    # 尝试读取文件内容
    content = ""
    error_message = ""
    try:
        # 优先使用GB2312编码
        if encoding.lower() in ['gb2312', 'gbk', 'gb18030']:
            encoding = 'gb2312'

        with open(file_path, 'r', encoding=encoding, errors='replace') as f:
            # 根据文件大小决定读取策略
            if file_size > 500 * 1024:  # 大于500KB
                # 只读取前500KB
                content = f.read(500 * 1024)
                content += "\n\n[文件过大，只显示前500KB内容]"
            else:
                # 读取完整内容
                content = f.read()
    except UnicodeDecodeError:
        # 如果解码失败，尝试使用二进制模式读取
        try:
            with open(file_path, 'rb') as f:
                binary_data = f.read(500 * 1024)
                # 尝试转换为字符串，替换无法解码的字符
                content = binary_data.decode('gb2312', errors='replace')
                error_message = "警告：文件包含无法解码的字符，部分内容可能显示不正确"
        except Exception as e:
            content = f"无法读取文件: {str(e)}"
    except Exception as e:
        content = f"无法读取文件: {str(e)}"

    # 获取父目录和文件扩展名
    parent_dir = os.path.dirname(decoded_filename)
    file_ext = file_path.suffix.lower()[1:] if file_path.suffix else 'txt'

    # 获取文件信息
    file_mtime = os.path.getmtime(file_path)
    formatted_mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(file_mtime))

    return jsonify({
        'filename': filename,
        'file_title': file_path.name,
        'file_path': decoded_filename,
        'content': content,
        'parent_dir': parent_dir,
        'file_ext': file_ext,
        'encoding': encoding,
        'error_message': error_message,
        'file_size': file_size,
        'formatted_mtime': formatted_mtime
    })

@app.route('/preview_text/<path:filename>')
@require_auth
def preview_text(filename):
    """文本预览页面 - 针对GB2312优化"""
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename

    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    # 获取文件大小
    file_size = os.path.getsize(file_path)

    # 检测文件编码
    encoding = detect_encoding(file_path)

    # 尝试读取文件内容
    content = ""
    error_message = ""
    try:
        # 优先使用GB2312编码
        if encoding.lower() in ['gb2312', 'gbk', 'gb18030']:
            encoding = 'gb2312'

        with open(file_path, 'r', encoding=encoding, errors='replace') as f:
            # 根据文件大小决定读取策略
            if file_size > 500 * 1024:  # 大于500KB
                # 只读取前500KB
                content = f.read(500 * 1024)
                content += "\n\n[文件过大，只显示前500KB内容]"
            else:
                # 读取完整内容
                content = f.read()
    except UnicodeDecodeError:
        # 如果解码失败，尝试使用二进制模式读取
        try:
            with open(file_path, 'rb') as f:
                binary_data = f.read(500 * 1024)
                # 尝试转换为字符串，替换无法解码的字符
                content = binary_data.decode('gb2312', errors='replace')
                error_message = "警告：文件包含无法解码的字符，部分内容可能显示不正确"
        except Exception as e:
            content = f"无法读取文件: {str(e)}"
    except Exception as e:
        content = f"无法读取文件: {str(e)}"

    # 获取父目录和文件扩展名
    parent_dir = os.path.dirname(decoded_filename)
    file_ext = file_path.suffix.lower()[1:] if file_path.suffix else 'txt'
    safe_parent_dir = urllib.parse.quote(parent_dir) if parent_dir else ''
    
    # 获取token参数
    token = request.args.get('token')
    
    return render_template(
        'text_preview.html',
        filename=filename,
        file_title=file_path.name,
        file_path=decoded_filename,  # 添加文件路径参数
        content=content,
        parent_dir=safe_parent_dir,
        file_ext=file_ext,
        encoding=encoding,
        error_message=error_message,
        file_size=file_size,
        token=token  # 传递token参数给模板
    )


@app.route('/video/<path:filename>')
@require_auth
def serve_video(filename):
    """视频流服务"""
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename
    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    file_ext = file_path.suffix.lower()[1:] if file_path.suffix else ''

    # 处理视频文件的字节范围请求
    if file_ext in VIDEO_EXTENSIONS:
        range_header = request.headers.get('Range', None)
        file_size = os.path.getsize(file_path)

        if range_header:
            match = re.search(r'bytes=(\d+)-(\d+)?', range_header)

            if match:
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else file_size - 1
                length = end - start + 1

                # 创建部分响应
                def generate():
                    with open(file_path, 'rb') as f:
                        f.seek(start)
                        remaining = length
                        while remaining > 0:
                            # 增加缓冲块大小以提高大文件处理性能
                            chunk_size = min(1024 * 1024, remaining)  # 使用1MB缓冲
                            data = f.read(chunk_size)
                            if not data:
                                break
                            remaining -= len(data)
                            yield data

                response = app.response_class(
                    generate(),
                    status=206,
                    mimetype=mimetypes.guess_type(file_path)[0],
                    direct_passthrough=True
                )
                response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
                response.headers['Content-Length'] = str(length)
                response.headers['Accept-Ranges'] = 'bytes'
                return response

    # 完整文件响应
    return send_file(
        str(file_path),
        mimetype=mimetypes.guess_type(file_path)[0],
        as_attachment=False,
        conditional=True
    )


@app.route('/file/<path:filename>')
@require_auth
def serve_file(filename):
    """通用文件服务"""
    # 文件名已经是URL编码格式
    decoded_filename = urllib.parse.unquote(filename)
    file_path = Path(MOBILE_HDD_PATH) / decoded_filename
    if not file_path.exists() or not file_path.is_file():
        return "文件不存在", 404

    # 设置下载文件名
    download_name = file_path.name
    
    # 获取文件MIME类型
    mime_type, _ = mimetypes.guess_type(file_path)
    
    # 对于视频和图片文件，直接在浏览器中预览
    if mime_type and (mime_type.startswith('video/') or mime_type.startswith('image/')):
        return send_file(
            str(file_path),
            as_attachment=False,
            download_name=download_name,
            conditional=True
        )
    # 其他文件类型作为附件下载
    else:
        return send_file(
            str(file_path),
            as_attachment=True,
            download_name=download_name,
            conditional=True
        )


@app.route('/static/<path:path>')
def serve_static(path):
    """静态文件服务"""
    return send_from_directory('static', path)

# 处理前端构建后的静态文件，不需要认证
@app.route('/<path:path>')
def serve_frontend_files(path):
    """服务前端构建后的静态文件"""
    # 检查请求的文件是否存在于前端构建目录
    import os
    frontend_dist_path = os.path.join(os.getcwd(), 'frontend', 'dist')
    requested_file_path = os.path.join(frontend_dist_path, path)
    
    if os.path.exists(requested_file_path) and os.path.isfile(requested_file_path):
        return send_from_directory('frontend/dist', path)
    # 如果文件不存在，返回404
    return "File not found", 404

# 服务前端首页，不需要认证
@app.route('/')
def serve_frontend_index():
    """服务前端首页"""
    return send_from_directory('frontend/dist', 'index.html')


@app.route('/toggle_config_files', methods=['POST'])
@require_auth
def toggle_config_files():
    """切换显示配置文件"""
    config = load_folder_config()
    config['show_config_files'] = not config['show_config_files']
    save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/hide_file', methods=['POST'])
@require_auth
def hide_file():
    """隐藏特定文件"""
    file_path = request.form.get('file_path')
    config = load_folder_config()

    if file_path and file_path not in config['hidden_files']:
        config['hidden_files'].append(file_path)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/unhide_file', methods=['POST'])
@require_auth
def unhide_file():
    """取消隐藏特定文件"""
    file_path = request.form.get('file_path')
    config = load_folder_config()

    if file_path and file_path in config['hidden_files']:
        config['hidden_files'].remove(file_path)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/hide_extension', methods=['POST'])
@require_auth
def hide_extension():
    """隐藏特定扩展名"""
    extension = request.form.get('extension')
    config = load_folder_config()

    if extension and extension not in config['hidden_extensions']:
        config['hidden_extensions'].append(extension)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/unhide_extension', methods=['POST'])
@require_auth
def unhide_extension():
    """取消隐藏特定扩展名"""
    extension = request.form.get('extension')
    config = load_folder_config()

    if extension and extension in config['hidden_extensions']:
        config['hidden_extensions'].remove(extension)
        save_folder_config(config)

    # 重定向回当前页面
    current_dir = request.form.get('current_dir', '')
    return redirect(url_for('index', dir=current_dir))


@app.route('/api/upload', methods=['POST'])
@require_auth
def upload_file():
    """API端点 - 上传文件"""
    try:
        # 检查是否有文件被上传
        if 'file' not in request.files:
            return jsonify({'error': '没有文件被上传'}), 400
        
        file = request.files['file']
        
        # 检查文件名是否为空
        if file.filename == '':
            return jsonify({'error': '没有选择文件'}), 400
        
        # 获取目标目录
        target_dir = request.form.get('dir', '')
        decoded_target_dir = urllib.parse.unquote(target_dir)
        
        # 构建完整的保存路径
        base_path = Path(MOBILE_HDD_PATH)
        save_path = base_path / decoded_target_dir
        
        # 确保保存路径存在且是一个目录
        if not save_path.exists() or not save_path.is_dir():
            return jsonify({'error': '目标目录不存在'}), 400
        
        # 直接使用原始文件名（支持中文），但要确保路径安全
        filename = file.filename
        full_save_path = save_path / filename
        
        # 避免文件名冲突
        if full_save_path.exists():
            # 使用序号方式处理文件名冲突（如"image(1).jpg"）
            file_ext = Path(filename).suffix
            file_name = Path(filename).stem
            counter = 1
            
            # 检查是否已经有序号
            match = re.match(r'^(.*?)_?\((\d+)\)$', file_name)
            if match:
                file_name = match.group(1)
                counter = int(match.group(2)) + 1
            
            # 寻找可用的文件名
            while True:
                new_filename = f"{file_name}({counter}){file_ext}"
                new_full_save_path = save_path / new_filename
                if not new_full_save_path.exists():
                    filename = new_filename
                    full_save_path = new_full_save_path
                    break
                counter += 1
        
        # 保存文件
        file.save(str(full_save_path))
        
        logger.info(f"文件上传成功: {full_save_path}")
        
        # 清除该目录的缓存，确保下次请求能获取到新文件
        cache_key = str(save_path)
        if cache_key in file_cache:
            del file_cache[cache_key]
        
        return jsonify({
            'success': True,
            'message': '文件上传成功',
            'filename': filename,
            'path': f"{target_dir}/{filename}"
        })
        
    except Exception as e:
        logger.error(f"文件上传失败: {e}")
        return jsonify({'error': str(e)}), 500

# API端点 - 获取用户收藏列表
@app.route('/api/favorites', methods=['GET'])
@require_auth
def get_favorites():
    """获取用户的收藏列表"""
    try:
        # 从Authorization头获取token
        auth = request.headers.get('Authorization')
        token = auth.split(' ')[1] if len(auth.split(' ')) > 1 else auth
        username = get_username_from_token(token)
        
        if not username:
            return jsonify({'error': '无效的token格式'}), 401
        
        # 加载收藏数据
        favorites = load_favorites()
        
        # 筛选当前用户的收藏
        user_favorites = [fav for fav in favorites if fav['username'] == username]
        
        return jsonify({'favorites': user_favorites})
    except Exception as e:
        logger.error(f"获取收藏列表失败: {e}")
        return jsonify({'error': '获取收藏列表失败'}), 500

# API端点 - 添加收藏
@app.route('/api/favorites', methods=['POST'])
@require_auth
def add_favorite():
    """添加收藏"""
    try:
        # 从Authorization头获取token
        auth = request.headers.get('Authorization')
        token = auth.split(' ')[1] if len(auth.split(' ')) > 1 else auth
        username = get_username_from_token(token)
        
        if not username:
            return jsonify({'error': '无效的token格式'}), 401
        
        # 获取请求数据
        data = request.get_json()
        file_path = data.get('path')
        file_name = data.get('name')
        file_type = data.get('type')
        file_size = data.get('size')
        modified_time = data.get('modified')
        
        if not file_path or not file_name:
            return jsonify({'error': '文件路径和文件名不能为空'}), 400
        
        # 加载收藏数据
        favorites = load_favorites()
        
        # 检查是否已存在该收藏
        existing_fav = next((f for f in favorites if f['username'] == username and f['path'] == file_path), None)
        if existing_fav:
            return jsonify({'message': '该文件已在收藏列表中'}), 200
        
        # 创建新收藏
        new_favorite = {
            'id': max(f['id'] for f in favorites) + 1 if favorites else 1,
            'username': username,
            'path': file_path,
            'name': file_name,
            'type': file_type,
            'size': file_size,
            'modified': modified_time,
            'created_at': int(time.time())
        }
        
        # 添加到收藏列表
        favorites.append(new_favorite)
        
        # 保存收藏数据
        if save_favorites(favorites):
            return jsonify({'favorite': new_favorite}), 201
        else:
            return jsonify({'error': '保存收藏失败'}), 500
    except Exception as e:
        logger.error(f"添加收藏失败: {e}")
        return jsonify({'error': '添加收藏失败'}), 500

# API端点 - 删除收藏
@app.route('/api/favorites/<int:favorite_id>', methods=['DELETE'])
@require_auth
def delete_favorite(favorite_id):
    """删除收藏"""
    try:
        # 从Authorization头获取token
        auth = request.headers.get('Authorization')
        token = auth.split(' ')[1] if len(auth.split(' ')) > 1 else auth
        username = get_username_from_token(token)
        
        if not username:
            return jsonify({'error': '无效的token格式'}), 401
        
        # 加载收藏数据
        favorites = load_favorites()
        
        # 查找当前用户的指定收藏
        favorite_index = next((i for i, f in enumerate(favorites) if f['id'] == favorite_id and f['username'] == username), None)
        
        if favorite_index is None:
            return jsonify({'error': '收藏不存在或无权操作'}), 404
        
        # 删除收藏
        deleted_favorite = favorites.pop(favorite_index)
        
        # 保存收藏数据
        if save_favorites(favorites):
            return jsonify({'favorite': deleted_favorite})
        else:
            return jsonify({'error': '删除收藏失败'}), 500
    except Exception as e:
        logger.error(f"删除收藏失败: {e}")
        return jsonify({'error': '删除收藏失败'}), 500

# API端点 - 删除指定文件的收藏
@app.route('/api/favorites/delete_by_path', methods=['DELETE'])
@require_auth
def delete_favorite_by_path():
    """根据文件路径删除收藏"""
    try:
        # 从Authorization头获取token
        auth = request.headers.get('Authorization')
        token = auth.split(' ')[1] if len(auth.split(' ')) > 1 else auth
        username = get_username_from_token(token)
        
        if not username:
            return jsonify({'error': '无效的token格式'}), 401
        
        # 获取请求数据
        data = request.get_json()
        file_path = data.get('path')
        
        if not file_path:
            return jsonify({'error': '文件路径不能为空'}), 400
        
        # 加载收藏数据
        favorites = load_favorites()
        
        # 查找当前用户的指定路径的收藏
        favorite_index = next((i for i, f in enumerate(favorites) if f['path'] == file_path and f['username'] == username), None)
        
        if favorite_index is None:
            return jsonify({'error': '收藏不存在或无权操作'}), 404
        
        # 删除收藏
        deleted_favorite = favorites.pop(favorite_index)
        
        # 保存收藏数据
        if save_favorites(favorites):
            return jsonify({'favorite': deleted_favorite})
        else:
            return jsonify({'error': '删除收藏失败'}), 500
    except Exception as e:
        logger.error(f"根据路径删除收藏失败: {e}")
        return jsonify({'error': '根据路径删除收藏失败'}), 500


if __name__ == '__main__':
    # 初始化文件夹配置文件
    if not FOLDER_CONFIG_PATH.exists():
        save_folder_config(load_folder_config())
    
    # 获取本机IP地址的更可靠方法
    import socket
    import subprocess
    
    hostname = socket.gethostname()
    
    # 尝试获取局域网IP地址的多种方法
    ip_address = None
    
    # 方法1: 使用UDP套接字连接外部服务器获取当前网络接口IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip_address = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    
    # 方法2: 如果方法1失败，尝试使用ifconfig命令获取IP地址
    if not ip_address:
        try:
            result = subprocess.run(['ifconfig'], capture_output=True, text=True)
            import re
            ip_matches = re.findall(r'inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask', result.stdout)
            for ip in ip_matches:
                if not ip.startswith('127.'):
                    ip_address = ip
                    break
        except Exception:
            pass
    
    # 方法3: 如果以上方法都失败，使用传统方法
    if not ip_address:
        ip_address = socket.gethostbyname(hostname)
    
    # 显示启动信息和所有可访问地址
    print("=========================================")
    print("文件预览服务器正在运行...")
    print("=========================================")
    print(f"📁 文件目录: {MOBILE_HDD_PATH}")
    print()
    print("📱 可访问地址列表：")
    print(f"   本地访问：http://localhost:8000")
    print(f"   局域网访问：http://{ip_address}:8000")
    print(f"   mDNS访问：http://{hostname}.local:8000")
    print()
    print("🔗 前端访问地址：")
    print(f"   本地访问：http://localhost:3001")
    print(f"   局域网访问：http://{ip_address}:3001")
    print(f"   mDNS访问：http://{hostname}.local:3001")
    print()
    print("=========================================")
    print()
    
    # 启动Flask应用服务器
    app.run(host='0.0.0.0', port=8000, debug=False)

