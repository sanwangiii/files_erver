// 清除localStorage中的用户数据，解决上传权限问题
console.log('清除localStorage中的用户数据...');
localStorage.removeItem('user');
localStorage.removeItem('users');
console.log('用户数据已清除，请重新登录系统。');
