import type { ProxyOptions } from 'vite'

const defaultProxyOptions = {
  changeOrigin: true,
}

export const sharedApiProxy: Record<string, ProxyOptions> = {
  '/api/auth': {
    target: 'https://192.168.153.129',
    ...defaultProxyOptions,
    secure: false,
  },
  '/user': {
    target: 'https://192.168.153.129',
    ...defaultProxyOptions,
    secure: false,
  },
  '/terminals': {
    target: 'https://192.168.153.129',
    ...defaultProxyOptions,
    secure: false,
    wss: true,
  },
}

export const sharedAppProxy: Record<string, ProxyOptions> = {
  '/home': {
    target: 'https://localhost:5173',
    ...defaultProxyOptions,
    secure: false,
  },
  '/signin': {
    target: 'https://localhost:5174',
    ...defaultProxyOptions,
    secure: false,
  },
  '/signup': {
    target: 'http://localhost:5175',
    ...defaultProxyOptions,
  },
  '/official-site': {
    target: 'http://localhost:5176',
    ...defaultProxyOptions,
  },
  '/community-widget': {
    target: 'https://localhost:5177',
    ...defaultProxyOptions,
    secure: false,
  },
  '/editor': {
    target: 'https://localhost:5178',
    ...defaultProxyOptions,
    secure: false,
  },
  '/forgotpassword': {
    target: 'http://localhost:5179',
    ...defaultProxyOptions,
  },
  '/resetpassword': {
    target: 'http://localhost:5180',
    ...defaultProxyOptions,
  }
}

export function createSharedAppProxy(excludeRoute?: string): Record<string, ProxyOptions> {
  const proxyConfig: Record<string, ProxyOptions> = { ...sharedAppProxy }
  if (excludeRoute) {
    delete proxyConfig[excludeRoute]
  }
  return proxyConfig
}

export const sharedDevProxy = {
  ...sharedApiProxy,
  ...sharedAppProxy,
}
