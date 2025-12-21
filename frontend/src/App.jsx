import React, { useState, useEffect, createContext, useContext, useMemo, useCallback } from 'react'
import Login from './components/Login'
import FileList from './components/FileList'
import Preview from './components/Preview'
import Admin from './components/Admin'
import Header from './components/Header'
import Footer from './components/Footer'
import FavoriteList from './components/FavoriteList'

// 基础URL使用空字符串，这样会使用相对路径，从而利用Vite的代理配置
const BASE_URL = '';

// 创建身份验证上下文
export const AuthContext = createContext()

function App() {
  // 状态管理
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [viewedFiles, setViewedFiles] = useState(() => {
    // 初始化时直接从localStorage加载已查阅文件列表
    const savedViewedFiles = localStorage.getItem('viewedFiles')
    return savedViewedFiles ? JSON.parse(savedViewedFiles) : []
  })

  // 管理员组件切换状态
  const [adminView, setAdminView] = useState(() => {
    // 检查sessionStorage中的view状态
    const savedView = sessionStorage.getItem('view')
    if (savedView === 'favorites') {
      // 清除sessionStorage中的view状态
      sessionStorage.removeItem('view')
      return 'favorites'
    }
    return 'fileList'
  })
  
  // 视图切换状态 - 普通用户
  const [userView, setUserView] = useState(() => {
    // 检查sessionStorage中的view状态
    const savedView = sessionStorage.getItem('view')
    if (savedView === 'favorites') {
      // 清除sessionStorage中的view状态
      sessionStorage.removeItem('view')
      return 'favorites'
    }
    return 'fileList'
  })

  // 收藏功能状态管理
  const [favoriteFiles, setFavoriteFiles] = useState([])

  // 使用useCallback优化已查阅文件相关函数
  const addViewedFile = useCallback((filePath) => {
    if (!viewedFiles.includes(filePath)) {
      setViewedFiles([...viewedFiles, filePath])
    }
  }, [viewedFiles])

  // 检查文件是否已查阅
  const isFileViewed = useCallback((filePath) => {
    return viewedFiles.includes(filePath)
  }, [viewedFiles])

  // 登录处理
  const handleLogin = useCallback((user) => {
    // 直接使用后端返回的用户对象（已包含token）
    const userWithToken = {
      ...user,
      password: undefined // 确保移除密码字段
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

  // 从localStorage加载认证状态和已查阅文件
  useEffect(() => {
    // 处理路由：确保/files路径能正确处理查询参数
    const handleRouteChange = () => {
      const path = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)
      const dir = searchParams.get('dir') || ''
      const view = searchParams.get('view') || ''
      
      // 检查view参数，设置正确的视图
      if (view === 'favorites') {
        setAdminView('favorites')
        setUserView('favorites')
        // 清除URL中的view参数，避免影响后续操作
        const newSearchParams = new URLSearchParams()
        if (dir) {
          newSearchParams.set('dir', dir)
        }
        // 替换当前URL，不添加到浏览器历史记录
        window.history.replaceState(null, '', `/files?${newSearchParams.toString()}`)
      }
      
      if (path === '/files' || path === '/preview') {
        // /files和/preview路径已经是正确的，不需要修改
        return
      } else if (path !== '/') {
        // 其他路径转换为/files路径
        const newDir = dir || path.slice(1)
        // 构建新的URL
        const newSearchParams = new URLSearchParams()
        if (newDir) {
          newSearchParams.set('dir', newDir)
        }
        // 替换当前URL，不添加到浏览器历史记录
        window.history.replaceState(null, '', `/files?${newSearchParams.toString()}`)
      }
    }

    // 初始加载时处理路由
    handleRouteChange()

    // 加载已保存的用户信息
    const savedUser = localStorage.getItem('user')
    if (savedUser) {
      let user = JSON.parse(savedUser)
      // 如果用户没有token，为其生成一个
      if (!user.token || !user.token.includes('-token')) {
        const token = `${user.username}-token-${Date.now()}`
        user = {
          ...user,
          token
        }
        // 更新localStorage中的用户信息
        localStorage.setItem('user', JSON.stringify(user))
      }
      setIsAuthenticated(true)
      setCurrentUser(user)
    }
    
    // 监听URL变化（仅当用户使用浏览器前进/后退按钮时）
    window.addEventListener('popstate', handleRouteChange)
    
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
    }
  }
  }, [])

  // 当用户登录成功后，加载收藏文件
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      loadFavorites()
    }
  }, [isAuthenticated, currentUser, loadFavorites])

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
      loadFavorites,
      addFavorite,
      removeFavorite,
      isFileFavorite
    };
  }, [isAuthenticated, currentUser, handleLogin, handleLogout, addViewedFile, isFileViewed, favoriteFiles, loadFavorites, addFavorite, removeFavorite, isFileFavorite]);

  // 添加连续点击检测逻辑
  const [clickCount, setClickCount] = useState(0)
  const [lastClickTime, setLastClickTime] = useState(0)
  const [showAdminButton, setShowAdminButton] = useState(false)

  // 处理文件列表按钮点击
  const handleFileListClick = () => {
    const now = Date.now()
    const timeDiff = now - lastClickTime
    
    // 重置点击计数如果超过2秒
    if (timeDiff > 2000) {
      setClickCount(1)
    } else {
      setClickCount(prev => prev + 1)
    }
    
    setLastClickTime(now)
    
    // 连续点击5次，显示或切换到用户管理
    if (clickCount + 1 === 5) {
      setShowAdminButton(true)
      // 直接切换到用户管理
      setAdminView('admin')
      // 重置点击计数
      setClickCount(0)
    } else {
      // 正常点击，切换到文件列表并隐藏用户管理按钮
      setAdminView('fileList')
      // 返回文件列表时，默认继续隐藏用户管理
      setShowAdminButton(false)
    }
  }

  // 路由处理
  const getCurrentComponent = () => {
    const path = window.location.pathname
    
    if (!isAuthenticated) {
      return <Login />
    }
    
    if (path === '/preview') {
      return <Preview />
    }
    
    if (currentUser.isAdmin) {
      return (
        <>
          {/* 管理员导航菜单 */}
          <div className="admin-nav">
            <button 
              className={adminView === 'fileList' ? 'active' : ''}
              onClick={handleFileListClick}
            >
              文件列表
            </button>
            {showAdminButton && (
              <button 
                className={adminView === 'admin' ? 'active' : ''}
                onClick={() => setAdminView('admin')}
              >
                用户管理
              </button>
            )}
            <button 
              className={adminView === 'favorites' ? 'active' : ''}
              onClick={() => setAdminView('favorites')}
            >
              收藏列表
            </button>
          </div>
          
          {/* 根据选择显示对应的组件 */}
          {adminView === 'fileList' ? <FileList /> : adminView === 'admin' ? <Admin /> : <FavoriteList />}
        </>
      )
    }
    
    // 普通用户视图切换
    return (
      <>
        {/* 用户导航菜单 */}
        <div className="user-nav">
          <button 
            className={userView === 'fileList' ? 'active' : ''}
            onClick={() => setUserView('fileList')}
          >
            文件列表
          </button>
          <button 
            className={userView === 'favorites' ? 'active' : ''}
            onClick={() => setUserView('favorites')}
          >
            收藏列表
          </button>
        </div>
        
        {/* 根据选择显示对应的组件 */}
        {userView === 'fileList' ? <FileList /> : <FavoriteList />}
      </>
    )
  }

  return (
    <AuthContext.Provider value={authContextValue}>
      <div className="app">
        <Header />
        <div className="container">
          {getCurrentComponent()}
        </div>
        <Footer />
      </div>
    </AuthContext.Provider>
  )
}

export default App