import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert';
import mdx from '@mdx-js/rollup'
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'

const server = {
    host: '0.0.0.0',
    port: 5178,
    strictPort: true,
    https: {},
    proxy: {
      ...sharedApiProxy,
      ...createSharedAppProxy('/editor')
    }
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/editor/' : './',
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
}))
