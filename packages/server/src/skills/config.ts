import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * `opencode.json` / `opencode.jsonc` 的 `skills` 配置发现与解析。
 *
 * 发现范围（与 skill 目录一致，只保留用户级来源）：
 * - 全局配置 `~/.config/opencode/opencode.json(c)`
 * - 调用方通过 `configFiles` 显式指定的文件
 * - 项目链上的配置文件**不读取**
 *
 * 解析规则：
 * - 每个被读取的配置文件都贡献自己的条目，条目之间是「合并」而非「替换」
 * - 相对路径从活动工作目录解析（不是配置文件所在目录）
 * - `~/...` 从用户主目录解析，绝对路径原样使用
 * - `http(s)://` 作为 HTTP catalog 处理
 */

export const CONFIG_FILE_NAMES = ['opencode.json', 'opencode.jsonc'] as const;

export type ConfigSkillEntryKind = 'path' | 'url';

export interface ConfigSkillEntry {
  kind: ConfigSkillEntryKind;
  /** 原始配置值（路径或 URL）。 */
  value: string;
  /** 贡献该条目的配置文件。 */
  file: string;
}

export interface ConfigScanResult {
  /** 按读取顺序排列的 `skills` 条目（全局配置在前，显式配置文件在后）。 */
  entries: ConfigSkillEntry[];
  /** 实际读取到的配置文件。 */
  files: string[];
  /** 解析失败等非致命错误。 */
  errors: string[];
}

export interface ConfigScanOptions {
  /** 用户主目录，默认 `os.homedir()`。 */
  home?: string;
  /** 是否读取全局配置 `~/.config/opencode/opencode.json(c)`，默认 true。 */
  includeGlobal?: boolean;
  /** 额外指定的配置文件（在全局配置之后按顺序追加）。 */
  configFiles?: string[];
}

/* -------------------------------------------------------------------------- */
/* JSONC                                                                      */
/* -------------------------------------------------------------------------- */

/** 去掉 `//` 与 `/* *\/` 注释；字符串字面量内的斜杠保持原样。 */
export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i++; // 跳过结尾的 '/'
      continue;
    }

    out += char;
  }

  return out;
}

/** 去掉对象/数组的尾随逗号（JSONC 允许）。 */
export function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue; // 丢弃尾随逗号
      out += char;
      continue;
    }

    out += char;
  }

  return out;
}

/** 解析 JSONC 配置文本；抛出的异常由调用方记录。 */
export function parseOpencodeConfig(raw: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(raw)));
}

/* -------------------------------------------------------------------------- */
/* 配置文件发现                                                                */
/* -------------------------------------------------------------------------- */

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksLikeOtherScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/** `paths`/`urls` 字段必须是数组；否则记录错误并返回空。 */
function asUnknownArray(value: unknown, errorMessage: string, errors: string[]): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push(errorMessage);
    return [];
  }
  return value;
}

/**
 * 读取配置文件并解析 `skills` 条目。
 * 顺序即优先级：全局配置 -> 调用方显式指定的文件。
 * 项目链上的配置文件不读取（发现范围仅限用户级）。
 */
export function collectConfigSkillEntries(options: ConfigScanOptions = {}): ConfigScanResult {
  const home = options.home ?? homedir();
  const files: string[] = [];
  const errors: string[] = [];

  const addFile = (path: string): void => {
    if (!path || files.includes(path)) return;
    if (existsSync(path)) files.push(path);
  };

  if (options.includeGlobal !== false) {
    const globalDir = join(home, '.config', 'opencode');
    for (const name of CONFIG_FILE_NAMES) addFile(join(globalDir, name));
  }

  for (const path of options.configFiles ?? []) addFile(path);

  const entries: ConfigSkillEntry[] = [];

  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parseOpencodeConfig(readFileSync(file, 'utf-8'));
    } catch (error) {
      errors.push(`Failed to parse config ${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const skills = (parsed as { skills?: unknown } | null)?.skills;
    if (skills === undefined || skills === null) continue;

    // 两种形态（对齐官方 config schema 与文档）：
    //   数组: "skills": ["./dir", "https://…/"]
    //   对象: "skills": { "paths": [...], "urls": [...] }
    const rawValues: unknown[] | null = Array.isArray(skills)
      ? skills
      : typeof skills === 'object'
        ? [
            ...asUnknownArray((skills as { paths?: unknown }).paths, `${file}: "skills.paths" must be an array`, errors),
            ...asUnknownArray((skills as { urls?: unknown }).urls, `${file}: "skills.urls" must be an array`, errors),
          ]
        : null;

    if (rawValues === null) {
      errors.push(`Config ${file}: "skills" must be an array or an object with "paths"/"urls"`);
      continue;
    }

    for (const item of rawValues) {
      if (typeof item !== 'string') {
        errors.push(`Config ${file}: non-string entry in "skills" skipped`);
        continue;
      }
      const value = item.trim();
      if (!value) {
        errors.push(`Config ${file}: empty entry in "skills" skipped`);
        continue;
      }
      if (looksLikeUrl(value)) {
        entries.push({ kind: 'url', value, file });
      } else if (looksLikeOtherScheme(value)) {
        errors.push(`Config ${file}: unsupported skills entry scheme "${value}" (only http/https and paths)`);
      } else {
        entries.push({ kind: 'path', value, file });
      }
    }
  }

  return { entries, files, errors };
}
