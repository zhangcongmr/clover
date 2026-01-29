import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert';

const buildMode = process.env.BUILD_MODE || 'lib'

const commonPlugins = [react(), tailwindcss(), mkcert()]

const commonResolve = {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
}

const commonDefine = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
}

const server = {
    https: true,
    proxy: {
      '/api': {
        target: 'https://localhost:8080',
        changeOrigin: true,
        secure: false, // 👈 关键：禁用证书验证（仅开发用！）
        // 可选：重写路径（如果后端没有 /api 前缀）
        // rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
}

let config

if (buildMode === 'app') {
  config = defineConfig({
    base: './', //Added base configuration  确保编译后index.html中资源引用为 <script src="./assets/script.js"></script>， 而不是<script src="/assets/script.js"></script>
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      sourcemap: true,
      outDir: 'dist-app',
    },
    server: server,
  })
} else if (buildMode === 'lib') {
  config = defineConfig({
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      sourcemap: 'inline',
      outDir: 'dist-lib',
      lib: {
        entry: 'src/app/signin-widget-element.tsx',
        name: 'signinWidget',
        fileName: 'signin-widget',
        formats: ['iife'],
      },
      rollupOptions: {
        external: [],
        output: {
          globals: {},
        },
      },
    },
    server: server,
  })
} else {
  throw new Error(`Unknown BUILD_MODE: ${buildMode}. Use 'app' or 'lib'.`)
}

export default config