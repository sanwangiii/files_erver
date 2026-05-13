import React, { useState, useEffect, useContext, useCallback, useRef } from 'react'
import { AuthContext } from '../App'

function Preview() {
  const [previewFile, setPreviewFile] = useState(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const [videoBuffering, setVideoBuffering] = useState(false)
  const { currentUser } = useContext(AuthContext)
  const videoRef = useRef(null) // 添加视频元素引用
  const subtitleRef = useRef(null) // 字幕元素引用
  const [subtitles, setSubtitles] = useState([]) // 字幕轨道列表
  const [selectedSubtitles, setSelectedSubtitles] = useState([]) // 当前选择的多个字幕轨道索引
  const [subtitleTracksMap, setSubtitleTracksMap] = useState({}) // 存储每个轨道的解析后字幕数据
  const [currentCues, setCurrentCues] = useState({}) // 当前显示的多个字幕

  // 播放列表相关状态
  const [playlist, setPlaylist] = useState([]) // 播放列表
  const [currentIndex, setCurrentIndex] = useState(-1) // 当前播放索引
  const [showPlaylist, setShowPlaylist] = useState(false) // 是否显示播放列表
  const [autoPlayNext, setAutoPlayNext] = useState(true) // 是否自动播放下一个

  // 获取URL参数
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      name: params.get('name'),
      path: params.get('path'),
      type: params.get('type'),
      from: params.get('from'),
      dir: params.get('dir') // 当前目录，用于播放列表
    }
  }, [])

  // 获取当前目录的视频播放列表
  const fetchPlaylist = useCallback(async (dir) => {
    if (!dir) return

    try {
      const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null
      const token = user?.token || ''

      const response = await fetch(`/api/files?dir=${encodeURIComponent(dir)}&sort_by=name&sort_order=asc`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (response.ok) {
        const data = await response.json()
        // 过滤出视频文件
        const videoFiles = (data.files || []).filter(file => file.type === 'video')
        setPlaylist(videoFiles)
        return videoFiles
      }
    } catch (error) {
      console.error('获取播放列表失败:', error)
    }
    return []
  }, [currentUser])

  // 播放指定索引的视频
  const playVideoAtIndex = useCallback((index) => {
    if (index < 0 || index >= playlist.length) return

    const video = playlist[index]
    const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null
    const token = user?.token || ''

    setCurrentIndex(index)

    // 更新 URL 参数（不刷新页面）
    const searchParams = new URLSearchParams()
    searchParams.set('name', video.name)
    searchParams.set('path', video.path)
    searchParams.set('type', 'video')
    searchParams.set('dir', getUrlParams().dir || '')
    window.history.replaceState(null, '', `/preview?${searchParams.toString()}`)

    // 更新预览文件信息
    const hostname = window.location.hostname
    const backendPort = 3002
    const fullVideoUrl = `http://${hostname}:${backendPort}/video/${encodeURIComponent(video.path)}?token=${token}`
    const vlcProtocolUrl = `vlc://${fullVideoUrl}`

    setPreviewFile({
      name: video.name,
      preview_url: `/video/${encodeURIComponent(video.path)}?token=${token}`,
      vlc_url: vlcProtocolUrl,
      type: 'video',
      path: video.path
    })

    // 重置字幕状态
    setSubtitles([])
    setSelectedSubtitles([])
    setSubtitleTracksMap({})
    setCurrentCues({})

    // 重新加载字幕
    (async () => {
      try {
        const subtitlesResponse = await fetch(`/api/subtitles/${encodeURIComponent(video.path)}?token=${token}`)
        if (subtitlesResponse.ok) {
          const subtitlesData = await subtitlesResponse.json()
          const subtitleList = subtitlesData.subtitles || []
          setSubtitles(subtitleList)

          if (subtitleList.length > 0) {
            const firstSubtitleIndex = subtitleList[0].index
            await loadSubtitle(firstSubtitleIndex, video.path)
            setSelectedSubtitles([firstSubtitleIndex])
          }
        }
      } catch (error) {
        // 字幕加载失败不影响视频播放
      }
    })()

    // 隐藏播放列表
    setShowPlaylist(false)
  }, [playlist, currentUser, getUrlParams])

  // 监听 previewFile.path 变化，自动播放视频
  useEffect(() => {
    if (!previewFile?.path || previewFile.type !== 'video') return

    const video = videoRef.current
    if (!video) return

    // 等待视频元素准备好
    const handleCanPlay = () => {
      video.play().catch(() => {
        // 自动播放失败时忽略（浏览器策略）
      })
    }

    video.addEventListener('canplay', handleCanPlay)

    // 如果视频已经可以播放，直接播放
    if (video.readyState >= 3) {
      video.play().catch(() => {})
    }

    return () => {
      video.removeEventListener('canplay', handleCanPlay)
    }
  }, [previewFile?.path])

  // 播放上一个
  const playPrevious = useCallback(() => {
    if (currentIndex > 0) {
      playVideoAtIndex(currentIndex - 1)
    }
  }, [currentIndex, playVideoAtIndex])

  // 播放下一个
  const playNext = useCallback(() => {
    if (currentIndex < playlist.length - 1) {
      playVideoAtIndex(currentIndex + 1)
    }
  }, [currentIndex, playlist.length, playVideoAtIndex])

  // 处理预览
  const handlePreview = async () => {
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
        // 图片或视频文件，直接使用文件URL
        let fileUrl = ''
        if (params.type === 'video') {
          // 视频文件，使用视频流URL
          fileUrl = `/video/${encodeURIComponent(params.path)}?token=${token}`
        } else {
          // 图片文件，使用文件服务URL
          fileUrl = `/file/${encodeURIComponent(params.path)}?token=${token}`
        }
        
        // 直接生成VLC协议URL，不使用中间网页
        let vlcProtocolUrl = null
        if (params.type === 'video') {
          const hostname = window.location.hostname
          const backendPort = 3002
          const fullVideoUrl = `http://${hostname}:${backendPort}/video/${encodeURIComponent(params.path)}?token=${token}`
          vlcProtocolUrl = `vlc://${fullVideoUrl}`
        }
        
        // 优先设置previewFile，让视频先显示
        setPreviewFile({
          name: params.name,
          preview_url: fileUrl,
          vlc_url: vlcProtocolUrl,
          type: params.type,
          path: params.path // 保存路径用于后续字幕操作
        })
        
        // 视频加载后，异步获取字幕信息，不阻塞视频显示
        if (params.type === 'video') {
          (async () => {
            try {
              const subtitlesResponse = await fetch(`/api/subtitles/${encodeURIComponent(params.path)}?token=${token}`)
              if (subtitlesResponse.ok) {
                const subtitlesData = await subtitlesResponse.json()
                const subtitleList = subtitlesData.subtitles || []
                setSubtitles(subtitleList)

                if (subtitleList.length > 0) {
                  const firstSubtitleIndex = subtitleList[0].index
                  await loadSubtitle(firstSubtitleIndex, params.path)
                  setSelectedSubtitles([firstSubtitleIndex])
                }
              }
            } catch (error) {
              // 字幕加载失败不影响视频播放
            }
          })()

          // 异步获取播放列表，不阻塞视频显示
          ;(async () => {
            try {
              const videoFiles = await fetchPlaylist(params.dir || '')
              if (videoFiles.length > 0) {
                // 找到当前视频在播放列表中的索引
                const index = videoFiles.findIndex(v => v.path === params.path)
                if (index !== -1) {
                  setCurrentIndex(index)
                }
              }
            } catch (error) {
              // 播放列表获取失败不影响视频播放
            }
          })()
        }
      }
    } catch (error) {
      setPreviewError('预览失败，请检查文件权限或网络连接')
    } finally {
      // 立即结束加载状态，让视频先显示
      setPreviewLoading(false)
    }
  }

  // 返回上一页
  const goBack = () => {
    const params = getUrlParams()
    const from = params.from
    
    // 使用浏览器历史记录返回，不会刷新页面
    if (from === 'favorites') {
      window.history.pushState(null, '', '/files?view=favorites')
      window.dispatchEvent(new PopStateEvent('popstate'))
    } else {
      window.history.back()
    }
  }

  // 解析WebVTT字幕内容
  const parseWebVTT = (content) => {
    
    const cues = []
    const lines = content.trim().split('\n')
    
    // 跳过WEBVTT头部和样式块
    let i = 0
    while (i < lines.length) {
      
      if (lines[i].trim() === 'WEBVTT') {
        // 跳过WEBVTT头部
        i++
      } else if (lines[i].trim() === 'STYLE') {
        // 跳过STYLE块
        i++
        // 跳过样式块的所有内容，直到遇到下一个空行或文件结束
        while (i < lines.length && lines[i].trim() !== '') {
          i++
        }
      } else if (lines[i].trim() === 'NOTE' || lines[i].trim().startsWith('X-TIMESTAMP-MAP=')) {
        // 跳过NOTE块和时间戳映射
        i++
        // 跳过NOTE块的内容
        if (lines[i-1].trim() === 'NOTE') {
          while (i < lines.length && lines[i].trim() !== '') {
            i++
          }
        }
      } else if (lines[i].trim() !== '') {
        // 开始解析一个cue
        const cue = {
          id: null,
          startTime: 0,
          endTime: 0,
          text: ''
        }
        
        // 检查当前行是否为时间范围行
        const possibleTimeMatch = lines[i].match(/((?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/)
        
        if (possibleTimeMatch) {
          // 当前行直接是时间范围，没有ID
          cue.id = null
        } else {
          // 当前行是ID
          cue.id = lines[i].trim()
          i++
        }
        
        // 解析时间范围，支持HH:MM:SS.mmm和MM:SS.mmm两种格式
        if (i < lines.length) {
          // 匹配HH:MM:SS.mmm或MM:SS.mmm格式
          const timeMatch = lines[i].match(/((?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/)
          if (timeMatch) {
            // 解析开始时间
            const startParts = timeMatch[1].split(':')
            if (startParts.length === 3) {
              // HH:MM:SS.mmm格式
              cue.startTime = parseInt(startParts[0]) * 3600 + parseInt(startParts[1]) * 60 + parseFloat(startParts[2])
            } else if (startParts.length === 2) {
              // MM:SS.mmm格式
              cue.startTime = parseInt(startParts[0]) * 60 + parseFloat(startParts[1])
            }
            
            // 解析结束时间
            const endParts = timeMatch[2].split(':')
            if (endParts.length === 3) {
              // HH:MM:SS.mmm格式
              cue.endTime = parseInt(endParts[0]) * 3600 + parseInt(endParts[1]) * 60 + parseFloat(endParts[2])
            } else if (endParts.length === 2) {
              // MM:SS.mmm格式
              cue.endTime = parseInt(endParts[0]) * 60 + parseFloat(endParts[1])
            }
            i++
            
            // 解析文本内容
            let text = ''
            while (i < lines.length && lines[i].trim() !== '') {
              text += lines[i] + '\n'
              i++
            }
            cue.text = text.trim()
            
            // 只添加有效字幕（有文本内容的）
            if (cue.text) {
              cues.push(cue)
            }
          } else {
            // 不是时间范围，跳过
            i++
          }
        } else {
          i++
        }
      } else {
        // 空行，跳过
        i++
      }
    }
    
    return cues
  }
  
  // 加载字幕内容
  const loadSubtitle = async (subtitleIndex, filePath) => {
    try {
      // 安全获取用户信息和token
      let token = ''
      if (currentUser?.token) {
        token = currentUser.token
      } else {
        try {
          const user = JSON.parse(localStorage.getItem('user') || 'null')
          token = user?.token || ''
        } catch {
          token = ''
        }
      }
      
      if (!filePath) {
        return
      }
      
      const url = `/api/subtitle_content/${encodeURIComponent(filePath)}?index=${subtitleIndex}&token=${token}`
      
      const response = await fetch(url)
      
      if (response.ok) {
        const data = await response.text()
        
        const cues = parseWebVTT(data)
        
        // 存储解析后的字幕轨道数据
        setSubtitleTracksMap(prev => {
          const newMap = {
            ...prev,
            [subtitleIndex]: cues
          }
          // 在状态更新的回调中调用updateSubtitles，确保状态已更新
          setTimeout(() => {
            updateSubtitles()
          }, 0)
          return newMap
        })
      }
    } catch (error) {
      setPreviewError('加载字幕失败')
    }
  }
  
  // 使用二分查找优化字幕查找，提高性能
  const findCurrentCue = useCallback((cues, currentTime) => {
    if (!cues || cues.length === 0) return null
    
    let left = 0
    let right = cues.length - 1
    let matchedCue = null
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      const cue = cues[mid]
      
      if (currentTime >= cue.startTime && currentTime < cue.endTime) {
        matchedCue = cue
        break
      } else if (currentTime < cue.startTime) {
        right = mid - 1
      } else {
        left = mid + 1
      }
    }
    
    return matchedCue
  }, [])

  // 更新所有选中轨道的字幕 - 使用useCallback包装，避免无限循环
  const updateSubtitles = useCallback(() => {
    const currentTime = videoRef.current?.currentTime || 0
    
    const newCues = {}
    
    // 遍历所有选中的字幕轨道
    for (const subtitleIndex of selectedSubtitles) {
      const cues = subtitleTracksMap[subtitleIndex] || []
      
      // 使用二分查找优化，提高性能
      const matchedCue = findCurrentCue(cues, currentTime)
      newCues[subtitleIndex] = matchedCue ? matchedCue.text : null
    }
    
    setCurrentCues(newCues)
  }, [selectedSubtitles, subtitleTracksMap, findCurrentCue])
  
  // 监听selectedSubtitles变化，确保所有选中的字幕都已加载
  useEffect(() => {
    selectedSubtitles.forEach(async (subtitleIndex) => {
      if (!subtitleTracksMap[subtitleIndex] || subtitleTracksMap[subtitleIndex].length === 0) {
        if (previewFile?.path) {
          try {
            await loadSubtitle(subtitleIndex, previewFile.path)
          } catch (error) {
            // 字幕加载失败不影响视频播放
          }
        }
      }
    })
  }, [selectedSubtitles, subtitleTracksMap, loadSubtitle, previewFile])

  // 使用节流函数优化，减少updateSubtitles的调用频率
  const throttledUpdateSubtitles = useCallback(() => {
    // 使用requestAnimationFrame优化，确保只在浏览器重绘时更新
    requestAnimationFrame(() => {
      updateSubtitles()
    })
  }, [updateSubtitles])

  // 监听视频时间更新，同步字幕
  useEffect(() => {
    const videoElement = videoRef.current
    
    if (!videoElement) {
      return
    }
    
    // 添加事件监听器 - 只保留必要的事件
    videoElement.addEventListener('timeupdate', throttledUpdateSubtitles)
    videoElement.addEventListener('play', updateSubtitles)
    videoElement.addEventListener('seeked', updateSubtitles)
    
    // 手动触发一次，确保初始状态正确
    updateSubtitles()
    
    return () => {
      // 移除事件监听器
      videoElement.removeEventListener('timeupdate', throttledUpdateSubtitles)
      videoElement.removeEventListener('play', updateSubtitles)
      videoElement.removeEventListener('seeked', updateSubtitles)
    }
  }, [selectedSubtitles, subtitleTracksMap, throttledUpdateSubtitles])
  
  // 改进全屏处理 - 确保字幕在各种全屏状态下都能显示
  useEffect(() => {
    const videoElement = videoRef.current
    const container = subtitleRef.current
    
    if (!videoElement || !container) return
    
    // 检查当前是否处于全屏状态的辅助函数
    const isFullscreen = () => {
      return !!(document.fullscreenElement || 
                document.webkitFullscreenElement || 
                document.mozFullScreenElement || 
                document.msFullscreenElement)
    }
    
    // 处理全屏变化，确保字幕正确显示
    const handleFullscreenChange = () => {
      // 强制更新字幕
      updateSubtitles()
      
      // 如果视频元素直接进入全屏，我们需要调整字幕容器的位置
      const fullscreenElement = document.fullscreenElement || 
                              document.webkitFullscreenElement || 
                              document.mozFullScreenElement || 
                              document.msFullscreenElement
      
      if (fullscreenElement === videoElement) {
        // 视频元素直接进入全屏，确保字幕容器在视频全屏时也能正确显示
        container.style.position = 'absolute'
        container.style.top = '0'
        container.style.left = '0'
        container.style.width = '100%'
        container.style.height = '100%'
        container.style.zIndex = '1000'
        container.style.background = 'transparent'
      } else if (!isFullscreen()) {
        // 退出全屏，恢复正常样式
        container.style.position = 'relative'
        container.style.top = 'auto'
        container.style.left = 'auto'
        container.style.width = '100%'
        container.style.height = 'auto'
        container.style.maxWidth = '900px'
        container.style.background = 'black'
      }
      
      // 强制触发重排，确保样式生效
      container.offsetHeight
    }
    
    // 添加跨浏览器全屏事件监听器到document
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [updateSubtitles])
  
  // 添加新的useEffect，专门监听subtitleTracksMap的变化，确保字幕加载完成后能立即显示
  useEffect(() => {
    // 强制更新字幕，无论视频是否加载完成
    updateSubtitles()
  }, [subtitleTracksMap, updateSubtitles])

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (e) => {
      const videoElement = videoRef.current
      if (!videoElement || previewFile?.type !== 'video') return

      // 如果用户正在输入框中，不处理快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          videoElement.paused ? videoElement.play() : videoElement.pause()
          break
        case 'ArrowLeft':
          e.preventDefault()
          videoElement.currentTime = Math.max(0, videoElement.currentTime - 5)
          break
        case 'ArrowRight':
          e.preventDefault()
          videoElement.currentTime = Math.min(videoElement.duration, videoElement.currentTime + 5)
          break
        case 'ArrowUp':
          e.preventDefault()
          videoElement.volume = Math.min(1, videoElement.volume + 0.1)
          break
        case 'ArrowDown':
          e.preventDefault()
          videoElement.volume = Math.max(0, videoElement.volume - 0.1)
          break
        case 'f':
        case 'F':
          e.preventDefault()
          if (document.fullscreenElement) {
            document.exitFullscreen()
          } else {
            videoElement.requestFullscreen?.() || videoElement.webkitRequestFullscreen?.()
          }
          break
        case 'm':
        case 'M':
          e.preventDefault()
          videoElement.muted = !videoElement.muted
          break
        case 'j':
          e.preventDefault()
          videoElement.currentTime = Math.max(0, videoElement.currentTime - 10)
          break
        case 'l':
          e.preventDefault()
          videoElement.currentTime = Math.min(videoElement.duration, videoElement.currentTime + 10)
          break
        default:
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [previewFile])

  // 组件挂载时加载预览
  useEffect(() => {
    handlePreview()
  }, [])
  
  return (
    <div className="preview-container">
      {/* 预览头部 */}
      <div className="preview-header">
        <button className="back-btn" onClick={goBack}>
          <i className="fas fa-arrow-left"></i> <span className="back-btn-text">返回</span>
        </button>
        <h1 className="preview-title">{previewFile?.name || '文件预览'}</h1>
      </div>

      {/* 预览内容 */}
      <div className="preview-content">
        {previewLoading ? (
          <div className="preview-loading">加载中...</div>
        ) : previewFile ? (
          <>
            {/* 显示错误信息（如果有） */}
            {previewError && (
              <div className="preview-error">{previewError}</div>
            )}

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
                {/* 播放列表迷你控制条 */}
                {playlist.length > 0 && (
                  <div className="playlist-mini-bar">
                    <span className="playlist-info">
                      {currentIndex + 1} / {playlist.length}
                    </span>
                    <button
                      className="playlist-btn"
                      onClick={playPrevious}
                      disabled={currentIndex <= 0}
                      title="上一集"
                    >
                      <i className="fas fa-backward"></i>
                    </button>
                    <button
                      className="playlist-btn"
                      onClick={playNext}
                      disabled={currentIndex >= playlist.length - 1}
                      title="下一集"
                    >
                      <i className="fas fa-forward"></i>
                    </button>
                    <button
                      className={`playlist-btn ${autoPlayNext ? 'active' : ''}`}
                      onClick={() => setAutoPlayNext(!autoPlayNext)}
                      title={autoPlayNext ? '已开启自动连播' : '已关闭自动连播'}
                    >
                      <i className={`fas fa-${autoPlayNext ? 'redo' : 'ban'}`}></i>
                      {autoPlayNext ? '连播' : '关闭'}
                    </button>
                    <button
                      className="playlist-btn"
                      onClick={() => setShowPlaylist(!showPlaylist)}
                      title="播放列表"
                    >
                      <i className="fas fa-list"></i>
                    </button>
                  </div>
                )}

                <div className="video-with-subtitles" ref={subtitleRef}>
                  <video
                    ref={videoRef}
                    src={previewFile.preview_url}
                    className="video-preview"
                    controls
                    playsInline
                    preload="auto"
                    onWaiting={() => setVideoBuffering(true)}
                    onPlaying={() => setVideoBuffering(false)}
                    onCanPlay={() => setVideoBuffering(false)}
                    onLoadedData={() => setVideoBuffering(false)}
                    onError={(e) => {
                      // 获取更详细的错误信息
                      const video = e.target
                      const error = video.error
                      let errorMsg = '视频加载失败'

                      if (error) {
                        switch (error.code) {
                          case MediaError.MEDIA_ERR_ABORTED:
                            errorMsg = '视频加载被中断'
                            break
                          case MediaError.MEDIA_ERR_NETWORK:
                            errorMsg = '网络原因导致视频加载失败'
                            break
                          case MediaError.MEDIA_ERR_DECODE:
                            errorMsg = '视频格式不支持（可能是 HEVC/H.265 编码，Chrome 不支持）'
                            break
                          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                            errorMsg = '视频格式或编码不支持（MKV/HEVC 等格式建议使用 VLC 播放）'
                            break
                          default:
                            errorMsg = `视频加载失败（错误码: ${error.code}）`
                        }
                      }

                      setPreviewError(errorMsg)
                      setVideoBuffering(false)
                    }}
                    onEnded={() => {
                      if (autoPlayNext && currentIndex < playlist.length - 1) {
                        playNext()
                      }
                    }}
                  ></video>
                  {/* 缓冲加载指示器 */}
                  {videoBuffering && (
                    <div className="video-buffering">
                      <div className="loading-spinner"></div>
                    </div>
                  )}
                  {/* 显示所有选中轨道的字幕 */}
                  <div className="custom-subtitles-container">
                    {selectedSubtitles.map((subtitleIndex) => {
                      const subtitleText = currentCues[subtitleIndex]
                      if (subtitleText) {
                        const subtitleInfo = subtitles.find(sub => sub.index === subtitleIndex)
                        return (
                          <div 
                            key={subtitleIndex} 
                            className="custom-subtitle"
                            data-subtitle-index={subtitleIndex}
                            data-language={subtitleInfo?.language || 'unknown'}
                          >
                            {subtitleText}
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                </div>
                
                {/* 字幕选择器 - 支持多选 */}
                {subtitles.length > 0 && (
                  <div className="subtitle-selector">
                    <div className="subtitle-selector-title">选择字幕轨道 (可多选):</div>
                    <div className="subtitle-checkboxes">
                      {subtitles.map((subtitle) => (
                        <label key={subtitle.index} className="subtitle-checkbox-item">
                          <input
                            type="checkbox"
                            value={subtitle.index}
                            checked={selectedSubtitles.includes(subtitle.index)}
                            onChange={(e) => {
                              const isChecked = e.target.checked
                              const subtitleIndex = parseInt(e.target.value)
                               
                              let newSelectedSubtitles
                              if (isChecked) {
                                newSelectedSubtitles = [...selectedSubtitles, subtitleIndex]
                                if (previewFile?.path) {
                                  loadSubtitle(subtitleIndex, previewFile.path)
                                }
                              } else {
                                newSelectedSubtitles = selectedSubtitles.filter(index => index !== subtitleIndex)
                              }
                              
                              setSelectedSubtitles(newSelectedSubtitles)
                            }}
                          />
                          <span className="subtitle-checkbox-label">
                            {subtitle.title} ({subtitle.language})
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="subtitle-info">
                      当前选中 {selectedSubtitles.length} 个字幕轨道
                    </div>
                  </div>
                )}
                
                <div className="video-actions">
                  {previewError && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setPreviewError('')
                        setVideoBuffering(false)
                        handlePreview()
                      }}
                    >
                      <i className="fa-solid fa-rotate-right"></i> 重试加载
                    </button>
                  )}
                  <a
                    href={previewFile.vlc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="vlc-play-btn"
                  >
                    <i className="fas fa-play"></i> 使用VLC播放
                  </a>
                </div>

                {/* 播放列表弹窗 */}
                {showPlaylist && playlist.length > 0 && (
                  <div className="playlist-modal">
                    <div className="playlist-modal-header">
                      <h3>播放列表 ({playlist.length} 个视频)</h3>
                      <button className="playlist-close-btn" onClick={() => setShowPlaylist(false)}>
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                    <div className="playlist-modal-content">
                      {playlist.map((video, index) => (
                        <div
                          key={video.path}
                          className={`playlist-item ${index === currentIndex ? 'active' : ''}`}
                          onClick={() => playVideoAtIndex(index)}
                        >
                          <span className="playlist-item-index">{index + 1}</span>
                          <span className="playlist-item-name">{video.name}</span>
                          {index === currentIndex && <i className="fas fa-play playlist-item-playing"></i>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="video-shortcuts-hint">
                  <span>快捷键: </span>
                  <kbd>空格</kbd> 暂停
                  <kbd>←</kbd><kbd>→</kbd> 快退/快进 5s
                  <kbd>J</kbd><kbd>L</kbd> 快退/快进 10s
                  <kbd>F</kbd> 全屏
                  <kbd>M</kbd> 静音
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