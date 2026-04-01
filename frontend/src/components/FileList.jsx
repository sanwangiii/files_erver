import React, { useState, useEffect, useRef, useContext } from 'react';
// import axios from 'axios'; // 移除未使用的库导入
// import { useNavigate } from 'react-router-dom'; // 移除未使用的库导入
import { AuthContext } from '../App';
// import "./FileList.css"; // 移除不存在的CSS文件导入
import '../styles/global.css';

const FileList = () => {
  const { isAuthenticated, currentUser, addViewedFile, isFileViewed, addFavorite, removeFavorite, isFileFavorite } = useContext(AuthContext);
  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentPath, setCurrentPath] = useState(() => {
    // 从URL查询参数中获取初始路径
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get('dir') || '';
  });
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [loading, setLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState('success');
  const [showAlert, setShowAlert] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // 基础URL使用空字符串，这样会使用相对路径，从而利用Vite的代理配置
  const BASE_URL = '';
  
  // 上传相关状态
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  // const [uploadProgress, setUploadProgress] = useState(0);

  // 添加一个标志来避免无限循环
  const [isUpdatingUrl, setIsUpdatingUrl] = useState(false);

  // 监听URL变化
  useEffect(() => {
    const handleUrlChange = () => {
      // 从URL查询参数中获取dir值
      const searchParams = new URLSearchParams(window.location.search);
      const dir = searchParams.get('dir') || '';
      console.log('=== URL变化 ===');
      console.log('当前路径:', window.location.pathname);
      console.log('搜索参数:', window.location.search);
      console.log('解析的dir参数:', dir);
      setCurrentPath(dir);
    };

    // 初始加载时检查
    handleUrlChange();

    // 监听URL变化（仅当用户使用浏览器前进/后退按钮时）
    window.addEventListener('popstate', handleUrlChange);

    return () => {
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // 加载状态对body元素的影响，实现加载期间页面无法操作
  useEffect(() => {
    if (loading) {
      document.body.classList.add('loading-active');
    } else {
      document.body.classList.remove('loading-active');
    }
    
    return () => {
      // 组件卸载时确保移除类
      document.body.classList.remove('loading-active');
    };
  }, [loading]);

  // 检查用户是否有权限访问某个路径
  const hasPermission = (path, user) => {
    if (!user || user.isAdmin) return true;
    if (user.permissions.includes('*')) return true;
    
    // 检查该路径是否在权限列表中
    if (user.permissions.includes(path)) return true;
    
    // 检查该路径的父路径是否在权限列表中
    const pathParts = path.split('/');
    for (let i = 0; i < pathParts.length - 1; i++) {
      const parentPath = pathParts.slice(0, i + 1).join('/');
      if (user.permissions.includes(parentPath)) return true;
    }
    
    return false;
  };

  // 从API获取文件和文件夹数据
  const fetchFiles = async () => {
    setLoading(true)
    try {
      // 获取认证信息
      const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null
      const response = await fetch(`${BASE_URL}/api/files?dir=${encodeURIComponent(currentPath)}&sort_by=${sortBy}&sort_order=${sortOrder}`, {
        headers: {
          'Authorization': `Bearer ${user?.token || ''}`
        }
      })
      const data = await response.json()
      
      // 根据用户权限过滤文件夹，确保始终是可迭代对象
      let filteredFolders = data.folders || []
      if (user && !user.isAdmin) {
        filteredFolders = filteredFolders.filter(folder => {
          return hasPermission(folder.path, user);
        })
      }
      setFolders(filteredFolders)

      // 根据用户权限过滤文件，确保始终是可迭代对象
      let filteredFiles = data.files || []
      if (user && !user.isAdmin) {
        filteredFiles = filteredFiles.filter(file => {
          return hasPermission(file.path, user);
        })
      }
      setFiles(filteredFiles)
    } catch (error) {
      console.error('获取文件列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 初始加载时已通过状态初始化获取查询参数，不再需要此Effect

  // 加载文件和文件夹数据
  useEffect(() => {
    fetchFiles()
    
    // 恢复滚动位置
    const savedScrollPosition = sessionStorage.getItem('scrollPosition')
    if (savedScrollPosition) {
      setTimeout(() => {
        window.scrollTo(0, parseInt(savedScrollPosition, 10))
        sessionStorage.removeItem('scrollPosition')
      }, 100)
    }
  }, [currentPath, sortBy, sortOrder])

  // 当路径变化时，更新URL查询参数
  useEffect(() => {
    // 检查当前URL的dir参数是否与currentPath一致
    const searchParams = new URLSearchParams(window.location.search);
    const currentUrlDir = searchParams.get('dir') || '';
    
    // 只有当URL中的dir参数与currentPath不一致时，才更新URL
    if (currentUrlDir !== currentPath) {
      if (currentPath) {
        window.history.pushState(null, '', `/files?dir=${encodeURIComponent(currentPath)}`)
      } else {
        window.history.pushState(null, '', '/files')
      }
    }
  }, [currentPath])

  // 处理浏览器前进/后退按钮
  // 注意：这个功能已经在上面的URL变化处理useEffect中实现，这里不再重复

  // 格式化文件大小
  const formatSize = (sizeBytes) => {
    if (sizeBytes >= 1024 ** 3) {
      return `${(sizeBytes / (1024 ** 3)).toFixed(1)} GB`;
    } else if (sizeBytes >= 1024 ** 2) {
      return `${(sizeBytes / (1024 ** 2)).toFixed(1)} MB`;
    } else if (sizeBytes >= 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`;
    } else {
      return `${sizeBytes} B`;
    }
  };

  // 格式化修改时间
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // 获取文件图标
  const getFileIcon = (fileType) => {
    switch (fileType) {
      case 'video':
        return <i className="fa-solid fa-video" style={{ color: '#e74c3c' }}></i>;
      case 'text':
        return <i className="fa-solid fa-file-lines" style={{ color: '#3498db' }}></i>;
      case 'image':
        return <i className="fa-solid fa-image" style={{ color: '#27ae60' }}></i>;
      default:
        return <i className="fa-solid fa-file" style={{ color: '#95a5a6' }}></i>;
    }
  };

  // 处理排序
  const handleSort = (newSortBy) => {
    // console.log('Original handleSort called with newSortBy:', newSortBy);
    // console.log('Current sortBy:', sortBy, 'Current sortOrder:', sortOrder);
    if (sortBy === newSortBy) {
      // const newSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      // console.log('Changing sortOrder to:', newSortOrder);
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // console.log('Changing sortBy to:', newSortBy, 'and sortOrder to: asc');
      setSortBy(newSortBy);
      setSortOrder('asc');
    }
  }

  // 自然排序键函数
  const naturalSortKey = (str) => {
    return str.toLowerCase().split(/(\d+)/).map(part => {
      return isNaN(part) ? part : parseInt(part, 10)
    })
  }

  // 排序文件
  const sortedFiles = [...files].sort((a, b) => {
    let aValue, bValue

    switch (sortBy) {
      case 'name':
        aValue = naturalSortKey(a.name)
        bValue = naturalSortKey(b.name)
        // 比较自然排序键
        for (let i = 0; i < Math.min(aValue.length, bValue.length); i++) {
          if (aValue[i] < bValue[i]) return sortOrder === 'asc' ? -1 : 1
          if (aValue[i] > bValue[i]) return sortOrder === 'asc' ? 1 : -1
        }
        // 如果一个是另一个的前缀
        if (aValue.length < bValue.length) return sortOrder === 'asc' ? -1 : 1
        if (aValue.length > bValue.length) return sortOrder === 'asc' ? 1 : -1
        return 0
      case 'size':
        aValue = a.size
        bValue = b.size
        break
      case 'modified':
        aValue = new Date(a.modified)
        bValue = new Date(b.modified)
        break
      case 'type':
        aValue = a.type
        bValue = b.type
        break
      default:
        aValue = naturalSortKey(a.name)
        bValue = naturalSortKey(b.name)
        // 比较自然排序键
        for (let i = 0; i < Math.min(aValue.length, bValue.length); i++) {
          if (aValue[i] < bValue[i]) return sortOrder === 'asc' ? -1 : 1
          if (aValue[i] > bValue[i]) return sortOrder === 'asc' ? 1 : -1
        }
        // 如果一个是另一个的前缀
        if (aValue.length < bValue.length) return sortOrder === 'asc' ? -1 : 1
        if (aValue.length > bValue.length) return sortOrder === 'asc' ? 1 : -1
        return 0
    }

    if (aValue < bValue) {
      return sortOrder === 'asc' ? -1 : 1
    }
    if (aValue > bValue) {
      return sortOrder === 'asc' ? 1 : -1
    }
    return 0
  })

  // 处理文件预览
  const handlePreview = (file) => {
    // 标记文件为已查阅
    addViewedFile(file.path)
    
    if (file.type === 'image' || file.type === 'text' || file.type === 'video') {
      // 图片、文本或视频文件，跳转到预览页面
      // 使用传统的页面跳转方式，确保浏览器正确处理历史记录
      const searchParams = new URLSearchParams()
      searchParams.set('name', file.name)
      searchParams.set('path', file.path)
      searchParams.set('type', file.type)
      const previewUrl = `/preview?${searchParams.toString()}`
      
      // 保存当前滚动位置
      const scrollPosition = window.scrollY
      sessionStorage.setItem('scrollPosition', scrollPosition.toString())
      
      // 使用传统的页面跳转方式
      window.location.href = previewUrl
    } else {
      // 其他类型，显示提示信息
      setAlertType('info');
      setAlertMessage('暂不支持该类型文件的预览');
      setShowAlert(true);
    }
  }
  
  // 处理瀑布预览
  const handleWaterfallPreview = () => {
    // 跳转到瀑布预览页面
    const searchParams = new URLSearchParams()
    searchParams.set('path', currentPath)
    const waterfallUrl = `/waterfall?${searchParams.toString()}`
    
    console.log('=== 瀑布预览按钮点击 ===');
    console.log('当前路径:', currentPath);
    console.log('构建的瀑布预览URL:', waterfallUrl);
    console.log('完整URL:', window.location.origin + waterfallUrl);
    
    // 保存当前滚动位置
    const scrollPosition = window.scrollY
    sessionStorage.setItem('scrollPosition', scrollPosition.toString())
    
    // 使用传统的页面跳转方式
    window.location.href = waterfallUrl
  }
  

  


  // 处理文件夹点击
  const handleFolderClick = (folderName) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    setCurrentPath(newPath);
  }

  // 处理返回上一级
  const handleBackClick = () => {
    if (currentPath) {
      const newPath = currentPath.split('/').slice(0, -1).join('/')
      setCurrentPath(newPath)
    }
  }

  // 检查用户是否有上传权限
  const hasUploadPermission = () => {
    console.log('检查上传权限:', currentUser, '当前路径:', currentPath);
    if (!currentUser) {
      console.log('没有当前用户');
      return false;
    }
    if (currentUser.isAdmin) {
      console.log('是管理员，有上传权限');
      return true;
    }
    if (currentUser.permissions.includes('*')) {
      console.log('有通配符权限，有上传权限');
      return true;
    }
    
    // 检查当前路径是否在用户权限中
    const hasPathPermission = currentUser.permissions.includes(currentPath);
    const hasRootPermission = currentUser.permissions.includes('');
    const hasParentPermission = currentUser.permissions.some(permission => 
      currentPath.startsWith(permission + '/')
    );
    
    console.log('路径权限:', hasPathPermission, '根目录权限:', hasRootPermission, '父文件夹权限:', hasParentPermission);
    
    return hasPathPermission || hasRootPermission || hasParentPermission;
  }

  // 处理文件选择
  const handleFileSelect = (e) => {
    console.log('文件选择事件触发:', e);
    const selectedFiles = Array.from(e.target.files);
    console.log('选择的文件数量:', selectedFiles.length);
    
    if (selectedFiles.length > 0) {
      // 依次上传每个文件
      selectedFiles.forEach((file, index) => {
        console.log('上传文件', index + 1, '/', selectedFiles.length, ':', file.name, '大小:', file.size);
        handleUpload(file);
      });
    } else {
      console.log('没有选择文件');
    }
  }

  // 处理文件上传
  const handleUpload = (fileToUpload) => {
    console.log('handleUpload被调用，fileToUpload:', fileToUpload, 'hasUploadPermission:', hasUploadPermission());
    if (!fileToUpload) {
      console.log('没有要上传的文件');
      return;
    }
    
    if (!hasUploadPermission()) {
      console.log('没有上传权限');
      return;
    }
    
    console.log('开始上传文件:', fileToUpload.name, '大小:', fileToUpload.size);
    
    // 为当前文件创建唯一ID
    const fileId = Date.now() + Math.random().toString(36).substr(2, 9);
    
    // 将文件添加到上传列表
    setUploadingFiles(prev => [...prev, {
      id: fileId,
      name: fileToUpload.name,
      progress: 0,
      uploading: true,
      error: null
    }]);
    
    const formData = new FormData();
    formData.append('file', fileToUpload);
    formData.append('dir', currentPath);
    
    const user = currentUser || JSON.parse(localStorage.getItem('user'));
    console.log('上传用户:', user);
    
    // 使用XMLHttpRequest来实现上传进度
    const xhr = new XMLHttpRequest();
    
    // 监听上传进度
    xhr.upload.addEventListener('progress', (event) => {
      console.log('上传进度事件:', event.loaded, '/', event.total, '可计算:', event.lengthComputable);
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        console.log('上传进度百分比:', progress);
        
        // 更新该文件的进度
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, progress } : file
        ));
      }
    });
    
    // 监听完成事件
    xhr.addEventListener('load', () => {
      console.log('上传完成，状态码:', xhr.status);
      console.log('上传响应:', xhr.responseText);
      if (xhr.status === 200) {
        // 更新文件上传状态为完成
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, uploading: false } : file
        ));
        
        // 检查是否所有文件都上传完成
        setTimeout(() => {
          setUploadingFiles(prev => {
            const remainingUploads = prev.filter(file => file.id !== fileId);
            if (remainingUploads.length === 0) {
              // 最后一个文件上传完成，重新加载文件列表
              fetchFiles();
              
              // 显示成功消息
              setAlertMessage('所有文件上传成功！');
              setAlertType('success');
              setShowAlert(true);
            }
            return remainingUploads;
          });
        }, 100);
      } else {
        let errorMessage;
        try {
          const error = JSON.parse(xhr.responseText);
          console.error('上传失败:', error);
          errorMessage = error.message || '未知错误';
        } catch (e) {
          console.error('上传失败:', xhr.responseText);
          errorMessage = xhr.responseText;
        }
        
        // 更新文件上传状态为错误
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, uploading: false, error: errorMessage } : file
        ));
        
        // 显示错误消息
        setAlertMessage(`文件上传失败: ${fileToUpload.name} - ${errorMessage}`);
        setAlertType('error');
        setShowAlert(true);
      }
    });
    
    // 监听错误事件
    xhr.addEventListener('error', () => {
      console.error('上传出错:', xhr.responseText);
      const errorMessage = xhr.responseText || '网络错误';
      
      // 更新文件上传状态为错误
      setUploadingFiles(prev => prev.map(file => 
        file.id === fileId ? { ...file, uploading: false, error: errorMessage } : file
      ));
      
      // 显示错误消息
      setAlertMessage(`文件上传出错: ${fileToUpload.name} - ${errorMessage}`);
      setAlertType('error');
      setShowAlert(true);
    });
    
    // 监听超时事件
    xhr.addEventListener('timeout', () => {
      console.error('上传超时');
      
      // 更新文件上传状态为错误
      setUploadingFiles(prev => prev.map(file => 
        file.id === fileId ? { ...file, uploading: false, error: '上传超时' } : file
      ));
      
      // 显示错误消息
      setAlertMessage(`文件上传超时: ${fileToUpload.name}`);
      setAlertType('error');
      setShowAlert(true);
    });
    
    // 设置超时时间为30秒
    xhr.timeout = 30000;
    
    // 发送请求
    console.log('发送上传请求到:', '/api/upload');
    xhr.open('POST', '/api/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${user?.token || ''}`);
    xhr.send(formData);
  }

  // 关闭自定义弹窗
  const closeAlert = () => {
    setShowAlert(false);
  };

  // 回到顶部处理函数
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  // 监听滚动事件，控制回到顶部按钮的显示
  useEffect(() => {
    const handleScroll = () => {
      // 使用document.documentElement.scrollTop || document.body.scrollTop来兼容不同浏览器
      const scrollY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop;
      setShowBackToTop(scrollY > 500);
    };

    // 添加滚动事件监听器
    window.addEventListener('scroll', handleScroll);

    // 清理事件监听器
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 下拉菜单点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // 切换下拉菜单显示
  const toggleDropdown = () => {
    // console.log('toggleDropdown called, current showDropdown:', showDropdown);
    setShowDropdown(!showDropdown);
  };

  // 处理排序项点击，点击后关闭下拉菜单
  const handleSortItemClick = (newSortBy) => {
    // console.log('handleSortItemClick called with newSortBy:', newSortBy);
    handleSort(newSortBy);
    setShowDropdown(false);
  };

  return (
    <div className="file-list-container">
      {loading && <div className="loading">加载中...</div>}
      <div className="sort-controls">
        <div className="sort-options">
          <div className="sort-dropdown" ref={dropdownRef}>
            <button className="sort-dropdown-btn" onClick={toggleDropdown}>
              排序方式: {sortBy === 'name' ? '名称' : sortBy === 'modified' ? '修改时间' : sortBy === 'size' ? '大小' : '类型'} {sortOrder === 'asc' ? '↑' : '↓'}
              <i className="fa-solid fa-chevron-down"></i>
            </button>
            <div className={`sort-dropdown-content ${showDropdown ? 'show' : ''}`}>
              <button 
                className={`sort-dropdown-item ${sortBy === 'name' ? 'active' : ''}`}
                onClick={() => handleSortItemClick('name')}
              >
                名称 {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`sort-dropdown-item ${sortBy === 'modified' ? 'active' : ''}`}
                onClick={() => handleSortItemClick('modified')}
              >
                修改时间 {sortBy === 'modified' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`sort-dropdown-item ${sortBy === 'size' ? 'active' : ''}`}
                onClick={() => handleSortItemClick('size')}
              >
                大小 {sortBy === 'size' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`sort-dropdown-item ${sortBy === 'type' ? 'active' : ''}`}
                onClick={() => handleSortItemClick('type')}
              >
                类型 {sortBy === 'type' && (sortOrder === 'asc' ? '↑' : '↓')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="navigation">
        {currentPath && (
          <button className="btn btn-secondary" onClick={handleBackClick}>
            返回上一级
          </button>
        )}
        
        {/* 瀑布预览按钮 */}
        <button className="btn btn-secondary" onClick={handleWaterfallPreview}>
          <i className="fa-solid fa-images"></i> 瀑布预览
        </button>
        
        {/* 文件上传按钮 */}
        {hasUploadPermission() && (
          <div className="upload-section">
            <input 
              type="file" 
              id="file-upload" 
              style={{ display: 'none' }} 
              onChange={handleFileSelect}
              accept="image/*,video/*"
              multiple
            />
            <label htmlFor="file-upload" className="btn btn-primary" disabled={uploadingFiles.length > 0}>
              {uploadingFiles.length > 0 ? '上传中...' : '上传文件'}
            </label>
            
            {/* 上传进度条 - 为每个文件显示 */}
            {uploadingFiles.map(file => (
              <div key={file.id} className="upload-progress-container">
                <div className="upload-progress-bar">
                  <div 
                    className="upload-progress-fill" 
                    style={{ width: `${file.progress}%` }}
                  ></div>
                </div>
                <span className="upload-progress-text">{file.name} {file.progress}%</span>
              </div>
            ))}
            
            {/* 自定义居中弹窗 */}
            {showAlert && (
              <div className="custom-alert-overlay">
                <div className={`custom-alert custom-alert-${alertType}`}>
                  <div className="custom-alert-content">
                    <p>{alertMessage}</p>
                    <button 
                      className="btn btn-primary custom-alert-button"
                      onClick={closeAlert}
                    >
                      确定
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
        
        <div className="current-path">
          当前路径: {currentPath ? currentPath : '根目录'}
        </div>

      {folders.length > 0 && (
        <div className="folder-grid">
          {[...folders].sort((a, b) => {
            const aKey = naturalSortKey(a.name);
            const bKey = naturalSortKey(b.name);
            // 比较自然排序键
            for (let i = 0; i < Math.min(aKey.length, bKey.length); i++) {
              if (aKey[i] < bKey[i]) return sortOrder === 'asc' ? -1 : 1;
              if (aKey[i] > bKey[i]) return sortOrder === 'asc' ? 1 : -1;
            }
            // 如果一个是另一个的前缀
            if (aKey.length < bKey.length) return sortOrder === 'asc' ? -1 : 1;
            if (aKey.length > bKey.length) return sortOrder === 'asc' ? 1 : -1;
            return 0;
          }).map(folder => (
            <div key={folder.name} className="folder-card" onClick={() => handleFolderClick(folder.name)}>
              <div className="folder-icon">
                <i className={`fa-solid ${folder.icon}`} style={{ color: folder.color }}></i>
              </div>
              <div className="folder-name">{folder.name}</div>
            </div>
          ))}
        </div>
      )}

      {sortedFiles.length > 0 && <h2>文件</h2>}
      <div className="file-grid">
        {sortedFiles.map(file => (
          <div key={file.path} className="file-card">
            <div className="file-icon">
              {getFileIcon(file.type)}
            </div>
            <div className="file-name">
              <div className="file-name-container">
                <span className="file-name-text">{file.name}</span>
                {isFileViewed(file.path) && <span className="viewed-badge">已查阅</span>}
              </div>
            </div>
            <div className="file-meta">
              <div>大小: {formatSize(file.size)}</div>
              <div>修改时间: {formatTime(file.modified)}</div>
              <div>类型: {file.type}</div>
            </div>
            <div className="file-actions">
              <button 
                className="btn" 
                onClick={() => handlePreview(file)}
              >
                预览
              </button>
              <button 
                className={`btn ${isFileFavorite(file.path) ? 'btn-danger' : 'btn-primary'}`} 
                onClick={() => {
                  if (isFileFavorite(file.path)) {
                    removeFavorite(file.path)
                  } else {
                    addFavorite(file)
                  }
                }}
              >
                {isFileFavorite(file.path) ? '取消收藏' : '收藏'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {currentPath && (
        <button 
          className="btn btn-secondary" 
          style={{ marginTop: '20px' }}
          onClick={() => setCurrentPath('')}
        >
          返回根目录
        </button>
      )}

      {/* 回到顶部按钮 */}
      <button 
        className={`back-to-top-btn ${showBackToTop ? 'show' : ''}`}
        onClick={scrollToTop}
        title="回到顶部"
      >
        <i className="fa-solid fa-arrow-up"></i>
      </button>
    </div>
  )
}

export default FileList