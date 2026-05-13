import React, { useState, useContext, useEffect, useCallback } from 'react'
import { AuthContext } from '../App'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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

    // 防重复提交
    if (loading) return
    setLoading(true)

    try {
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
        const userWithoutPassword = {
          ...data.user,
          password: undefined
        }
        localStorage.setItem('lastUsername', username)
        handleLogin(userWithoutPassword)
      } else {
        setError(data.error || '用户名或密码错误')
        setPassword('')
      }
    } catch (error) {
      setError('登录失败，请检查网络连接或稍后重试')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }, [username, password, handleLogin, loading])

  return (
    <div className="login-page">
      <div className="login-form">
        <div className="login-brand">
          <div className="login-brand-icon">
            <i className="fa-solid fa-server"></i>
          </div>
          <h3>局域网文件预览服务</h3>
        </div>
        <h2>欢迎回来</h2>
        {error && <div className="error-message">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
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
          <button type="submit" className="btn" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login