import { CliUsageError } from '../errors.js';

/**
 * `clover serve` 的解析结果。
 *
 * `serve` 与「无参数」走同一条启动路径，区别只在于选项可以显式写出来。
 * 选项只落到源码里**已经存在**的环境变量上，不引入新的配置层。
 */
export interface ServeCommandOptions {
  /** 监听端口（写入 `PORT`）。 */
  port?: number;
  /** 只读模式（写入 `CLOVER_READONLY`）。 */
  readonly: boolean;
}

/** `clover serve --help` 的帮助文本。 */
export const SERVE_HELP = [
  'Usage:',
  '  clover serve [options]',
  '',
  'Options:',
  '  -p, --port N   Set the server port (default 5178)',
  '      --readonly Serve in read-only mode (no file writes)',
  '  -h, --help     Show this help message',
].join('\n');

/**
 * 解析 `clover serve` 的参数。
 *
 * 未识别的选项一律报错——静默忽略会让用户以为设置生效了。
 */
export function parseServeArgs(args: readonly string[]): ServeCommandOptions {
  let port: number | undefined;
  let readonly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--readonly') {
      readonly = true;
      continue;
    }
    if (arg === '-p' || arg === '--port') {
      const raw = args[++i];
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new CliUsageError(`Invalid port: ${raw ?? ''}`);
      }
      port = parsed;
      continue;
    }
    if (arg.startsWith('--port=')) {
      const raw = arg.slice('--port='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        throw new CliUsageError(`Invalid port: ${raw}`);
      }
      port = parsed;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }

    throw new CliUsageError(`Unexpected argument: ${arg}`);
  }

  return { port, readonly };
}

/**
 * 把 serve 选项落到既有环境变量上。
 *
 * 只写源码里已经在读的两个 key：
 * - `PORT`：`createServer` 用它决定监听端口；
 * - `CLOVER_READONLY`：`setupServerMiddleware` 用它决定文件服务是否只读。
 */
export function applyServeOptions(
  options: ServeCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (options.port !== undefined) {
    env['PORT'] = String(options.port);
  }
  if (options.readonly) {
    env['CLOVER_READONLY'] = 'true';
  }
}
