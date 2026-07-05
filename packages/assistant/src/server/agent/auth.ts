import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class TokenManager {
  private secret: string;
  private ttl: number;
  private usedTokens = new Set<string>();

  constructor(secret?: string, ttlSeconds: number = 30) {
    this.secret = secret || randomBytes(32).toString('hex');
    this.ttl = ttlSeconds * 1000;
  }

  generate(): { token: string; expiresAt: number } {
    const expiresAt = Date.now() + this.ttl;
    const payload = `${expiresAt}:${randomBytes(16).toString('hex')}`;
    const signature = createHmac('sha256', this.secret).update(payload).digest('hex');
    const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
    return { token, expiresAt };
  }

  verify(token: string): boolean {
    if (this.usedTokens.has(token)) {
      this.usedTokens.delete(token);
      return false;
    }

    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split(':');
      if (parts.length !== 3) return false;

      const [expiresAtStr, nonce, signature] = parts;
      const expiresAt = parseInt(expiresAtStr, 10);
      if (isNaN(expiresAt) || Date.now() > expiresAt) return false;

      const payload = `${expiresAtStr}:${nonce}`;
      const expectedSig = createHmac('sha256', this.secret).update(payload).digest('hex');

      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length) return false;

      const valid = timingSafeEqual(sigBuf, expBuf);
      if (valid) {
        this.usedTokens.add(token);
      }
      return valid;
    } catch {
      return false;
    }
  }

  cleanup() {
    if (this.usedTokens.size > 10000) {
      this.usedTokens.clear();
    }
  }
}
