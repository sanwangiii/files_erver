import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    historyApiFallback: true,
    proxy: {
      // 专门处理/files和/preview路径，确保它们不会被代理到后端服务器
      '^/(files|preview)(.*)$': {
        target: 'http://localhost:3000',
        rewrite: () => '/index.html',
        changeOrigin: false
      },
      // 代理其他API路径
      '/api': {
        target: 'http://192.168.1.18:8000',
        changeOrigin: true
      },
      '/preview_text': {
        target: 'http://192.168.1.18:8000',
        changeOrigin: true
      },
      '/video': {
        target: 'http://192.168.1.18:8000',
        changeOrigin: true
      },
      '/file': {
        target: 'http://192.168.1.18:8000',
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