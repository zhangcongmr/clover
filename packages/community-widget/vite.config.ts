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

let config

if (buildMode === 'app') {
  config = defineConfig({
    base: './',
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
      sourcemap: true,
      outDir: 'dist-app',
    },
    server: server
  })
} else if (buildMode === 'lib') {
  config = defineConfig({
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
      sourcemap: 'inline',
      outDir: 'dist-lib',
      lib: {
        entry: 'src/app/community-widget-element.tsx',
        name: 'CommunityWidget',
        fileName: 'community-widget',
        formats: ['iife'],
      },
      rollupOptions: {
        external: [],
        output: {
          globals: {},
        },
      },
    },
    server: server
  })
} else {
  throw new Error(`Unknown BUILD_MODE: ${buildMode}. Use 'app' or 'lib'.`)
}

export default config