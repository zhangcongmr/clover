import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SslConfig {
  cert: Buffer;
  key: Buffer;
}

export function loadSslConfig(sslDir: string): SslConfig | null {
  const certPath = process.env['SSL_CERT_PATH'] || join(sslDir, 'cert.pem');
  const keyPath = process.env['SSL_KEY_PATH'] || join(sslDir, 'key.pem');

  if (existsSync(certPath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    };
  }
  return null;
}

export function isJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
