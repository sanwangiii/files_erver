import React, { useState, useEffect, useContext, useCallback, useRef } from 'react'
import { AuthContext } from '../App'

function Preview() {
  const [previewFile, setPreviewFile] = useState(null)
  const [previewContent, setPreviewContent] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState('')
  const { currentUser } = useContext(AuthContext)
  const videoRef = useRef(null) // 添加视频元素引用
  const subtitleRef = useRef(null) // 字幕元素引用
  const [subtitles, setSubtitles] = useState([]) // 字幕轨道列表
  const [selectedSubtitles, setSelectedSubtitles] = useState([]) // 当前选择的多个字幕轨道索引
  const [subtitleContents, setSubtitleContents] = useState({}) // 存储每个轨道的字幕内容
  const [subtitleTracksMap, setSubtitleTracksMap] = useState({}) // 存储每个轨道的解析后字幕数据
  const [currentCues, setCurrentCues] = useState({}) // 当前显示的多个字幕

  // 获取URL参数
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    return {
      name: params.get('name'),
      path: params.get('path'),
      type: params.get('type'),
      from: params.get('from')
    }
  }, [])

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
          // 使用相对路径，让浏览器自动处理主机名和端口
          const videoUrl = `/video/${encodeURIComponent(params.path)}?token=${token}`
          // 由于浏览器会自动处理代理，所以VLC URL需要使用完整的HTTP URL
          const hostname = window.location.hostname
          const backendPort = 8000
          const fullVideoUrl = `http://${hostname}:${backendPort}/video/${encodeURIComponent(params.path)}?token=${token}`
          vlcProtocolUrl = `vlc://${fullVideoUrl}`
          
          // 先设置previewFile，确保loadSubtitle时previewFile.path有值
          setPreviewFile({
            name: params.name,
            preview_url: fileUrl,
            vlc_url: vlcProtocolUrl,
            type: params.type,
            path: params.path // 保存路径用于后续字幕操作
          })
          
          // 获取字幕轨道信息
          console.log('========================================')
          console.log('开始获取字幕轨道信息')
          const subtitlesResponse = await fetch(`/api/subtitles/${encodeURIComponent(params.path)}?token=${token}`)
          console.log('字幕轨道请求响应状态:', subtitlesResponse.status)
          if (subtitlesResponse.ok) {
            const subtitlesData = await subtitlesResponse.json()
            console.log('获取到的字幕轨道数据:', subtitlesData)
            const subtitleList = subtitlesData.subtitles || []
            console.log('获取到字幕轨道列表:', subtitleList)
            console.log('字幕轨道数量:', subtitleList.length)
            setSubtitles(subtitleList)
            
            // 默认开启第一个字幕轨道
            if (subtitleList.length > 0) {
              const firstSubtitleIndex = subtitleList[0].index
              console.log('默认开启第一个字幕轨道，索引:', firstSubtitleIndex)
              
              // 加载并解析第一个字幕轨道
              try {
                console.log('开始加载第一个字幕轨道，索引:', firstSubtitleIndex)
                // 直接传递params.path作为文件路径，不依赖previewFile状态
                await loadSubtitle(firstSubtitleIndex, params.path)
                // 字幕加载完成后，再设置selectedSubtitles，确保顺序正确
                setSelectedSubtitles([firstSubtitleIndex])
              } catch (error) {
                console.error('加载第一个字幕轨道时出错:', error)
                console.error('错误堆栈:', error.stack)
              }
            } else {
              console.log('没有找到字幕轨道')
            }
          } else {
            console.error('获取字幕轨道列表失败，响应状态:', subtitlesResponse.status)
            const errorText = await subtitlesResponse.text()
            console.error('错误信息:', errorText)
          }
          console.log('========================================')
        }
      }
    } catch (error) {
      console.error('预览失败:', error)
      setPreviewError('预览失败，请检查文件权限或网络连接')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 使用相对路径打开新窗口
  const openInNewWindow = (url) => {
    if (url) {
      window.open(url, '_blank')
    }
  }

  // 返回上一页
  const goBack = () => {
    const params = getUrlParams()
    const from = params.from
    
    // 根据from参数决定返回的页面
    if (from === 'favorites') {
      // 从收藏列表预览的，直接返回收藏列表
      // 使用history.back()无法返回到正确的视图，所以我们直接跳转到带有视图状态的URL
      window.location.href = '/files?view=favorites'
    } else {
      // 默认返回文件列表
      window.history.back()
    }
  }

  // 解析WebVTT字幕内容
  const parseWebVTT = (content) => {
    console.log('开始解析WebVTT内容，原始内容长度:', content.length)
    console.log('原始内容前500字符:', content.substring(0, 500))
    
    const cues = []
    const lines = content.trim().split('\n')
    console.log('分割后总行数:', lines.length)
    
    // 跳过WEBVTT头部和样式块
    let i = 0
    while (i < lines.length) {
      console.log('处理行', i, ':', lines[i].trim())
      
      if (lines[i].trim() === 'WEBVTT') {
        // 跳过WEBVTT头部
        console.log('跳过WEBVTT头部')
        i++
      } else if (lines[i].trim() === 'STYLE') {
        // 跳过STYLE块
        console.log('跳过STYLE块开始')
        i++
        // 跳过样式块的所有内容，直到遇到下一个空行或文件结束
        while (i < lines.length && lines[i].trim() !== '') {
          console.log('跳过STYLE内容行', i, ':', lines[i].trim())
          i++
        }
        console.log('跳过STYLE块结束')
      } else if (lines[i].trim() === 'NOTE' || lines[i].trim().startsWith('X-TIMESTAMP-MAP=')) {
        // 跳过NOTE块和时间戳映射
        console.log('跳过NOTE或时间戳映射行')
        i++
        // 跳过NOTE块的内容
        if (lines[i-1].trim() === 'NOTE') {
          while (i < lines.length && lines[i].trim() !== '') {
            i++
          }
        }
      } else if (lines[i].trim() !== '') {
        // 开始解析一个cue
        console.log('开始解析cue，行号:', i)
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
          console.log('当前行直接是时间范围，没有ID')
          cue.id = null
        } else {
          // 当前行是ID
          cue.id = lines[i].trim()
          console.log('cue ID:', cue.id)
          i++
        }
        
        // 解析时间范围，支持HH:MM:SS.mmm和MM:SS.mmm两种格式
        if (i < lines.length) {
          console.log('解析时间行，行号:', i, '内容:', lines[i])
          // 匹配HH:MM:SS.mmm或MM:SS.mmm格式
          const timeMatch = lines[i].match(/((?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> ((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/)
          if (timeMatch) {
            console.log('时间匹配成功:', timeMatch[1], '->', timeMatch[2])
            // 解析开始时间
            const startParts = timeMatch[1].split(':')
            if (startParts.length === 3) {
              // HH:MM:SS.mmm格式
              cue.startTime = parseInt(startParts[0]) * 3600 + parseInt(startParts[1]) * 60 + parseFloat(startParts[2])
            } else if (startParts.length === 2) {
              // MM:SS.mmm格式
              cue.startTime = parseInt(startParts[0]) * 60 + parseFloat(startParts[1])
            }
            console.log('开始时间:', cue.startTime)
            
            // 解析结束时间
            const endParts = timeMatch[2].split(':')
            if (endParts.length === 3) {
              // HH:MM:SS.mmm格式
              cue.endTime = parseInt(endParts[0]) * 3600 + parseInt(endParts[1]) * 60 + parseFloat(endParts[2])
            } else if (endParts.length === 2) {
              // MM:SS.mmm格式
              cue.endTime = parseInt(endParts[0]) * 60 + parseFloat(endParts[1])
            }
            console.log('结束时间:', cue.endTime)
            i++
            
            // 解析文本内容
            let text = ''
            console.log('开始解析文本内容，从行号:', i)
            while (i < lines.length && lines[i].trim() !== '') {
              text += lines[i] + '\n'
              console.log('添加文本行，行号:', i, '内容:', lines[i])
              i++
            }
            cue.text = text.trim()
            console.log('解析到的文本内容:', cue.text)
            
            // 只添加有效字幕（有文本内容的）
            if (cue.text) {
              console.log('添加有效字幕到列表')
              cues.push(cue)
            } else {
              console.log('跳过空字幕')
            }
          } else {
            // 不是时间范围，跳过
            console.log('不是时间范围，跳过该行')
            i++
          }
        } else {
          console.log('已到达文件末尾，无法解析时间范围')
          i++
        }
      } else {
        // 空行，跳过
        console.log('跳过空行')
        i++
      }
    }
    
    console.log('解析完成，共找到', cues.length, '个有效字幕')
    console.log('解析得到的字幕列表:', cues)
    return cues
  }
  
  // 加载字幕内容
  const loadSubtitle = async (subtitleIndex, filePath) => {
    console.log('========================================')
    console.log('开始加载字幕，索引:', subtitleIndex, '文件路径:', filePath)
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
      console.log('获取到的token:', token ? '有token' : '无token')
      
      if (!filePath) {
        console.error('文件路径为空，无法加载字幕')
        return
      }
      
      const url = `/api/subtitle_content/${encodeURIComponent(filePath)}?index=${subtitleIndex}&token=${token}`
      console.log('字幕请求URL:', url)
      
      const response = await fetch(url)
      console.log('字幕请求响应状态:', response.status)
      
      if (response.ok) {
        const data = await response.text()
        console.log('获取到字幕内容，长度:', data.length)
        
        // 存储字幕内容到对应的轨道
        setSubtitleContents(prev => ({
          ...prev,
          [subtitleIndex]: data
        }))
        
        // 解析字幕内容
        const cues = parseWebVTT(data)
        console.log('解析得到的字幕数量:', cues.length)
        console.log('解析得到的字幕列表:', cues)
        
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
      } else {
        console.error('获取字幕失败，响应状态:', response.status)
        const errorText = await response.text()
        console.error('错误信息:', errorText)
      }
    } catch (error) {
      console.error('加载字幕失败:', error)
      setPreviewError('加载字幕失败')
    }
    console.log('========================================')
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
    // 遍历所有选中的字幕轨道
    selectedSubtitles.forEach(async (subtitleIndex) => {
      // 如果该轨道的字幕数据尚未加载，就加载它
      if (!subtitleTracksMap[subtitleIndex] || subtitleTracksMap[subtitleIndex].length === 0) {
        try {
          // 只有在previewFile.path存在时才加载字幕
          if (previewFile?.path) {
            await loadSubtitle(subtitleIndex, previewFile.path)
          } else {
            console.error('previewFile.path 为空，无法加载字幕轨道:', subtitleIndex)
          }
        } catch (error) {
          console.error(`加载轨道 ${subtitleIndex} 失败:`, error)
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
    if (!videoElement) return
    
    // 检查当前是否处于全屏状态的辅助函数
    const isFullscreen = () => {
      return !!(document.fullscreenElement || 
                document.webkitFullscreenElement || 
                document.mozFullScreenElement || 
                document.msFullscreenElement)
    }
    
    // 处理全屏变化，确保字幕正确显示
    const handleFullscreenChange = () => {
      console.log('检测到全屏变化，强制更新字幕')
      // 强制更新字幕
      updateSubtitles()
      
      // 如果视频进入全屏，确保字幕容器也正确显示
      const container = subtitleRef.current
      if (container && isFullscreen()) {
        // 确保字幕容器样式正确
        console.log('当前处于全屏状态，确保字幕容器样式正确')
        // 强制触发重排，确保样式生效
        container.offsetHeight
      }
    }
    
    // 添加跨浏览器全屏事件监听器到document
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)
    
    // 同时添加到视频元素本身，确保各种全屏方式都能被捕获
    videoElement.addEventListener('fullscreenchange', handleFullscreenChange)
    videoElement.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    videoElement.addEventListener('mozfullscreenchange', handleFullscreenChange)
    videoElement.addEventListener('MSFullscreenChange', handleFullscreenChange)
    
    return () => {
      // 移除document上的事件监听器
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
      
      // 移除视频元素上的事件监听器
      videoElement.removeEventListener('fullscreenchange', handleFullscreenChange)
      videoElement.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      videoElement.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      videoElement.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [updateSubtitles])
  
  // 添加新的useEffect，专门监听subtitleTracksMap的变化，确保字幕加载完成后能立即显示
  useEffect(() => {
    console.log('检测到subtitleTracksMap变化，强制更新字幕')
    // 强制更新字幕，无论视频是否加载完成
    updateSubtitles()
  }, [subtitleTracksMap, updateSubtitles])

  // 组件挂载时加载预览
  useEffect(() => {
    handlePreview()
  }, [])
  
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
                <div className="video-with-subtitles" ref={subtitleRef}>
                  <video
                    ref={videoRef}
                    src={previewFile.preview_url}
                    className="video-preview"
                    controls
                    playsInline
                    preload="metadata"
                    onError={() => setPreviewError('视频加载失败')}
                    controlsList="nofullscreen"
                  ></video>
                  {/* 显示所有选中轨道的字幕 */}
                  <div className="custom-subtitles-container">
                    {selectedSubtitles.map((subtitleIndex) => {
                      const subtitleText = currentCues[subtitleIndex]
                      if (subtitleText) {
                        // 找到对应的字幕轨道信息
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
                  {/* 自定义全屏按钮 */}
                  <button
                    className="custom-fullscreen-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      
                      // 直接使用video元素进行全屏，简化实现
                      const video = videoRef.current
                      console.log('点击全屏按钮，当前视频元素:', video)
                      
                      // 正确检查是否处于全屏状态
                      const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement)
                      console.log('当前全屏状态:', isFullscreen)
                      
                      try {
                        if (!isFullscreen) {
                          // 进入全屏
                          console.log('尝试进入全屏')
                          if (video.requestFullscreen) {
                            video.requestFullscreen()
                            console.log('调用requestFullscreen()')
                          } else if (video.webkitRequestFullscreen) {
                            video.webkitRequestFullscreen()
                            console.log('调用webkitRequestFullscreen()')
                          } else if (video.mozRequestFullScreen) {
                            video.mozRequestFullScreen()
                            console.log('调用mozRequestFullScreen()')
                          } else if (video.msRequestFullscreen) {
                            video.msRequestFullscreen()
                            console.log('调用msRequestFullscreen()')
                          } else {
                            console.error('当前浏览器不支持全屏API')
                          }
                        } else {
                          // 退出全屏
                          console.log('尝试退出全屏')
                          if (document.exitFullscreen) {
                            document.exitFullscreen()
                            console.log('调用exitFullscreen()')
                          } else if (document.webkitExitFullscreen) {
                            document.webkitExitFullscreen()
                            console.log('调用webkitExitFullscreen()')
                          } else if (document.mozCancelFullScreen) {
                            document.mozCancelFullScreen()
                            console.log('调用mozCancelFullScreen()')
                          } else if (document.msExitFullscreen) {
                            document.msExitFullscreen()
                            console.log('调用msExitFullscreen()')
                          }
                        }
                      } catch (err) {
                        console.error('全屏操作失败:', err)
                      }
                    }}
                    aria-label="切换全屏"
                  >
                    <i className="fas fa-expand"></i>
                  </button>
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
                              console.log(`字幕轨道 ${subtitleIndex} ${isChecked ? '选中' : '取消选中'}`)
                               
                              let newSelectedSubtitles
                              if (isChecked) {
                                // 添加到选中列表
                                newSelectedSubtitles = [...selectedSubtitles, subtitleIndex]
                                // 加载新选中的字幕轨道
                                loadSubtitle(subtitleIndex)
                              } else {
                                // 从选中列表中移除
                                newSelectedSubtitles = selectedSubtitles.filter(index => index !== subtitleIndex)
                              }
                              
                              setSelectedSubtitles(newSelectedSubtitles)
                              console.log('当前选中的字幕轨道:', newSelectedSubtitles)
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
                  <a
                    href={previewFile.vlc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="vlc-play-btn"
                  >
                    <i className="fas fa-play"></i> 使用VLC播放
                  </a>
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