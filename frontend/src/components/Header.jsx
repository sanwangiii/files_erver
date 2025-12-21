import React, { useContext, useState, useEffect } from 'react'
import { AuthContext } from '../App'

function Header() {
  const { isAuthenticated, currentUser, handleLogout } = useContext(AuthContext)
  const [currentTime, setCurrentTime] = useState(new Date())

  // 实时更新时间
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  // 格式化时间
  const formatTime = (date) => {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  return (
    <header className="header">
      <div className="container">
        <div className="navbar">
          <h1>文件预览服务器</h1>
          {isAuthenticated && (
            <nav>
              <ul className="nav-links">
                <li className="username-display">欢迎, {currentUser.username}</li>
                <li className="time-display">{formatTime(currentTime)}</li>
                <li>
                  <button onClick={handleLogout} className="btn btn-secondary">
                    退出登录
                  </button>
                </li>
              </ul>
            </nav>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header