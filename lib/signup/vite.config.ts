import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const buildMode = process.env.BUILD_MODE || 'lib'

const commonPlugins = [react(), tailwindcss()]

const commonResolve = {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
}

const commonDefine = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
}

let config

if (buildMode === 'app') {
  config = defineConfig({
    plugins: commonPlugins,
    define: commonDefine,
    resolve: commonResolve,
    build: {
      sourcemap: true,
      outDir: 'dist-app',
    },
    // server: {
    //   port: 3000,
    //   open: true,
    // },
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
        entry: 'src/app/signup-widget-element.tsx',
        name: 'signupWidget',
        fileName: 'signup-widget',
        formats: ['iife'],
      },
      rollupOptions: {
        external: [],
        output: {
          globals: {},
        },
      },
    },
  })
} else {
  throw new Error(`Unknown BUILD_MODE: ${buildMode}. Use 'app' or 'lib'.`)
}

export default config