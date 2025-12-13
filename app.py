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

# 配置日志
logger = logging.getLogger('FilePreviewServer')
logger.setLevel(logging.WARNING)  # 设置为DEBUG级别以便调试

# 控制台日志处理器
console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
logger.addHandler(console_handler)

# 简单的认证装饰器
from functools import wraps

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
@require_auth
def index():
    """主页面 - 显示文件列表"""
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

        return render_template(
            'index.html',
            files=files,
            folders=folders,
            current_dir=current_dir,
            parent_dir=parent_dir,
            now=current_time,
            show_hidden=config['show_hidden'],
            sort_by=sort_by,
            sort_order=sort_order,
            urllib=urllib  # 传递urllib模块到模板
        )
    except Exception as e:
        logger.error(f"主页面加载失败: {e}")
        # 使用简化的错误页面，避免模板错误
        return """
        <html>
            <head>
                <title>错误 - 文件预览服务器</title>
            </head>
            <body>
                <h1>页面加载失败</h1>
                <p>服务器遇到错误，请稍后再试。</p>
                <p><a href="/">返回首页</a></p>
            </body>
        </html>
        """


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
    # 创建VLC协议URL
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


if __name__ == '__main__':
    # 初始化文件夹配置文件
    if not FOLDER_CONFIG_PATH.exists():
        save_folder_config(load_folder_config())
    # 获取本机IP地址
    import socket

    hostname = socket.gethostname()
    ip_address = socket.gethostbyname(hostname)

    print(f"文件预览服务器正在运行...")
    print(f"请访问: http://localhost:8000")
    print(f"局域网访问: http://{ip_address}:8000")
    print(f"文件目录: {MOBILE_HDD_PATH}")

    # 启动服务器
    app.run(host='0.0.0.0', port=8000, debug=False)