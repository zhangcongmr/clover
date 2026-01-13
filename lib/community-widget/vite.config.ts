import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  define: {
    // 👇 关键：将 process.env.NODE_ENV 替换为字符串字面量
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  },
  build: {
    sourcemap: 'inline',  //生成内联 source map 以便调试
    // outDir: 'dist', // 默认输出到本项目
    lib: {
      entry: 'src/app/community-widget-element.tsx',
      name: 'CommunityWidget',
      fileName: 'community-widget',
      formats: ['iife'] // 或 'umd'
    },
    rollupOptions: {
      external: [], // 所有依赖都打包进去（推荐）
      output: {
        globals: {} // 因为不 external，所以无需 globals
      }
    }
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
})
