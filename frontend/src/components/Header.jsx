import React, { useContext, useState, useEffect } from 'react'
import { AuthContext } from '../App'

function Header() {
  const { isAuthenticated, currentUser, handleLogout } = useContext(AuthContext)
  const [currentTime, setCurrentTime] = useState(new Date())
  const [menuOpen, setMenuOpen] = useState(false)

  // 实时更新时间
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = () => setMenuOpen(false)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [menuOpen])

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

  const handleLogoutClick = () => {
    setMenuOpen(false)
    handleLogout()
  }

  return (
    <header className="header">
      <div className="navbar">
        <h1><i className="fa-solid fa-server" style={{ marginRight: '10px', fontSize: '16px', opacity: 0.7 }}></i>文件预览服务器</h1>
        {isAuthenticated && (
          <>
            {/* 桌面端导航 */}
            <nav className="nav-desktop">
              <ul className="nav-links">
                <li className="username-display">欢迎, {currentUser.username}</li>
                <li className="time-display">{formatTime(currentTime)}</li>
                <li>
                  <button onClick={handleLogoutClick} className="btn btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}>
                    退出登录
                  </button>
                </li>
              </ul>
            </nav>

            {/* 移动端汉堡菜单按钮 */}
            <button
              className="mobile-menu-btn"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              aria-label="菜单"
            >
              <i className={`fa-solid ${menuOpen ? 'fa-xmark' : 'fa-bars'}`}></i>
            </button>
          </>
        )}
      </div>

      {/* 移动端下拉菜单 */}
      {isAuthenticated && menuOpen && (
        <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-menu-item">
            <i className="fa-solid fa-user"></i>
            <span>{currentUser.username}</span>
          </div>
          <div className="mobile-menu-item">
            <i className="fa-regular fa-clock"></i>
            <span>{formatTime(currentTime)}</span>
          </div>
          <div className="mobile-menu-divider"></div>
          <button className="mobile-menu-item mobile-menu-logout" onClick={handleLogoutClick}>
            <i className="fa-solid fa-right-from-bracket"></i>
            <span>退出登录</span>
          </button>
        </div>
      )}
    </header>
  )
}

export default Header