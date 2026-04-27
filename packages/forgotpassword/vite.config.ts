import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'

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
    host: '0.0.0.0',
    port: 5179,
    strictPort: true,
    proxy: {
      ...sharedApiProxy,
      ...createSharedAppProxy('/forgotpassword')
    }
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/forgotpassword/' : './',
  plugins: commonPlugins,
  define: commonDefine,
  resolve: commonResolve,
  build: {
    target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
    sourcemap: true,
    outDir: 'dist',
  },
  server: server,
}))