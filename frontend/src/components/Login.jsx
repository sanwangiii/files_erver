import React, { useState, useContext, useEffect, useCallback } from 'react'
import { AuthContext } from '../App'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [users, setUsers] = useState([])
  const [showPassword, setShowPassword] = useState(false)
  const { handleLogin } = useContext(AuthContext)

  // 从后端加载用户数据和上次登录的用户名
  useEffect(() => {
    // 加载上次登录的用户名
    const lastUsername = localStorage.getItem('lastUsername')
    if (lastUsername) {
      setUsername(lastUsername)
    }
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    setError('')

    // 验证输入
    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码')
      return
    }

    try {
      // 向后端发送登录请求
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: username,
          password: password
        })
      })

      const data = await response.json()

      if (response.ok && data.user) {
        // 创建一个不包含密码的用户对象用于登录
        const userWithoutPassword = {
          ...data.user,
          password: undefined // 移除密码字段
        }
        // 存储上次登录的用户名
        localStorage.setItem('lastUsername', username)
        handleLogin(userWithoutPassword)
      } else {
        setError(data.error || '用户名或密码错误')
        // 清空密码字段
        setPassword('')
      }
    } catch (error) {
      console.error('登录请求失败:', error)
      setError('登录失败，请检查网络连接或稍后重试')
      // 清空密码字段
      setPassword('')
    }
  }, [username, password, handleLogin])

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