import React, { useState, useEffect, useContext } from 'react'
import { AuthContext } from '../App'

function FavoriteList() {
  // 基础URL使用空字符串，这样会使用相对路径，从而利用Vite的代理配置
  const BASE_URL = '';
  
  const { favoriteFiles, removeFavorite, isFileViewed, addViewedFile, navigate } = useContext(AuthContext)
  
  // 自定义弹窗状态
  const [showAlert, setShowAlert] = useState(false)
  const [alertMessage, setAlertMessage] = useState('')
  const [alertType, setAlertType] = useState('success') // success, error, info
  
  // 格式化文件大小
  const formatSize = (sizeBytes) => {
    if (sizeBytes >= 1024 ** 3) {
      return `${(sizeBytes / (1024 ** 3)).toFixed(1)} GB`
    } else if (sizeBytes >= 1024 ** 2) {
      return `${(sizeBytes / (1024 ** 2)).toFixed(1)} MB`
    } else if (sizeBytes >= 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`
    } else {
      return `${sizeBytes} B`
    }
  }
  
  // 格式化修改时间
  const formatTime = (timestamp) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  // 恢复滚动位置（从预览页返回时）
  useEffect(() => {
    const savedY = sessionStorage.getItem('favoritesScrollY')
    if (savedY) {
      sessionStorage.removeItem('favoritesScrollY')
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedY, 10))
      })
    }
  }, [])
  // 获取文件图标（使用主题协调色）
  const getFileIcon = (fileType) => {
    switch (fileType) {
      case 'video':
        return <i className="fa-solid fa-video" style={{ color: 'var(--color-file-video)' }}></i>
      case 'text':
        return <i className="fa-solid fa-file-lines" style={{ color: 'var(--color-file-text)' }}></i>
      case 'image':
        return <i className="fa-solid fa-image" style={{ color: 'var(--color-file-image)' }}></i>
      default:
        return <i className="fa-solid fa-file" style={{ color: 'var(--color-file-other)' }}></i>
    }
  }
  
  // 处理文件预览
  const handlePreview = (file) => {
    addViewedFile(file.path)
    
    if (file.type === 'image' || file.type === 'text' || file.type === 'video') {
      const searchParams = new URLSearchParams()
      searchParams.set('name', file.name)
      searchParams.set('path', file.path)
      searchParams.set('type', file.type)
      searchParams.set('from', 'favorites')
      sessionStorage.setItem('favoritesScrollY', String(window.scrollY))
      navigate(`/preview?${searchParams.toString()}`)
    } else {
      setAlertType('info')
      setAlertMessage('暂不支持该类型文件的预览')
      setShowAlert(true)
    }
  }
  
  // 关闭自定义弹窗
  const closeAlert = () => {
    setShowAlert(false)
  }
  
  return (
    <div className="file-list-container">
      <div className="navigation">
        <div className="current-path">
          <i className="fa-solid fa-location-dot"></i>
          <span className="current-path-label">路径:</span>
          <span className="current-path-value">收藏列表</span>
        </div>
      </div>
      
      {favoriteFiles.length === 0 ? (
        <div className="empty-favorites">
          <i className="fa-regular fa-star"></i>
          <h3>暂无收藏文件</h3>
          <p>您可以在文件列表中点击"收藏"按钮来添加文件到收藏列表</p>
        </div>
      ) : (
        <>
          <div className="section-title"><i className="fa-solid fa-star"></i> 收藏文件</div>
          <div className="file-grid">
            {favoriteFiles.map(file => (
              <div key={file.id} className={`file-card type-${file.type}`}>
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
                  <div className="file-meta-row"><i className="fa-solid fa-star"></i> 收藏: {formatTime(file.created_at)}</div>
                </div>
                <div className="file-actions">
                  <button 
                    className="btn" 
                    onClick={() => handlePreview(file)}
                  >
                    预览
                  </button>
                  <button 
                    className="btn btn-danger" 
                    onClick={() => removeFavorite(file.path)}
                  >
                    取消收藏
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      
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
  )
}

export default FavoriteList
