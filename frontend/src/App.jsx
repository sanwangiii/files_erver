import React, { useState, useEffect, createContext, useContext, useMemo, useCallback, lazy, Suspense } from 'react'
import Login from './components/Login'
import FileList from './components/FileList'
import Header from './components/Header'
import Footer from './components/Footer'
import FavoriteList from './components/FavoriteList'

// 路由级懒加载：Preview 和 ImageWaterfall 体积大，按需加载
const Preview = lazy(() => import('./components/Preview'))
const ImageWaterfall = lazy(() => import('./components/ImageWaterfall'))
const Admin = lazy(() => import('./components/Admin'))

// 基础URL使用空字符串，这样会使用相对路径，从而利用Vite的代理配置
const BASE_URL = '';

// 创建身份验证上下文
export const AuthContext = createContext()

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [viewedFiles, setViewedFiles] = useState(() => {
    const savedViewedFiles = localStorage.getItem('viewedFiles')
    return savedViewedFiles ? JSON.parse(savedViewedFiles) : []
  })

  // 当前页面路径（state-based 路由）
  const [currentPage, setCurrentPage] = useState(() => window.location.pathname)

  // 管理员组件切换状态
  const [adminView, setAdminView] = useState(() => {
    const savedView = sessionStorage.getItem('view')
    if (savedView === 'favorites') {
      sessionStorage.removeItem('view')
      return 'favorites'
    }
    return 'fileList'
  })
  
  // 视图切换状态 - 普通用户
  const [userView, setUserView] = useState(() => {
    const savedView = sessionStorage.getItem('view')
    if (savedView === 'favorites') {
      sessionStorage.removeItem('view')
      return 'favorites'
    }
    return 'fileList'
  })

  // 收藏功能状态管理
  const [favoriteFiles, setFavoriteFiles] = useState([])

  // 客户端路由导航函数：不刷新页面
  const navigate = useCallback((path) => {
    window.history.pushState(null, '', path)
    setCurrentPage(path.split('?')[0])
  }, [])

  // 使用useCallback优化已查阅文件相关函数
  const addViewedFile = useCallback((filePath) => {
    setViewedFiles(prev => {
      if (prev.includes(filePath)) return prev
      return [...prev, filePath]
    })
  }, [])

  // 检查文件是否已查阅
  const isFileViewed = useCallback((filePath) => {
    return viewedFiles.includes(filePath)
  }, [viewedFiles])

  // 登录处理
  const handleLogin = useCallback((user) => {
    const userWithToken = {
      ...user,
      password: undefined
    }
    setIsAuthenticated(true)
    setCurrentUser(userWithToken)
    localStorage.setItem('user', JSON.stringify(userWithToken))
    localStorage.setItem('isAuthenticated', 'true')
  }, [])

  // 登出处理
  const handleLogout = useCallback(() => {
    setIsAuthenticated(false)
    setCurrentUser(null)
    setViewedFiles([])
    localStorage.removeItem('user')
    localStorage.removeItem('viewedFiles')
  }, [])

  // 加载收藏文件
  const loadFavorites = useCallback(async () => {
    if (!isAuthenticated || !currentUser) return
    
    try {
      const response = await fetch(`${BASE_URL}/api/favorites`, {
        headers: {
          'Authorization': `Bearer ${currentUser.token}`
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        setFavoriteFiles(data.favorites || [])
      }
    } catch (error) {
      console.error('加载收藏文件失败:', error)
    }
  }, [isAuthenticated, currentUser])

  // 添加收藏
  const addFavorite = useCallback(async (file) => {
    if (!isAuthenticated || !currentUser) return
    
    try {
      const response = await fetch(`${BASE_URL}/api/favorites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentUser.token}`
        },
        body: JSON.stringify({
          path: file.path,
          name: file.name,
          type: file.type,
          size: file.size,
          modified: file.modified
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.favorite) {
          setFavoriteFiles(prev => [...prev, data.favorite])
        }
      }
    } catch (error) {
      console.error('添加收藏失败:', error)
    }
  }, [isAuthenticated, currentUser])

  // 删除收藏
  const removeFavorite = useCallback(async (filePath) => {
    if (!isAuthenticated || !currentUser) return
    
    try {
      const response = await fetch(`${BASE_URL}/api/favorites/delete_by_path`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentUser.token}`
        },
        body: JSON.stringify({ path: filePath })
      })
      
      if (response.ok) {
        setFavoriteFiles(prev => prev.filter(fav => fav.path !== filePath))
      }
    } catch (error) {
      console.error('删除收藏失败:', error)
    }
  }, [isAuthenticated, currentUser])

  // 检查文件是否已收藏
  const isFileFavorite = useCallback((filePath) => {
    return favoriteFiles.some(fav => fav.path === filePath)
  }, [favoriteFiles])

  // 初始化：加载认证状态 + 监听浏览器前进/后退
  useEffect(() => {
    const handleRouteChange = () => {
      const path = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)
      const view = searchParams.get('view')
      
      if (view === 'favorites') {
        setAdminView('favorites')
        setUserView('favorites')
        const newSearchParams = new URLSearchParams()
        const dir = searchParams.get('dir')
        if (dir) newSearchParams.set('dir', dir)
        window.history.replaceState(null, '', `/files?${newSearchParams.toString()}`)
      }
      
      // 转换非法路径
      if (path !== '/files' && path !== '/preview' && path !== '/waterfall' && path !== '/') {
        const dir = searchParams.get('dir') || path.slice(1)
        const newSearchParams = new URLSearchParams()
        if (dir) newSearchParams.set('dir', dir)
        window.history.replaceState(null, '', `/files?${newSearchParams.toString()}`)
      }
      
      setCurrentPage(window.location.pathname)
    }

    handleRouteChange()

    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      let user = JSON.parse(savedUser)
      if (!user.token || user.token.includes('-token')) {
        localStorage.removeItem('user')
        localStorage.removeItem('isAuthenticated')
      } else {
        setIsAuthenticated(true)
        setCurrentUser(user)
      }
    }
    
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  // 当用户登录成功后，加载收藏文件
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      loadFavorites()
    }
  }, [isAuthenticated, currentUser])

  // 保存已查阅文件到localStorage
  useEffect(() => {
    localStorage.setItem('viewedFiles', JSON.stringify(viewedFiles))
  }, [viewedFiles])

  // 使用useMemo优化AuthContext的value，避免不必要的重渲染
  const authContextValue = useMemo(() => {
    return {
      isAuthenticated,
      currentUser,
      handleLogin,
      handleLogout,
      addViewedFile,
      isFileViewed,
      favoriteFiles,
      addFavorite,
      removeFavorite,
      isFileFavorite,
      navigate
    };
  }, [isAuthenticated, currentUser, handleLogin, handleLogout, addViewedFile, isFileViewed, favoriteFiles, addFavorite, removeFavorite, isFileFavorite, navigate]);

  // 添加连续点击检测逻辑
  const [clickCount, setClickCount] = useState(0)
  const [lastClickTime, setLastClickTime] = useState(0)
  const [showAdminButton, setShowAdminButton] = useState(false)

  // 处理文件列表按钮点击
  const handleFileListClick = () => {
    const now = Date.now()
    const timeDiff = now - lastClickTime
    
    if (timeDiff > 2000) {
      setClickCount(1)
    } else {
      setClickCount(prev => prev + 1)
    }
    
    setLastClickTime(now)
    
    if (clickCount + 1 === 5) {
      setShowAdminButton(true)
      setAdminView('admin')
      setClickCount(0)
    } else {
      setAdminView('fileList')
      setShowAdminButton(false)
    }
  }

  // 路由渲染
  const renderPage = () => {
    const loadingFallback = <div className="loading"><div className="loading-spinner"></div></div>

    if (!isAuthenticated) {
      return <Login />
    }
    
    if (currentPage === '/preview') {
      return <Suspense fallback={loadingFallback}><Preview /></Suspense>
    }
    
    if (currentPage === '/waterfall') {
      return <Suspense fallback={loadingFallback}><ImageWaterfall /></Suspense>
    }
    
    if (currentUser.isAdmin) {
      return (
        <>
          <div className="admin-nav">
            <button 
              className={adminView === 'fileList' ? 'active' : ''}
              onClick={handleFileListClick}
            >
              <i className="fa-solid fa-folder-open" style={{ marginRight: '6px' }}></i>文件列表
            </button>
            {showAdminButton && (
              <button 
                className={adminView === 'admin' ? 'active' : ''}
                onClick={() => setAdminView('admin')}
              >
                <i className="fa-solid fa-users-gear" style={{ marginRight: '6px' }}></i>用户管理
              </button>
            )}
            <button 
              className={adminView === 'favorites' ? 'active' : ''}
              onClick={() => setAdminView('favorites')}
            >
              <i className="fa-solid fa-star" style={{ marginRight: '6px' }}></i>收藏列表
            </button>
          </div>
          
          {adminView === 'fileList' ? <FileList /> : adminView === 'admin' ? <Suspense fallback={loadingFallback}><Admin /></Suspense> : <FavoriteList />}
        </>
      )
    }
    
    return (
      <>
        <div className="user-nav">
          <button 
            className={userView === 'fileList' ? 'active' : ''}
            onClick={() => setUserView('fileList')}
          >
            <i className="fa-solid fa-folder-open" style={{ marginRight: '6px' }}></i>文件列表
          </button>
          <button 
            className={userView === 'favorites' ? 'active' : ''}
            onClick={() => setUserView('favorites')}
          >
            <i className="fa-solid fa-star" style={{ marginRight: '6px' }}></i>收藏列表
          </button>
        </div>
        
        {userView === 'fileList' ? <FileList /> : <FavoriteList />}
      </>
    )
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <div className="app">
        <Header />
        <div className="container">
          {renderPage()}
        </div>
        <Footer />
      </div>
    </AuthContext.Provider>
  )
}

export default App
