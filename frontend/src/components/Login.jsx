import React, { useState, useContext, useEffect } from 'react'
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

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const { handleLogin } = useContext(AuthContext)

  // 从localStorage加载用户数据和上次登录的用户名
  useEffect(() => {
    // 定义默认用户数据（仅在第一次初始化时使用）
    const defaultUsers = [
      {
        id: 1,
        username: 'admin',
        password: md5('admin123'), // 哈希后的密码
        isAdmin: true,
        permissions: ['*'], // 管理员可以访问所有文件夹
        token: 'admin-token' // 模拟认证token
      },
      {        id: 2,
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
    
    // 加载用户数据
    const savedUsers = localStorage.getItem('users')
    if (savedUsers) {
      // 使用localStorage中已有的用户数据，不再自动覆盖
      setUsers(JSON.parse(savedUsers))
    } else {
      // 仅在localStorage中没有用户数据时才初始化默认数据
      setUsers(defaultUsers)
      localStorage.setItem('users', JSON.stringify(defaultUsers))
    }
    
    // 加载上次登录的用户名
    const lastUsername = localStorage.getItem('lastUsername')
    if (lastUsername) {
      setUsername(lastUsername)
    }
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

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
    }
  }

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
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn">登录</button>
      </form>
    </div>
  )
}

export default Login