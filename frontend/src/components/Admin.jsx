import React, { useState, useEffect } from 'react'

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

function Admin() {
  const [users, setUsers] = useState([])
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    isAdmin: false,
    permissions: []
  })
  const [editingUser, setEditingUser] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [message, setMessage] = useState('')

  // 从API获取实际的文件夹列表
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(false)
  
  // 加载文件夹列表
  useEffect(() => {
    const fetchFolders = async () => {
      setLoading(true)
      try {
        // 获取认证信息
        const user = JSON.parse(localStorage.getItem('user'))
        const response = await fetch(`/api/files?dir=&sort_by=name&sort_order=asc`, {
          headers: {
            'Authorization': `Bearer ${user?.token || ''}`
          }
        })
        const data = await response.json()
        
        // 提取实际的文件夹列表，确保与权限系统一致
        // 如果是顶级文件夹，使用名称；如果是子文件夹，使用完整路径
        const actualFolders = data.folders.map(folder => {
          // 对于顶级文件夹，使用名称
          // 对于子文件夹，使用完整路径
          return folder.path
        })
        setFolders(actualFolders)
      } catch (error) {
        console.error('获取文件夹列表失败:', error)
        // 如果获取失败，使用空列表作为后备，避免显示不存在的文件夹
        setFolders([])
      } finally {
        setLoading(false)
      }
    }
    
    fetchFolders()
  }, [])

  // 清理旧用户数据中的无效权限
  const cleanUserPermissions = (usersData, actualFolders) => {
    return usersData.map(user => {
      if (user.isAdmin || user.permissions.includes('*')) {
        // 管理员或拥有所有权限的用户保持不变
        return user
      }
      // 清理普通用户的权限，只保留实际存在的文件夹
      const validPermissions = user.permissions.filter(permission => {
        // 保留特殊权限符号'*'，或者实际存在的文件夹
        return permission === '*' || actualFolders.includes(permission)
      })
      return {
        ...user,
        permissions: validPermissions
      }
    })
  }

  // 从后端加载用户数据
  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users')
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users)
      } else {
        console.error('获取用户列表失败')
        setMessage('获取用户列表失败')
      }
    } catch (error) {
      console.error('获取用户列表请求失败:', error)
      setMessage('获取用户列表请求失败')
    }
  }

  // 首次加载用户数据
  useEffect(() => {
    fetchUsers()
  }, []) // 不依赖任何变量，只在组件首次加载时执行

  // 处理添加用户
  const handleAddUser = async (e) => {
    e.preventDefault()
    
    try {
      // 哈希密码
      const hashedPassword = md5(newUser.password)
      
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...newUser,
          password: hashedPassword
        })
      })

      if (response.ok) {
        const data = await response.json()
        // 更新用户列表
        setUsers([...users, data.user])
        setNewUser({ username: '', password: '', isAdmin: false, permissions: [] })
        setShowAddForm(false)
        setMessage('用户添加成功')
        
        // 3秒后清除消息
        setTimeout(() => setMessage(''), 3000)
      } else {
        const data = await response.json()
        setMessage(data.error || '添加用户失败')
      }
    } catch (error) {
      console.error('添加用户请求失败:', error)
      setMessage('添加用户请求失败')
    }
  }

  // 处理编辑用户
  const handleEditUser = (user) => {
    // 确保token被保留
    setEditingUser({ ...user })
  }

  // 处理保存编辑后的用户
  const handleSaveEdit = async (e) => {
    e.preventDefault()

    try {
      // 准备要更新的数据
      const updateData = { ...editingUser }
      
      // 检查原始用户数据，只在密码被修改时才更新密码
      const originalUser = users.find(user => user.id === editingUser.id)
      
      // 如果密码为空，不更新密码
      if (updateData.password === '') {
        // 删除密码字段，不更新密码
        delete updateData.password
      } else if (updateData.password !== originalUser.password) {
        // 密码被修改，哈希新密码
        if (updateData.password.length < 32) { // 假设md5哈希是32位
          updateData.password = md5(updateData.password)
        }
      } else {
        // 密码未修改，不更新密码
        delete updateData.password
      }
      
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      })

      if (response.ok) {
        const data = await response.json()
        // 更新用户列表
        const updatedUsers = users.map(user => {
          if (user.id === editingUser.id) {
            return data.user
          }
          return user
        })
        setUsers(updatedUsers)
        setEditingUser(null)
        setMessage('用户更新成功')
        
        // 3秒后清除消息
        setTimeout(() => setMessage(''), 3000)
      } else {
        const data = await response.json()
        setMessage(data.error || '更新用户失败')
      }
    } catch (error) {
      console.error('更新用户请求失败:', error)
      setMessage('更新用户请求失败')
    }
  }

  // 处理删除用户
  const handleDeleteUser = async (userId) => {
    // 不能删除管理员用户
    const userToDelete = users.find(user => user.id === userId)
    if (userToDelete.isAdmin) {
      setMessage('不能删除管理员用户')
      setTimeout(() => setMessage(''), 3000)
      return
    }

    // 确认删除
    if (window.confirm('确定要删除此用户吗？')) {
      try {
        const response = await fetch(`/api/users/${userId}`, {
          method: 'DELETE'
        })

        if (response.ok) {
          // 过滤掉要删除的用户
          const updatedUsers = users.filter(user => user.id !== userId)
          setUsers(updatedUsers)
          setMessage('用户删除成功')

          // 3秒后清除消息
          setTimeout(() => setMessage(''), 3000)
        } else {
          const data = await response.json()
          setMessage(data.error || '删除用户失败')
        }
      } catch (error) {
        console.error('删除用户请求失败:', error)
        setMessage('删除用户请求失败')
      }
    }
  }

  // 处理权限选择变化
  const handlePermissionChange = (folder) => {
    if (editingUser) {
      let updatedPermissions = [...editingUser.permissions]
      if (updatedPermissions.includes(folder)) {
        // 如果已选中，取消选择
        updatedPermissions = updatedPermissions.filter(p => p !== folder)
      } else {
        // 如果未选中，添加选择
        updatedPermissions.push(folder)
      }
      setEditingUser({ ...editingUser, permissions: updatedPermissions })
    } else {
      let updatedPermissions = [...newUser.permissions]
      if (updatedPermissions.includes(folder)) {
        // 如果已选中，取消选择
        updatedPermissions = updatedPermissions.filter(p => p !== folder)
      } else {
        // 如果未选中，添加选择
        updatedPermissions.push(folder)
      }
      setNewUser({ ...newUser, permissions: updatedPermissions })
    }
  }

  // 处理全选/取消全选权限
  const handleToggleAllPermissions = () => {
    if (editingUser) {
      const updatedPermissions = editingUser.permissions.includes('*') ? [] : ['*']
      setEditingUser({ ...editingUser, permissions: updatedPermissions })
    } else {
      const updatedPermissions = newUser.permissions.includes('*') ? [] : ['*']
      setNewUser({ ...newUser, permissions: updatedPermissions })
    }
  }

  return (
    <div className="admin-container">
      <h2>管理员后台</h2>
      <h3>用户管理</h3>

      {message && (
        <div className={`message ${message.includes('成功') ? 'success-message' : 'error-message'}`}>
          {message}
        </div>
      )}

      <button 
        className="btn" 
        style={{ marginBottom: '20px' }}
        onClick={() => setShowAddForm(!showAddForm)}
      >
        {showAddForm ? '取消添加' : '添加新用户'}
      </button>

      {showAddForm && (
        <div className="add-user-form">
          <h4>添加新用户</h4>
          <form onSubmit={handleAddUser}>
            <div className="form-group">
              <label htmlFor="new-username">用户名</label>
              <input
                type="text"
                id="new-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">密码</label>
              <input
                type="password"
                id="new-password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={newUser.isAdmin}
                  onChange={(e) => setNewUser({ ...newUser, isAdmin: e.target.checked })}
                />
                管理员
              </label>
            </div>
            <div className="form-group">
              <label>权限设置</label>
              <div className="permission-options">
                <label>
                  <input
                    type="checkbox"
                    checked={newUser.permissions.includes('*')}
                    onChange={handleToggleAllPermissions}
                  />
                  所有文件夹
                </label>
                {folders.map(folder => (
                  <label key={folder}>
                    <input
                      type="checkbox"
                      checked={newUser.permissions.includes(folder)}
                      onChange={() => handlePermissionChange(folder)}
                      disabled={newUser.permissions.includes('*')}
                    />
                    {folder}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="btn">保存</button>
          </form>
        </div>
      )}

      <div className="user-list">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>权限</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.username}</td>
                <td>{user.isAdmin ? '管理员' : '普通用户'}</td>
                <td>{loading ? '加载中...' : user.permissions.join(', ')}</td>
                <td>
                  <button 
                    className="btn" 
                    style={{ marginRight: '5px' }}
                    onClick={() => handleEditUser(user)}
                  >
                    编辑
                  </button>
                  <button 
                    className="btn btn-secondary"
                    onClick={() => handleDeleteUser(user.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingUser && (
        <div className="edit-user-form">
          <h4>编辑用户</h4>
          <form onSubmit={handleSaveEdit}>
            <div className="form-group">
              <label htmlFor="edit-username">用户名</label>
              <input
                type="text"
                id="edit-username"
                value={editingUser.username}
                onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-password">密码（不填则保持原密码）</label>
              <input
                type="password"
                id="edit-password"
                value={editingUser.password || ''}
                onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={editingUser.isAdmin}
                  onChange={(e) => setEditingUser({ ...editingUser, isAdmin: e.target.checked })}
                  disabled={editingUser.id === 1} // 不能取消管理员的管理员权限
                />
                管理员
              </label>
            </div>
            <div className="form-group">
              <label>权限设置</label>
              <div className="permission-options">
                <label>
                  <input
                    type="checkbox"
                    checked={editingUser.permissions.includes('*')}
                    onChange={handleToggleAllPermissions}
                  />
                  所有文件夹
                </label>
                {folders.map(folder => (
                  <label key={folder}>
                    <input
                      type="checkbox"
                      checked={editingUser.permissions.includes(folder)}
                      onChange={() => handlePermissionChange(folder)}
                      disabled={editingUser.permissions.includes('*')}
                    />
                    {folder}
                  </label>
                ))}
              </div>
            </div>
            <button type="submit" className="btn">保存</button>
            <button 
              type="button" 
              className="btn btn-secondary" 
              style={{ marginLeft: '10px' }}
              onClick={() => setEditingUser(null)}
            >
              取消
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

export default Admin