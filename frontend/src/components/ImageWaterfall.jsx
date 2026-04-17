import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { AuthContext } from '../App';

/* ============================================
   漫画阅读器模式
   - 滚动模式：图片纵向连续排列，像看漫画一样
   - 翻页模式：一次看一张，左右/上下翻页
   - 键盘：←→ 翻页 / Space 下一页 / Esc 返回
   - 触摸：左右滑动翻页 / 上下滚动
   - 双击缩放单图
   ============================================ */

function ImageWaterfall() {
  const { currentUser } = useContext(AuthContext);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPath, setCurrentPath] = useState('');

  // 阅读模式：scroll = 连续滚动 / page = 单页翻页
  const [readMode, setReadMode] = useState(() => {
    return localStorage.getItem('waterfall_read_mode') || 'scroll';
  });

  // 翻页模式当前页
  const [currentPage, setCurrentPage] = useState(0);

  // 工具栏显示/隐藏
  const [showToolbar, setShowToolbar] = useState(true);
  const [showModeMenu, setShowModeMenu] = useState(false);

  // 滚动进度
  const [scrollProgress, setScrollProgress] = useState(0);

  // 单图缩放
  const [zoomedImage, setZoomedImage] = useState(null);

  // refs
  const scrollContainerRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const toolbarTimerRef = useRef(null);
  const lastTapRef = useRef(0);

  const BASE_URL = '';

  // 获取URL参数
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    return { path: params.get('path') || '' };
  }, []);

  // 获取图片列表
  const fetchImages = async () => {
    setLoading(true);
    setError('');

    try {
      const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null;
      const token = user?.token || '';
      const params = getUrlParams();
      const path = params.path;

      setCurrentPath(path);

      const apiUrl = `${BASE_URL}/api/files?dir=${encodeURIComponent(path)}&sort_by=name&sort_order=asc&token=${token}`;
      const response = await fetch(apiUrl);

      if (!response.ok) throw new Error('获取文件列表失败');

      const data = await response.json();
      const files = data.files || [];
      const imageFiles = files.filter(file => file.type === 'image');

      if (imageFiles.length === 0) {
        setError('当前文件夹中没有图片文件');
        setImages([]);
      } else {
        const imagesWithUrl = imageFiles.map(file => ({
          ...file,
          preview_url: `/file/${encodeURIComponent(file.path)}?token=${token}`
        }));
        setImages(imagesWithUrl);
      }
    } catch (err) {
      setError('获取图片失败: ' + err.message);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };

  // 返回
  const goBack = () => {
    const params = getUrlParams();
    const path = params.path;
    window.location.href = path ? `/files?dir=${encodeURIComponent(path)}` : '/files';
  };

  // 切换阅读模式
  const toggleReadMode = (mode) => {
    setReadMode(mode);
    setCurrentPage(0);
    setShowModeMenu(false);
    localStorage.setItem('waterfall_read_mode', mode);
  };

  // 翻页
  const goToPage = (page) => {
    const clamped = Math.max(0, Math.min(images.length - 1, page));
    setCurrentPage(clamped);
  };

  const nextPage = () => {
    if (currentPage < images.length - 1) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(prev => prev - 1);
    }
  };

  // 滚动进度计算
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const scrollTop = el.scrollTop;
    const scrollHeight = el.scrollHeight - el.clientHeight;
    const progress = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
    setScrollProgress(progress);

    // 滚动时自动隐藏工具栏
    if (toolbarTimerRef.current) clearTimeout(toolbarTimerRef.current);
    setShowToolbar(false);
    toolbarTimerRef.current = setTimeout(() => {
      setShowToolbar(true);
    }, 1500);
  }, []);

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (zoomedImage) return; // 缩放时不处理

      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          if (readMode === 'page') prevPage();
          break;
        case 'ArrowRight':
        case 'ArrowDown':
        case ' ':
          e.preventDefault();
          if (readMode === 'page') nextPage();
          break;
        case 'Escape':
          e.preventDefault();
          if (zoomedImage) setZoomedImage(null);
          else goBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readMode, currentPage, images.length, zoomedImage]);

  // 触摸手势（翻页模式）
  const handleTouchStart = (e) => {
    if (e.touches && e.touches[0]) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now()
      };
    }
  };

  const handleTouchEnd = (e) => {
    if (readMode !== 'page') return;

    const touch = e.changedTouches?.[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;

    // 快速横向滑动 → 翻页
    if (deltaTime < 500 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX > 0) prevPage();   // 右滑 = 上一页
      else nextPage();               // 左滑 = 下一页
    }
  };

  // 双击缩放
  const handleImageTap = (image, e) => {
    const now = Date.now();
    const timeDiff = now - lastTapRef.current;

    if (timeDiff < 300) {
      // 双击 → 缩放
      setZoomedImage(zoomedImage ? null : image);
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  // 工具栏点击
  const handleContentTap = (e) => {
    // 点击中间区域 → 翻页/显示工具栏
    if (readMode === 'page') {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;

      if (x < width * 0.3) {
        prevPage();
      } else if (x > width * 0.7) {
        nextPage();
      } else {
        setShowToolbar(prev => !prev);
      }
    } else {
      // 滚动模式：点击切换工具栏
      setShowToolbar(prev => !prev);
    }
  };

  // 初始化
  useEffect(() => {
    fetchImages();
  }, []);

  useEffect(() => {
    const handleUrlChange = () => fetchImages();
    window.addEventListener('popstate', handleUrlChange);
    return () => window.removeEventListener('popstate', handleUrlChange);
  }, []);

  // 翻页时滚动到顶部
  useEffect(() => {
    if (readMode === 'page' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [currentPage, readMode]);

  // 禁止 body 滚动
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // ========== 渲染 ==========

  // 加载中
  if (loading) {
    return (
      <div className="reader-container">
        <div className="reader-loading">
          <div className="reader-spinner"></div>
          <span>加载中...</span>
        </div>
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div className="reader-container">
        <div className="reader-error">
          <i className="fas fa-image" style={{ fontSize: '48px', opacity: 0.3, marginBottom: '16px' }}></i>
          <p>{error}</p>
          <button className="reader-btn" onClick={goBack}>返回文件列表</button>
        </div>
      </div>
    );
  }

  return (
    <div className="reader-container">
      {/* ===== 顶部工具栏 ===== */}
      <div className={`reader-toolbar ${showToolbar ? 'visible' : ''}`}>
        <button className="toolbar-btn" onClick={goBack} title="返回">
          <i className="fas fa-arrow-left"></i>
        </button>

        <div className="toolbar-title">
          {currentPath ? currentPath.split('/').pop() : '图片浏览'}
        </div>

        <div className="toolbar-actions">
          {/* 页码指示 */}
          <span className="toolbar-page-info">
            {readMode === 'page'
              ? `${currentPage + 1} / ${images.length}`
              : `${images.length} 张`
            }
          </span>

          {/* 模式切换按钮 */}
          <button
            className="toolbar-btn"
            onClick={() => setShowModeMenu(prev => !prev)}
            title="阅读模式"
          >
            <i className={`fas ${readMode === 'scroll' ? 'fa-arrows-alt-v' : 'fa-file'}`}></i>
          </button>
        </div>

        {/* 模式选择菜单 */}
        {showModeMenu && (
          <div className="mode-menu">
            <button
              className={`mode-menu-item ${readMode === 'scroll' ? 'active' : ''}`}
              onClick={() => toggleReadMode('scroll')}
            >
              <i className="fas fa-arrows-alt-v"></i>
              <span>连续滚动</span>
              <small>像看漫画一样流畅阅读</small>
            </button>
            <button
              className={`mode-menu-item ${readMode === 'page' ? 'active' : ''}`}
              onClick={() => toggleReadMode('page')}
            >
              <i className="fas fa-file"></i>
              <span>单页翻页</span>
              <small>左右滑动或点击翻页</small>
            </button>
          </div>
        )}
      </div>

      {/* ===== 内容区 ===== */}
      <div
        className={`reader-content ${readMode === 'page' ? 'page-mode' : 'scroll-mode'}`}
        ref={scrollContainerRef}
        onScroll={readMode === 'scroll' ? handleScroll : undefined}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onClick={handleContentTap}
      >
        {readMode === 'scroll' ? (
          /* ===== 滚动模式：连续长图 ===== */
          <div className="reader-scroll-images">
            {images.map((image, index) => (
              <div key={image.path} className="reader-image-slot" data-index={index}>
                <img
                  src={image.preview_url}
                  alt={image.name}
                  className="reader-image"
                  loading={index < 3 ? 'eager' : 'lazy'}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleImageTap(image, e);
                  }}
                />
              </div>
            ))}
            {/* 底部间距 */}
            <div className="reader-scroll-end">
              <span>已浏览全部 {images.length} 张图片</span>
            </div>
          </div>
        ) : (
          /* ===== 翻页模式：单页 ===== */
          <div className="reader-page-view">
            {images[currentPage] && (
              <div className="reader-page-image-wrapper">
                <img
                  src={images[currentPage].preview_url}
                  alt={images[currentPage].name}
                  className="reader-page-image"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleImageTap(images[currentPage], e);
                  }}
                />
              </div>
            )}

            {/* 翻页热区提示 */}
            <div className="page-tap-zone left" onClick={(e) => { e.stopPropagation(); prevPage(); }}>
              {currentPage > 0 && <i className="fas fa-chevron-left"></i>}
            </div>
            <div className="page-tap-zone right" onClick={(e) => { e.stopPropagation(); nextPage(); }}>
              {currentPage < images.length - 1 && <i className="fas fa-chevron-right"></i>}
            </div>
          </div>
        )}
      </div>

      {/* ===== 底部进度条 ===== */}
      <div className={`reader-bottom-bar ${showToolbar ? 'visible' : ''}`}>
        {/* 翻页模式：进度条 + 页码 */}
        {readMode === 'page' && (
          <>
            <button
              className="toolbar-btn small"
              onClick={(e) => { e.stopPropagation(); prevPage(); }}
              disabled={currentPage === 0}
            >
              <i className="fas fa-chevron-left"></i>
            </button>

            <div className="reader-progress-bar" onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              goToPage(Math.floor(ratio * images.length));
            }}>
              <div
                className="reader-progress-fill"
                style={{ width: `${((currentPage + 1) / images.length) * 100}%` }}
              ></div>
              {/* 缩略标记 */}
              <div className="reader-progress-thumb"
                style={{ left: `${((currentPage + 1) / images.length) * 100}%` }}
              ></div>
            </div>

            <button
              className="toolbar-btn small"
              onClick={(e) => { e.stopPropagation(); nextPage(); }}
              disabled={currentPage === images.length - 1}
            >
              <i className="fas fa-chevron-right"></i>
            </button>
          </>
        )}

        {/* 滚动模式：进度条 */}
        {readMode === 'scroll' && (
          <div className="reader-progress-bar">
            <div
              className="reader-progress-fill"
              style={{ width: `${scrollProgress * 100}%` }}
            ></div>
          </div>
        )}

        <span className="reader-page-label">
          {readMode === 'page'
            ? `${currentPage + 1} / ${images.length}`
            : `${Math.round(scrollProgress * images.length)} / ${images.length}`
          }
        </span>
      </div>

      {/* ===== 图片缩放浮层 ===== */}
      {zoomedImage && (
        <div className="reader-zoom-overlay" onClick={() => setZoomedImage(null)}>
          <img
            src={zoomedImage.preview_url}
            alt={zoomedImage.name}
            className="reader-zoom-image"
            onClick={(e) => e.stopPropagation()}
          />
          <button className="reader-zoom-close" onClick={() => setZoomedImage(null)}>
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}
    </div>
  );
}

export default ImageWaterfall;
