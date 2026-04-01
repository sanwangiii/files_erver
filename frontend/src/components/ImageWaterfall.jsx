import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { AuthContext } from '../App';

function ImageWaterfall() {
  const { currentUser } = useContext(AuthContext);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  
  const BASE_URL = '';
  
  // 获取URL参数
  const getUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get('path') || '';
    console.log('=== 获取URL参数 ===');
    console.log('完整URL:', window.location.href);
    console.log('搜索参数:', window.location.search);
    console.log('解析的path参数:', path);
    return {
      path: path
    };
  }, []);
  
  // 获取当前文件夹的所有图片
  const fetchImages = async () => {
    setLoading(true);
    setError('');
    
    try {
      const user = currentUser || JSON.parse(localStorage.getItem('user') || 'null') || null;
      const token = user?.token || '';
      const params = getUrlParams();
      const path = params.path;
      
      console.log('=== 瀑布预览路径信息 ===');
      console.log('URL参数:', params);
      console.log('当前路径:', path);
      console.log('用户信息:', user);
      console.log('Token:', token ? '有token' : '无token');
      
      setCurrentPath(path);
      
      // 构建API URL，使用与Preview组件相同的方式传递token
      const apiUrl = `${BASE_URL}/api/files?dir=${encodeURIComponent(path)}&sort_by=name&sort_order=asc&token=${token}`;
      console.log('构建的API URL:', apiUrl);
      
      const response = await fetch(apiUrl);
      
      if (!response.ok) {
        throw new Error('获取文件列表失败');
      }
      
      const data = await response.json();
      const files = data.files || [];
      
      // 过滤出图片文件
      const imageFiles = files.filter(file => file.type === 'image');
      
      if (imageFiles.length === 0) {
        setError('当前文件夹中没有图片文件');
        setImages([]);
      } else {
        // 为每个图片添加完整的预览URL
        const imagesWithUrl = imageFiles.map(file => {
          console.log('=== 图片文件信息 ===');
          console.log('文件名:', file.name);
          console.log('文件路径:', file.path);
          console.log('构建的预览URL:', `/file/${encodeURIComponent(file.path)}?token=${token}`);
          return {
            ...file,
            preview_url: `/file/${encodeURIComponent(file.path)}?token=${token}`
          };
        });
        setImages(imagesWithUrl);
      }
    } catch (err) {
      setError('获取图片失败: ' + err.message);
      setImages([]);
    } finally {
      setLoading(false);
    }
  };
  

  
  // 返回上一页
  const goBack = () => {
    const params = getUrlParams();
    const path = params.path;
    
    if (path) {
      window.location.href = `/files?dir=${encodeURIComponent(path)}`;
    } else {
      window.location.href = '/files';
    }
  };
  
  // 组件挂载时加载图片
  useEffect(() => {
    fetchImages();
  }, []);
  
  // 监听URL变化，确保路径参数正确
  useEffect(() => {
    const handleUrlChange = () => {
      fetchImages();
    };
    
    // 监听popstate事件（浏览器前进/后退）
    window.addEventListener('popstate', handleUrlChange);
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);
  
  // 阻止事件冒泡，防止左右滑动影响页面滚动
  useEffect(() => {
    const waterfallContainer = document.querySelector('.image-waterfall-container.fullscreen');
    let startX = 0;
    let startY = 0;
    
    const handleTouchStart = (e) => {
      // 记录触摸开始位置
      if (e.touches && e.touches[0]) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      }
      // 阻止触摸开始事件冒泡
      e.stopPropagation();
    };
    
    const handleTouchMove = (e) => {
      // 计算触摸移动距离
      if (e.touches && e.touches[0]) {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - startX;
        const deltaY = currentY - startY;
        
        // 只阻止水平方向的滚动，允许垂直滚动
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          // 水平滑动，阻止默认行为和冒泡
          e.stopPropagation();
          e.preventDefault();
        } else {
          // 垂直滑动，只阻止冒泡，允许默认滚动行为
          e.stopPropagation();
        }
      }
    };
    
    const handleTouchEnd = (e) => {
      // 阻止触摸结束事件冒泡
      e.stopPropagation();
    };
    
    const handleWheel = (e) => {
      // 阻止滚轮事件冒泡
      e.stopPropagation();
    };
    
    if (waterfallContainer) {
      waterfallContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
      waterfallContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
      waterfallContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
      waterfallContainer.addEventListener('wheel', handleWheel, { passive: true });
    }
    
    return () => {
      if (waterfallContainer) {
        waterfallContainer.removeEventListener('touchstart', handleTouchStart);
        waterfallContainer.removeEventListener('touchmove', handleTouchMove);
        waterfallContainer.removeEventListener('touchend', handleTouchEnd);
        waterfallContainer.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);
  

  
  return (
    <div className="image-waterfall-container fullscreen">
      {/* 头部 */}
      <div className="waterfall-header">
        <button className="back-btn" onClick={goBack}>
          <i className="fas fa-arrow-left"></i> 返回
        </button>
        <h1 className="waterfall-title">
          瀑布预览 - {currentPath ? currentPath : '根目录'}
        </h1>
        <div className="waterfall-info">
          {images.length > 0 && (
            <span>共 {images.length} 张图片</span>
          )}
        </div>
      </div>
      
      {/* 内容 */}
      <div className="waterfall-content fullscreen-content">
        {loading ? (
          <div className="waterfall-loading">加载中...</div>
        ) : error ? (
          <div className="waterfall-error">{error}</div>
        ) : images.length > 0 ? (
          <div className="waterfall-grid">
            {images.map((image, index) => (
              <div key={image.path} className="waterfall-grid-item">
                <img 
                  src={image.preview_url} 
                  alt={image.name}
                  className="waterfall-grid-image"
                />
                <div className="waterfall-grid-name">{image.name}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="waterfall-error">没有找到图片文件</div>
        )}
      </div>
      

    </div>
  );
}

export default ImageWaterfall;