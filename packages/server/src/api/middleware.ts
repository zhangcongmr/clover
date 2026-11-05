import type express from 'express';
import { TokenManager } from '../local/auth.js';

export interface CORSMiddlewareOptions {
  /**
   * 放行任意来源。开启后不再比对白名单，直接把请求的 Origin 回显到
   * Access-Control-Allow-Origin。
   *
   * 注意：这里必须回显具体 Origin 而不能用 `*`，因为本中间件同时设置了
   * Access-Control-Allow-Credentials: true，而浏览器规定携带凭证的请求
   * 不接受通配符 `*`，会直接拒绝响应。回显 Origin 是"放行任意来源"下
   * 唯一可行的写法。
   *
   * 该选项适用于受信任网络内的私有部署；公网暴露时务必保持关闭。
   */
  allowAnyOrigin?: boolean;
}

/**
 * CORS 中间件。两种模式：
 *
 * - 白名单模式（默认，`allowAnyOrigin` 为 false）：只放行 Origin 落在
 *   `localhost` / `127.0.0.1` / `extraHosts` 与 `ports` 组合出的
 *   host × port 范围内的来源。
 * - 任意来源模式（`allowAnyOrigin: true`）：放行所有来源，`ports` 与
 *   `extraHosts` 不参与判定。
 *
 * @param ports 白名单模式下允许的来源端口
 * @param extraHosts 白名单模式下额外允许的主机名
 */
export function createCORSMiddleware(
  ports: number[] = [],
  extraHosts?: string[],
  options: CORSMiddlewareOptions = {},
): express.RequestHandler {
  const { allowAnyOrigin = false } = options;
  const allowedOrigins: string[] = [];
  const allHosts = ['localhost', '127.0.0.1', ...(extraHosts || [])];

  for (const host of allHosts) {
    for (const p of ports) {
      allowedOrigins.push(`http://${host}:${p}`);
      allowedOrigins.push(`https://${host}:${p}`);
    }
  }

  return (req, res, next) => {
    const origin = req.headers.origin || '';
    if (!origin) {
      // 非跨域请求（curl、服务端调用、同一页面内的相对请求）没有 Origin 头，
      // 用 * 即可；这类请求不携带凭证，浏览器不会拒绝。
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (allowAnyOrigin) {
      // 回显任意来源，并声明 Vary，避免中间缓存把某个 Origin 的响应
      // 直接喂给另一个 Origin。
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    } else if (allowedOrigins.some(o => origin.startsWith(o))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    } else {
      // Origin without explicit port (e.g., https://localhost via nginx proxy)
      try {
        const u = new URL(origin);
        if (!u.port && allowedOrigins.some(o => o.startsWith(`${u.protocol}//${u.hostname}`))) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.vary('Origin');
        }
      } catch {}
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Last-Event-ID, X-Client-Id, X-Epoch, X-Takeover',
    );
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  };
}

export function createRequireAuth(tokenManager: TokenManager): express.RequestHandler {
  return (req, res, next) => {
    // Check Authorization header first
    const auth = req.headers.authorization || '';
    let token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    
    // Fall back to query string token (for EventSource which doesn't support headers)
    if (!token && req.query.token) {
      token = String(req.query.token);
    }
    
    if (!token || !tokenManager.verify(token)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    next();
  };
}
