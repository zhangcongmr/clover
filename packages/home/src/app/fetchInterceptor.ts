import { projectId, publicAnonKey } from '/utils/supabase/info';

// import { projectId, publicAnonKey } from '/utils/supabase/info';
const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-1334fc59`;

// 开关变量，用于控制是否启用自定义 API 请求
export let ENABLE_CUSTOM_API = true;

// 保存原始的 fetch 方法
const originalFetch = window.fetch;

/**
 * 拦截并重写 fetch 请求
 * 如果请求路径以 /user 或 /api/auth 开头，将其重定向到 Supabase 函数
 */
export const setupFetchInterceptor = () => {
  window.fetch = (input: RequestInfo, init?: RequestInit) => {
    // 如果禁用自定义 API，则直接使用原始 fetch
    if (!ENABLE_CUSTOM_API) {
      return originalFetch(input, init);
    }

    const url = typeof input === 'string' 
      ? new URL(input, window.location.origin) 
      : new URL(input.url || '', window.location.origin);
    
    // 检查 URL 路径名是否以 "/user" 或 "/api/auth" 开头
    if ((url.pathname.startsWith('/user') || url.pathname.startsWith('/api/auth')) && 
        url.origin === window.location.origin) {
      // 构造新 URL，使用 API_BASE 替换原地址
      const newUrl = API_BASE + url.pathname + url.search;
      
      // 确保请求包含凭据（cookies等）
      const modifiedInit = {
        ...init,
        headers: { Authorization: `Bearer ${publicAnonKey}` },
      };
      
      return originalFetch(newUrl, modifiedInit);
    }
    
    // 对于其他请求，按常规方式处理
    return originalFetch(input, init);
  };
};

/**
 * 恢复原始的 fetch 方法
 */
export const teardownFetchInterceptor = () => {
  window.fetch = originalFetch;
};

// 在模块顶层立即设置拦截器
if (ENABLE_CUSTOM_API) {
  setupFetchInterceptor();
  console.log('Fetch interceptor has been set up.');
} else {
  console.log('Fetch interceptor is disabled.');
}