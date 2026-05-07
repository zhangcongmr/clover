import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert';
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'

const server: import('vite').ServerOptions = {
  host: '0.0.0.0',
  port: 5181,
  strictPort: true,
  https: {},
  proxy: {
    ...sharedApiProxy,
    ...createSharedAppProxy('/luxio-ai'),
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/luxio-ai/' : './',
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    mkcert()
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: server,
  build: {
    target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
      sourcemap: true,
      outDir: 'dist',
    },
}))
