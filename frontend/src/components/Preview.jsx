import React, { useState, useEffect, useContext, useCallback, useRef } from 'react'
import { AuthContext } from '../App'

function Preview() {
  const [previewFile, setPreviewFile] = useState(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const { currentUser, addViewedFile } = useContext(AuthContext)
  const videoRef = useRef(null) // 添加视频元素引用

  // 获取URL参数
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      name: params.get('name'),
      path: decodeURIComponent(params.get('path') || ''), // 解码path参数
      type: params.get('type')
    }
  }, [])

  // 处理预览
  const handlePreview = useCallback(async () => {
    const params = getUrlParams()
    if (!params.name || !params.path || !params.type) {
      setPreviewError('文件参数不完整')
      setPreviewLoading(false)
      return
    }

    setPreviewLoading(true)
    setPreviewError('')

    try {
      // 统一获取用户信息
      const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null
      const token = user?.token || ''
      
      if (params.type === 'text') {
        // 文本文件，获取内容后显示
        const response = await fetch(`/api/preview_text/${encodeURIComponent(params.path)}?token=${token}`)
        if (!response.ok) {
          throw new Error('预览失败，服务器错误')
        }
        const data = await response.json()
        
        setPreviewFile({
          name: params.name,
          preview_url: `/api/preview_text/${encodeURIComponent(params.path)}`,
          type: params.type
        })
        setPreviewContent(data.content)
      } else if (params.type === 'image' || params.type === 'video') {
        // 图片或视频文件，直接使用相对路径的文件URL
        const fileUrl = params.type === 'video' 
          ? `/video/${encodeURIComponent(params.path)}?token=${token}` 
          : `/file/${encodeURIComponent(params.path)}?token=${token}`;
        
        // 构建完整的HTTP URL用于VLC播放
        const hostname = window.location.hostname;
        const port = window.location.port;
        const protocol = window.location.protocol;
        
        // 构建完整的HTTP URL
        const fullHttpUrl = `${protocol}//${hostname}${port ? ':' + port : ''}${fileUrl}`;
        
        // 直接构建VLC协议URL，使用vlc://前缀来触发VLC播放器
        const vlcProtocolUrl = `vlc://${fullHttpUrl}`;
        
        setPreviewFile({
          name: params.name,
          preview_url: fileUrl,
          vlc_url: params.type === 'video' ? vlcProtocolUrl : null,
          type: params.type
        })
      }
      
      // 标记文件为已查阅
      addViewedFile(params.path);
    } catch (error) {
      console.error('预览失败:', error)
      setPreviewError('预览失败，请检查文件权限或网络连接')
    } finally {
      setPreviewLoading(false)
    }
  }, [getUrlParams, currentUser, addViewedFile])

  // 使用相对路径打开新窗口
  const openInNewWindow = (url) => {
    if (url) {
      window.open(url, '_blank')
    }
  }

  // 返回上一页
  const goBack = () => {
    // 使用history.back()返回上一页，保持浏览上下文
    window.history.back()
  }

  // 组件挂载时加载预览
  useEffect(() => {
    handlePreview()
  }, [handlePreview])

  return (
    <div className="preview-container">
      {/* 预览头部 */}
      <div className="preview-header">
        <button className="back-btn" onClick={goBack}>
          <i className="fas fa-arrow-left"></i> 返回
        </button>
        <h1 className="preview-title">{previewFile?.name || '文件预览'}</h1>
      </div>

      {/* 预览内容 */}
      <div className="preview-content">
        {previewLoading ? (
          <div className="preview-loading">加载中...</div>
        ) : previewError ? (
          <div className="preview-error">{previewError}</div>
        ) : previewFile ? (
          <>
            {/* 文本预览 */}
            {previewFile.type === 'text' && (
              <div className="text-preview-container">
                <pre className="text-preview-content">{previewContent}</pre>
              </div>
            )}

            {/* 图片预览 */}
            {previewFile.type === 'image' && (
              <div className="image-preview-container">
                <img
                  src={previewFile.preview_url}
                  alt={previewFile.name}
                  className="image-preview"
                  onError={() => setPreviewError('图片加载失败')}
                />
              </div>
            )}

            {/* 视频预览 */}
            {previewFile.type === 'video' && (
              <div className="video-preview-container">
                <video
                  ref={videoRef}
                  src={previewFile.preview_url}
                  className="video-preview"
                  controls
                  playsInline
                  preload="metadata"
                  onError={() => setPreviewError('视频加载失败')}
                />
                <div className="video-actions">
                  <button
                    className="vlc-play-btn"
                    onClick={() => openInNewWindow(previewFile.vlc_url)}
                  >
                    <i className="fas fa-play"></i> 使用VLC播放
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="preview-error">预览文件信息错误</div>
        )}
      </div>
    </div>
  )
}

export default Preview