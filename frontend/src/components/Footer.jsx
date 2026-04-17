import React from 'react'

function Footer() {
  const currentYear = new Date().getFullYear()
  return (
    <footer className="footer">
      <p>© {currentYear} 文件预览服务器</p>
    </footer>
  )
}

export default Footer
