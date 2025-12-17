import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3001,
    historyApiFallback: true,
    allowedHosts: ['localhost', 'sanwangdemac-mini.local', 'sanwangi.file'],
    proxy: {
      // 专门处理/files路径，确保它不会被代理到后端服务器
      '^/files(.*)$': {
        target: 'http://localhost:3001',
        rewrite: () => '/index.html',
        changeOrigin: false
      },
      // 专门处理/preview路径，确保它不会被代理到后端服务器
      '^/preview(.*)$': {
        target: 'http://localhost:3001',
        rewrite: () => '/index.html',
        changeOrigin: false
      },
      // 代理其他API路径
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/preview_text': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/video': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/file': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      // 添加VLC重定向代理配置
      '/vlc_redirect': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
})