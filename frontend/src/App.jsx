import React, { useState, useEffect, createContext, useContext, useMemo, useCallback } from 'react'
import Login from './components/Login'
import FileList from './components/FileList'
import Preview from './components/Preview'
import Admin from './components/Admin'
import Header from './components/Header'
import Footer from './components/Footer'

// 创建身份验证上下文
export const AuthContext = createContext()

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [viewedFiles, setViewedFiles] = useState([])

  // 从localStorage加载认证状态和已查阅文件
  useEffect(() => {
    // 处理路由：确保/files路径能正确处理查询参数
    const handleRouteChange = () => {
      const path = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)
      const dir = searchParams.get('dir') || ''
      
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
    
    // 加载已查阅文件
    const savedViewedFiles = localStorage.getItem('viewedFiles')
    if (savedViewedFiles) {
      setViewedFiles(JSON.parse(savedViewedFiles))
    }
  }, [])

  // 保存已查阅文件到localStorage
  useEffect(() => {
    localStorage.setItem('viewedFiles', JSON.stringify(viewedFiles))
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

  // 管理员组件切换状态
  const [adminView, setAdminView] = useState('fileList')

  // 使用useMemo优化AuthContext的value，避免不必要的重渲染
  const authContextValue = useMemo(() => {
    return {
      isAuthenticated,
      currentUser,
      handleLogin,
      handleLogout,
      addViewedFile,
      isFileViewed
    };
  }, [isAuthenticated, currentUser, handleLogin, handleLogout, addViewedFile, isFileViewed]);

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
              onClick={() => setAdminView('fileList')}
            >
              文件列表
            </button>
            <button 
              className={adminView === 'admin' ? 'active' : ''}
              onClick={() => setAdminView('admin')}
            >
              用户管理
            </button>
          </div>
          
          {/* 根据选择显示对应的组件 */}
          {adminView === 'fileList' ? <FileList /> : <Admin />}
        </>
      )
    }
    
    return <FileList />
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