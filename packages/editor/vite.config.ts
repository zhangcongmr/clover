import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert';
import mdx from '@mdx-js/rollup'

const server = {
    https: true,
    proxy: {
      '/api/auth': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false, // 👈 关键：禁用证书验证（仅开发用！）
        // 可选：重写路径（如果后端没有 /api 前缀）
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/user': {
        target: 'https://localhost:8980',
        changeOrigin: true,
        secure: false, // 👈 关键：禁用证书验证（仅开发用！）
        // 可选：重写路径（如果后端没有 /api 前缀）
        // rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
}

export default defineConfig({
  base: './', //Added base configuration  确保编译后index.html中资源引用为 <script src="./assets/script.js"></script>， 而不是<script src="/assets/script.js"></script>
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    mkcert(),
    mdx({/* jsxImportSource: …, otherOptions… */})
  ],
  build: {
    target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4']
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: server
})
