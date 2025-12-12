import os
from pathlib import Path

# 获取外接移动硬盘路径
MOBILE_HDD_PATH = "/Volumes/My Passport"  # 修改为您的移动硬盘路径
USE_MOBILE_HDD = True  # 是否使用移动硬盘


class Config:
    def __init__(self):
        # 设置基础目录（使用当前脚本所在目录）
        self.BASE_DIR = os.path.dirname(os.path.abspath(__file__))

        # 上传目录和日志文件
        self.UPLOAD_FOLDER = os.path.join(self.BASE_DIR, "FileServerUploads")
        self.LOG_FILE = os.path.join(self.BASE_DIR, "file_server.log")

        # 确保目录存在
        os.makedirs(self.UPLOAD_FOLDER, exist_ok=True)

        # 服务器配置
        self.PORT = 8000
        self.HOST = '0.0.0.0'  # 允许局域网访问
        self.DEBUG = True
        self.ALLOWED_EXTENSIONS = {
            'mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav',
            'jpg', 'jpeg', 'png', 'gif', 'bmp', 'txt', 'pdf',
            'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
        }
        self.MAX_CONTENT_LENGTH = 10 * 1024 * 1024 * 1024  # 10GB
        self.VIDEO_EXTENSIONS = {'mp4', 'mkv', 'avi', 'mov', 'webm'}

        print(f"文件服务器配置: 使用目录 {self.UPLOAD_FOLDER}")





# 创建配置实例
config = Config()