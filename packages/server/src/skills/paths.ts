import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * 按 OpenCode Sources 规则解析一条路径配置：
 * - `~/...` 从当前用户主目录解析
 * - 绝对路径原样使用
 * - 相对路径从「活动工作目录」（不是配置文件所在目录）解析
 */
export function resolveUserPath(input: string, cwd: string, home: string): string {
  if (input === '~') return home;
  if (input.startsWith('~/') || input.startsWith('~\\')) return join(home, input.slice(2));
  return isAbsolute(input) ? input : resolve(cwd, input);
}

/** 目录是否存在且是目录。 */
export function directoryExists(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
