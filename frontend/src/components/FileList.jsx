import React, { useState, useEffect, useRef, useContext } from 'react';
// import axios from 'axios'; // 移除未使用的库导入
// import { useNavigate } from 'react-router-dom'; // 移除未使用的库导入
import { AuthContext } from '../App';
// import "./FileList.css"; // 移除不存在的CSS文件导入
import '../styles/global.css';

const FileList = () => {
  const { isAuthenticated, currentUser, addViewedFile, isFileViewed, addFavorite, removeFavorite, isFileFavorite, navigate } = useContext(AuthContext);
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
      const searchParams = new URLSearchParams(window.location.search);
      const dir = searchParams.get('dir') || '';
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
  }, [currentPath, sortBy, sortOrder])

  // 数据加载完成后恢复滚动位置（从预览页返回时）
  const prevLoading = useRef(loading)
  useEffect(() => {
    // 只在 loading 从 true → false（数据刚加载完）时恢复
    if (prevLoading.current && !loading) {
      const savedY = sessionStorage.getItem('fileListScrollY')
      if (savedY) {
        sessionStorage.removeItem('fileListScrollY')
        requestAnimationFrame(() => {
          window.scrollTo(0, parseInt(savedY, 10))
        })
      }
    }
    prevLoading.current = loading
  }, [loading])

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

  // 获取文件图标（使用主题协调色）
  const getFileIcon = (fileType) => {
    switch (fileType) {
      case 'video':
        return <i className="fa-solid fa-video" style={{ color: 'var(--color-file-video)' }}></i>;
      case 'text':
        return <i className="fa-solid fa-file-lines" style={{ color: 'var(--color-file-text)' }}></i>;
      case 'image':
        return <i className="fa-solid fa-image" style={{ color: 'var(--color-file-image)' }}></i>;
      default:
        return <i className="fa-solid fa-file" style={{ color: 'var(--color-file-other)' }}></i>;
    }
  };

  // 处理排序
  const handleSort = (newSortBy) => {
    if (sortBy === newSortBy) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
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

  // 保存当前滚动位置
  const saveScrollPosition = () => {
    sessionStorage.setItem('fileListScrollY', String(window.scrollY))
  }

  // 处理文件预览
  const handlePreview = (file) => {
    addViewedFile(file.path)
    
    if (file.type === 'image' || file.type === 'text' || file.type === 'video') {
      const searchParams = new URLSearchParams()
      searchParams.set('name', file.name)
      searchParams.set('path', file.path)
      searchParams.set('type', file.type)
      searchParams.set('dir', currentPath) // 传递当前目录，用于播放列表
      saveScrollPosition()
      navigate(`/preview?${searchParams.toString()}`)
    } else {
      setAlertType('info');
      setAlertMessage('暂不支持该类型文件的预览');
      setShowAlert(true);
    }
  }
  
  // 处理瀑布预览
  const handleWaterfallPreview = () => {
    const searchParams = new URLSearchParams()
    searchParams.set('path', currentPath)
    saveScrollPosition()
    navigate(`/waterfall?${searchParams.toString()}`)
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
    if (!currentUser) {
      return false;
    }
    if (currentUser.isAdmin) {
      return true;
    }
    if (currentUser.permissions.includes('*')) {
      return true;
    }
    
    const hasPathPermission = currentUser.permissions.includes(currentPath);
    const hasRootPermission = currentUser.permissions.includes('');
    const hasParentPermission = currentUser.permissions.some(permission => 
      currentPath.startsWith(permission + '/')
    );
    
    return hasPathPermission || hasRootPermission || hasParentPermission;
  }

  // 处理文件选择
  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    
    if (selectedFiles.length > 0) {
      selectedFiles.forEach((file) => {
        handleUpload(file);
      });
    }
  }

  // 处理文件上传
  const handleUpload = (fileToUpload) => {
    if (!fileToUpload) {
      return;
    }
    
    if (!hasUploadPermission()) {
      return;
    }
    
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
    
    // 使用XMLHttpRequest来实现上传进度
    const xhr = new XMLHttpRequest();
    
    // 监听上传进度
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, progress } : file
        ));
      }
    });
    
    // 监听完成事件
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, uploading: false } : file
        ));
        
        setTimeout(() => {
          setUploadingFiles(prev => {
            const remainingUploads = prev.filter(file => file.id !== fileId);
            if (remainingUploads.length === 0) {
              fetchFiles();
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
          errorMessage = error.message || '未知错误';
        } catch (e) {
          errorMessage = xhr.responseText;
        }
        
        setUploadingFiles(prev => prev.map(file => 
          file.id === fileId ? { ...file, uploading: false, error: errorMessage } : file
        ));
        
        setAlertMessage(`文件上传失败: ${fileToUpload.name} - ${errorMessage}`);
        setAlertType('error');
        setShowAlert(true);
      }
    });
    
    // 监听错误事件
    xhr.addEventListener('error', () => {
      const errorMessage = xhr.responseText || '网络错误';
      
      setUploadingFiles(prev => prev.map(file => 
        file.id === fileId ? { ...file, uploading: false, error: errorMessage } : file
      ));
      
      setAlertMessage(`文件上传出错: ${fileToUpload.name} - ${errorMessage}`);
      setAlertType('error');
      setShowAlert(true);
    });
    
    // 监听超时事件
    xhr.addEventListener('timeout', () => {
      setUploadingFiles(prev => prev.map(file => 
        file.id === fileId ? { ...file, uploading: false, error: '上传超时' } : file
      ));
      
      setAlertMessage(`文件上传超时: ${fileToUpload.name}`);
      setAlertType('error');
      setShowAlert(true);
    });
    
    xhr.timeout = 30000;
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
    setShowDropdown(!showDropdown);
  };

  // 处理排序项点击，点击后关闭下拉菜单
  const handleSortItemClick = (newSortBy) => {
    handleSort(newSortBy);
    setShowDropdown(false);
  };

  return (
    <div className="file-list-container">
      {loading && (
        <div className="loading">
          <div className="loading-spinner"></div>
          <div>加载中...</div>
          <div className="loading-dots">
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
            <div className="loading-dot"></div>
          </div>
        </div>
      )}
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
          <i className="fa-solid fa-location-dot"></i>
          <span className="current-path-label">路径:</span>
          <span className="current-path-value">{currentPath ? currentPath : '根目录'}</span>
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

      {sortedFiles.length > 0 && <div className="section-title"><i className="fa-solid fa-file"></i> 文件</div>}
      {sortedFiles.length > 0 ? (
        <div className="file-grid">
          {sortedFiles.map(file => (
            <div key={file.path} className={`file-card type-${file.type}`}>
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
                <div className="file-meta-row"><i className="fa-solid fa-hard-drive"></i> 大小: {formatSize(file.size)}</div>
                <div className="file-meta-row"><i className="fa-regular fa-clock"></i> 修改: {formatTime(file.modified)}</div>
                <div className="file-meta-row"><i className="fa-solid fa-tag"></i> 类型: {file.type}</div>
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
      ) : (
        folders.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <i className="fa-solid fa-folder-open"></i>
            </div>
            <div className="empty-state-title">暂无内容</div>
            <div className="empty-state-desc">
              当前文件夹为空，或者您没有访问权限
            </div>
          </div>
        )
      )}

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