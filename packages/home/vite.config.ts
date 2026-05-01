import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert';
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'


const commonPlugins = [react(), tailwindcss(), mkcert()]

const commonResolve = {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
}

const commonDefine = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
}

const server: import('vite').ServerOptions = {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: {},
    proxy: {
      ...sharedApiProxy,
      ...createSharedAppProxy('/home'),
    }
}

export default defineConfig(({ command }) => {
  const isServe = command === 'serve'
  const base = isServe ? '/home/' : './'

  return {
    base,
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
      sourcemap: true,
      outDir: 'dist',
    },
    server: server,
  }
})