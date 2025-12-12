// 修复管理员用户的localStorage数据
console.log('修复管理员用户的localStorage数据...');

// 获取当前的用户数据
let users = [];
const savedUsers = localStorage.getItem('users');
if (savedUsers) {
    users = JSON.parse(savedUsers);
} else {
    console.log('未找到用户数据，将使用默认配置');
}

// 更新管理员用户配置
const adminUser = users.find(u => u.username === 'admin');
if (adminUser) {
    adminUser.isAdmin = true;
    adminUser.permissions = ['*'];
    adminUser.token = 'admin-token';
    console.log('管理员用户配置已更新:', adminUser);
} else {
    // 如果没有找到管理员用户，添加一个新的
    const newAdmin = {
        id: 1,
        username: 'admin',
        password: 'e10adc3949ba59abbe56e057f20f883e', // md5('admin123')
        isAdmin: true,
        permissions: ['*'],
        token: 'admin-token'
    };
    users.push(newAdmin);
    console.log('已添加新的管理员用户:', newAdmin);
}

// 保存更新后的用户数据
localStorage.setItem('users', JSON.stringify(users));

// 清除当前登录的用户数据，强制重新登录
localStorage.removeItem('user');
console.log('已清除当前登录的用户数据，请重新登录系统。');
