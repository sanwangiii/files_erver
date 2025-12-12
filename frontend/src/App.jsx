import React, { useState, useEffect, createContext, useContext, useMemo } from 'react'
import Login from './components/Login'
import FileList from './components/FileList'
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
      
      if (path === '/files') {
        // /files路径已经是正确的，不需要修改
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
      const user = JSON.parse(savedUser)
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
  const handleLogin = (user) => {
    // 创建一个不包含密码的用户对象
    const userWithoutPassword = {
      ...user,
      password: undefined // 移除密码字段
    }
    setIsAuthenticated(true)
    setCurrentUser(userWithoutPassword)
    localStorage.setItem('user', JSON.stringify(userWithoutPassword))
  }

  // 登出处理
  const handleLogout = () => {
    setIsAuthenticated(false)
    setCurrentUser(null)
    localStorage.removeItem('user')
  }

  // 添加已查阅文件
  const addViewedFile = (filePath) => {
    if (!viewedFiles.includes(filePath)) {
      setViewedFiles([...viewedFiles, filePath])
    }
  }

  // 检查文件是否已查阅
  const isFileViewed = (filePath) => {
    return viewedFiles.includes(filePath)
  }

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
  }, [isAuthenticated, currentUser, viewedFiles]);

  return (
    <AuthContext.Provider value={authContextValue}>
      <div className="app">
        <Header />
        <div className="container">
          {!isAuthenticated ? (
            <Login />
          ) : currentUser.isAdmin ? (
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
          ) : (
            <FileList />
          )}
        </div>
        <Footer />
      </div>
    </AuthContext.Provider>
  )
}

export default App