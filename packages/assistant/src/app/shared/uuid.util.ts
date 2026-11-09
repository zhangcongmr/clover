/**
 * UUID v4，在非安全上下文下同样可用。
 *
 * `crypto.randomUUID()` 只在**安全上下文**（HTTPS，或被视为可信来源的
 * `localhost` / `127.0.0.1`）里存在。用局域网 IP 以纯 HTTP 打开页面时
 * （例如 `http://192.168.153.146:4200`），`crypto.randomUUID` 是
 * `undefined`，直接调用会抛 "crypto.randomUUID is not a function"；
 * 而 `crypto.getRandomValues()` 没有这个限制，所以用它来兜底。
 *
 * 全仓库统一走这里，避免再出现「本机好使、换个地址就崩」的问题。
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // 没有 Web Crypto 的极端情况（老浏览器 / 测试环境），退回 Math.random。
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // RFC 4122 version 4（第 13 位固定为 4）+ variant（第 17 位为 10xx）。
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1));

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
