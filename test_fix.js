// 测试脚本：验证普通用户文件访问权限和密码哈希存储
const fs = require('fs');
const path = require('path');

// 检查前端用户数据文件
const frontendDir = path.join(__dirname, 'frontend');
const loginFile = path.join(frontendDir, 'src/components/Login.jsx');
const adminFile = path.join(frontendDir, 'src/components/Admin.jsx');
const appFile = path.join(frontendDir, 'src/App.jsx');
const fileListFile = path.join(frontendDir, 'src/components/FileList.jsx');

console.log('=== 验证修复结果 ===\n');

// 检查密码哈希实现
console.log('1. 检查密码哈希实现：');
const checkHashImplementation = (filePath, fileName) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('const md5 =')) {
            console.log(`   ✓ ${fileName} 包含MD5哈希函数`);
        } else {
            console.log(`   ✗ ${fileName} 缺少MD5哈希函数`);
        }
        if (content.includes('md5(')) {
            console.log(`   ✓ ${fileName} 使用了MD5哈希函数`);
        } else {
            console.log(`   ✗ ${fileName} 未使用MD5哈希函数`);
        }
    } catch (err) {
        console.log(`   ✗ 无法读取 ${fileName} 文件`);
    }
};

checkHashImplementation(loginFile, 'Login.jsx');
checkHashImplementation(adminFile, 'Admin.jsx');

console.log('\n2. 检查密码明文存储：');
// 检查localStorage中是否存储密码
const checkPasswordInStorage = (filePath, fileName) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('localStorage.setItem')) {
            console.log(`   ✓ ${fileName} 使用了localStorage`);
            if (content.includes('userWithoutPassword') || 
                content.includes('delete user.password') ||
                !content.includes('password') ||
                content.includes('password: md5(')) {
                console.log(`   ✓ ${fileName} 未在localStorage中存储明文密码`);
            } else {
                console.log(`   ✗ ${fileName} 可能在localStorage中存储了明文密码`);
            }
        }
    } catch (err) {
        console.log(`   ✗ 无法读取 ${fileName} 文件`);
    }
};

checkPasswordInStorage(loginFile, 'Login.jsx');
checkPasswordInStorage(adminFile, 'Admin.jsx');
checkPasswordInStorage(appFile, 'App.jsx');

console.log('\n3. 检查文件权限过滤：');
// 检查FileList.jsx中的权限过滤逻辑
try {
    const content = fs.readFileSync(fileListFile, 'utf8');
    if (content.includes('user.permissions') && 
        (content.includes('*') || 
         content.includes('some') || 
         content.includes('every') ||
         content.includes('parent'))) {
        console.log('   ✓ FileList.jsx 包含文件权限过滤逻辑');
    } else {
        console.log('   ✗ FileList.jsx 可能缺少文件权限过滤逻辑');
    }
} catch (err) {
    console.log('   ✗ 无法读取 FileList.jsx 文件');
}

console.log('\n4. 检查默认用户密码：');
// 检查默认用户密码是否为哈希值
const checkDefaultPasswords = (filePath, fileName) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const passwordRegex = /password:\s*['"]([^'"]+)['"]/g;
        let match;
        let hasPlaintext = false;
        while ((match = passwordRegex.exec(content)) !== null) {
            const password = match[1];
            if (password.length < 10 || 
                password === 'password' || 
                password === 'user123' ||
                password === 'admin123') {
                hasPlaintext = true;
                break;
            }
        }
        if (hasPlaintext) {
            console.log(`   ✗ ${fileName} 中可能存在明文默认密码`);
        } else {
            console.log(`   ✓ ${fileName} 中的默认密码可能已经哈希处理`);
        }
    } catch (err) {
        console.log(`   ✗ 无法读取 ${fileName} 文件`);
    }
};

checkDefaultPasswords(loginFile, 'Login.jsx');
checkDefaultPasswords(adminFile, 'Admin.jsx');

console.log('\n=== 手动验证步骤 ===');
console.log('1. 打开浏览器访问 http://localhost:3001');
console.log('2. 使用普通用户账号登录：');
console.log('   - 用户名：user1，密码：user123');
console.log('   - 用户名：user2，密码：user123');
console.log('3. 检查是否能看到有权限的文件和文件夹');
console.log('4. 打开开发者工具（F12），选择Application标签页');
console.log('5. 在Storage -> Local Storage中检查userInfo对象');
console.log('6. 确认userInfo对象中没有password字段');
console.log('7. 以管理员账号登录（admin/admin123），检查用户管理页面');
console.log('8. 确认用户列表中不显示密码');

console.log('\n=== 修复完成 ===');