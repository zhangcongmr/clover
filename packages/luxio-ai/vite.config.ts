import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/luxio-ai/' : './',
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5181,
    strictPort: true,
    proxy: {
      ...sharedApiProxy,
      ...createSharedAppProxy('/luxio-ai'),
    }
  },
  build: {
    target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
      sourcemap: true,
      outDir: 'dist',
    },
}))
