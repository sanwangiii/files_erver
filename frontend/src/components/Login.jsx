import React, { useState, useContext, useEffect, useCallback } from 'react'
import { AuthContext } from '../App'

// 简单的MD5哈希函数（用于演示，实际项目应使用更安全的哈希算法）
const md5 = (str) => {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// 默认用户数据常量
const DEFAULT_USERS = [
  {
    id: 1,
    username: 'admin',
    password: md5('admin123'), // 哈希后的密码
    isAdmin: true,
    permissions: ['*'], // 管理员可以访问所有文件夹
    token: 'admin-token' // 模拟认证token
  },
  {
    id: 2,
    username: 'user3',
    password: md5('user123'), // 哈希后的密码
    isAdmin: false,
    permissions: [''], // 给普通用户添加根目录权限
    token: 'user1-token' // 模拟认证token
  },
  {
    id: 3,
    username: 'user2',
    password: md5('user123'), // 哈希后的密码
    isAdmin: false,
    permissions: [''], // 给普通用户添加根目录权限
    token: 'user2-token' // 模拟认证token
  }
]

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const { handleLogin } = useContext(AuthContext)

  // 从localStorage加载用户数据和上次登录的用户名
  useEffect(() => {
    // 加载用户数据
    const savedUsers = localStorage.getItem('users')
    if (savedUsers) {
      // 使用localStorage中已有的用户数据，不再自动覆盖
      setUsers(JSON.parse(savedUsers))
    } else {
      // 仅在localStorage中没有用户数据时才初始化默认数据
      setUsers(DEFAULT_USERS)
      localStorage.setItem('users', JSON.stringify(DEFAULT_USERS))
    }
    
    // 加载上次登录的用户名
    const lastUsername = localStorage.getItem('lastUsername')
    if (lastUsername) {
      setUsername(lastUsername)
    }
  }, [])

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    setError('')

    // 验证输入
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }

    // 查找用户（比较哈希后的密码）
    const user = users.find(u => u.username === username && u.password === md5(password))

    if (user) {
      // 创建一个不包含密码的用户对象用于登录
      const userWithoutPassword = {
        ...user,
        password: undefined // 移除密码字段
      }
      // 存储上次登录的用户名
      localStorage.setItem('lastUsername', username)
      handleLogin(userWithoutPassword)
    } else {
      setError('用户名或密码错误')
      // 清空密码字段
      setPassword('')
    }
  }, [username, password, users, handleLogin])

  return (
    <div className="login-form">
      <h2>文件预览服务器登录</h2>
      {error && <div className="error-message">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="username">用户名</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">密码</label>
          <div className="password-input-container">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="请输入密码"
            />
            <button
              type="button"
              className="toggle-password-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? (
                <i className="fas fa-eye-slash"></i>
              ) : (
                <i className="fas fa-eye"></i>
              )}
            </button>
          </div>
        </div>
        <button type="submit" className="btn">登录</button>
      </form>
    </div>
  )
}

export default Login