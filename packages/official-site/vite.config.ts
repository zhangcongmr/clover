import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { createSharedAppProxy, sharedApiProxy } from '../common/vite-proxy'

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

const server = {
  host: '0.0.0.0',
  port: 5176,
  strictPort: true,
  proxy: {
    ...sharedApiProxy,
    ...createSharedAppProxy('/official-site') 
  },
}

export default defineConfig(({ command }) => {
  const isServe = command === 'serve'
  const base = buildMode === 'app' ? (isServe ? '/official-site/' : './') : './'

  if (buildMode === 'app') {
    return {
      base,
      plugins: commonPlugins,
      define: commonDefine,
      resolve: commonResolve,
      build: {
        target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
        sourcemap: true,
        outDir: 'dist-app',
      },
      server: server,
    }
  }

  if (buildMode === 'lib') {
    return {
      plugins: commonPlugins,
      define: commonDefine,
      resolve: commonResolve,
      build: {
        target: ['es2022', 'chrome111', 'edge111', 'firefox114', 'safari16.4'],
        sourcemap: 'inline',
        outDir: 'dist-lib',
        lib: {
          entry: 'src/app/official-site-widget-element.tsx',
          name: 'officialSiteWidget',
          fileName: 'official-site-widget',
          formats: ['iife'],
        },
        rollupOptions: {
          external: [],
          output: {
            globals: {},
          },
        },
      },
    }
  }

  throw new Error(`Unknown BUILD_MODE: ${buildMode}. Use 'app' or 'lib'.`)
})