import { gunzipSync } from 'node:zlib';

/**
 * 最小 tar.gz 解包器（零依赖，供 0.2.0 catalog 的 `archive` 条目使用）。
 *
 * 支持范围（以真实技能包实测为依据，均为 ustar/GNU 常规布局）：
 * - typeflag `0`/`\0` 普通文件、`5` 目录
 * - GNU `L`（长文件名）、`K`（长链接名，消费但不使用）
 * - pax `x`（取 `path`/`size`）、`g`（全局头，忽略）
 * - ustar `prefix` 字段、头部校验和验证（同时接受无符号与有符号算法）
 *
 * 出于安全考虑：路径含绝对路径/盘符/`..`/反斜杠 → 抛错使整个条目失败；
 * 符号链接、hardlink 等非常规成员直接跳过（技能包不需要）。
 */

export interface TarFile {
  /** 包内相对路径（`/` 分隔）。 */
  path: string;
  data: Buffer;
}

export interface TarExtractResult {
  files: TarFile[];
  /** 跳过的非常规成员数量（符号链接等）。 */
  skipped: number;
}

export interface TarExtractLimits {
  /** 文件数量上限，默认 200。 */
  maxFiles?: number;
  /** 单文件解压后大小上限，默认 5MB。 */
  maxFileBytes?: number;
  /** 解压总大小上限（防压缩炸弹），默认 50MB。 */
  maxTotalBytes?: number;
}

const BLOCK = 512;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取头部定长八进制字段（尾部 NUL/空格视为结束）。 */
function readOctal(buf: Buffer, offset: number, length: number, field: string): number {
  const raw = buf.subarray(offset, offset + length).toString('latin1').replace(/[\0 ]+$/, '').trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`unsupported tar ${field} encoding (${JSON.stringify(raw.slice(0, 16))})`);
  }
  const value = parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid tar ${field}`);
  return value;
}

/** NUL 结尾字符串。 */
function readString(buf: Buffer, offset: number, length: number): string {
  const raw = buf.subarray(offset, offset + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8');
}

/** ustar 头部校验和：chksum 字段按空格参与求和，兼容无符号与有符号两种历史算法。 */
function verifyChecksum(header: Buffer): boolean {
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : header[i];
    unsigned += byte;
    signed += byte >= 128 ? byte - 256 : byte;
  }
  const stored = readOctal(header, 148, 8, 'checksum');
  return stored === unsigned || stored === signed;
}

/** ustar `prefix` + `name` 组合出完整路径。 */
function ustarPath(header: Buffer): string {
  const name = readString(header, 0, 100);
  const prefix = readString(header, 345, 155);
  return prefix ? `${prefix}/${name}` : name;
}

/** 解析 pax 扩展头记录（`<len> key=value\n`）。 */
function parsePax(data: Buffer): Record<string, string> {
  const text = data.toString('latin1');
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const space = text.indexOf(' ', i);
    if (space === -1) break;
    const length = parseInt(text.slice(i, space), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || i + length > text.length) break;
    const record = text.slice(i, i + length);
    const eq = record.indexOf('=', space - i);
    if (eq !== -1) {
      const value = record.slice(eq + 1);
      out[record.slice(space - i + 1, eq)] = value.endsWith('\n') ? value.slice(0, -1) : value;
    }
    i += length;
  }
  return out;
}

/** 包内路径安全校验：拒绝绝对路径、盘符、`..`、反斜杠。 */
function validatePath(path: string): void {
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\\')) {
    throw new Error(`unsafe path in archive: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  if (segments.length && segments[segments.length - 1] === '') segments.pop(); // 目录名尾部的 '/'
  if (!segments.length || segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error(`unsafe path in archive: ${JSON.stringify(path)}`);
  }
}

/**
 * 解包 gzip 压缩的 tar 缓冲区。
 * 任何不安全路径、损坏头部、超限都会抛错——调用方以"条目失败、保留旧缓存"处理。
 */
export function extractTarGz(gz: Buffer, limits: TarExtractLimits = {}): TarExtractResult {
  const maxFiles = limits.maxFiles ?? 200;
  const maxFileBytes = limits.maxFileBytes ?? 5 * 1024 * 1024;
  const maxTotalBytes = limits.maxTotalBytes ?? 50 * 1024 * 1024;

  let plain: Buffer;
  try {
    plain = gunzipSync(gz);
  } catch (error) {
    throw new Error(`not a valid gzip archive (${messageOf(error)})`);
  }

  const files: TarFile[] = [];
  let skipped = 0;
  let total = 0;
  let offset = 0;
  /** GNU `L`：下一个成员使用此处给出的名字。 */
  let pendingName: string | null = null;
  /** pax `x`：下一个成员的覆盖字段。 */
  let pendingPax: Record<string, string> | null = null;

  while (offset + BLOCK <= plain.length) {
    const header = plain.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break; // 结束标记
    if (!verifyChecksum(header)) throw new Error('corrupt tar archive (header checksum mismatch)');

    const size = readOctal(header, 124, 12, 'size');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    const dataStart = offset + BLOCK;
    if (dataStart + size > plain.length) throw new Error('corrupt tar archive (truncated member data)');
    const dataEnd = dataStart + size;
    offset = Math.min(dataStart + Math.ceil(size / BLOCK) * BLOCK, plain.length);

    if (type === 'L') {
      pendingName = readString(plain.subarray(dataStart, dataEnd), 0, size);
      continue;
    }
    if (type === 'x') {
      pendingPax = parsePax(plain.subarray(dataStart, dataEnd));
      continue;
    }
    if (type === 'g' || type === 'K') continue;

    let path = pendingName ?? ustarPath(header);
    const pax = pendingPax;
    pendingName = null;
    pendingPax = null;
    if (pax?.['path']) path = pax['path'];

    if (type === '5') {
      validatePath(path);
      continue;
    }
    if (type !== '0') {
      skipped++; // 符号链接、hardlink、设备文件等：跳过
      continue;
    }

    validatePath(path);
    let dataSize = size;
    if (pax?.['size']) {
      const parsed = parseInt(pax['size'], 10);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || dataStart + parsed > plain.length) {
        throw new Error(`corrupt tar archive (bad pax size for ${path})`);
      }
      dataSize = parsed;
    }
    if (dataSize > maxFileBytes) throw new Error(`file too large in archive: ${path} (${dataSize} bytes)`);
    total += dataSize;
    if (total > maxTotalBytes) throw new Error(`archive expands beyond limit (${total} bytes)`);
    if (files.length >= maxFiles) throw new Error(`too many files in archive (>${maxFiles})`);

    files.push({ path, data: Buffer.from(plain.subarray(dataStart, dataStart + dataSize)) });
  }

  return { files, skipped };
}
