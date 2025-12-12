import React, { useContext } from 'react'
import { AuthContext } from '../App'

function Header() {
  const { isAuthenticated, currentUser, handleLogout } = useContext(AuthContext)

  return (
    <header className="header">
      <div className="container">
        <div className="navbar">
          <h1>文件预览服务器</h1>
          {isAuthenticated && (
            <nav>
              <ul className="nav-links">
                <li>{currentUser.username}</li>
                {currentUser.isAdmin && (
                  <li><a href="#">管理后台</a></li>
                )}
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