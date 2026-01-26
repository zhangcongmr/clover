import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const commonPlugins = [react(), tailwindcss()]

const commonResolve = {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
}

const commonDefine = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
}

const server = {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // 可选：重写路径（如果后端没有 /api 前缀）
        // rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
}

let config = defineConfig({
  base: './', //Added base configuration  确保编译后index.html中资源引用为 <script src="./assets/script.js"></script>， 而不是<script src="/assets/script.js"></script>
  plugins: commonPlugins,
  define: commonDefine,
  resolve: commonResolve,
  build: {
    sourcemap: true,
    outDir: 'dist',
  },
  server: server,
})
export default config