import type express from 'express';
import { TokenManager } from '../agent/auth.js';

export function createCORSMiddleware(ports: number[], extraHosts?: string[]): express.RequestHandler {
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
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else if (allowedOrigins.some(o => origin.startsWith(o))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      // Origin without explicit port (e.g., https://localhost via nginx proxy)
      try {
        const u = new URL(origin);
        if (!u.port && allowedOrigins.some(o => o.startsWith(`${u.protocol}//${u.hostname}`))) {
          res.setHeader('Access-Control-Allow-Origin', origin);
        }
      } catch {}
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !tokenManager.verify(token)) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    next();
  };
}
