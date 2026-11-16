import { CliUsageError } from './cli/errors.js';
import { RUN_HELP, parseRunArgs, runCommand } from './cli/commands/run.js';
import { SERVE_HELP, applyServeOptions, parseServeArgs } from './cli/commands/serve.js';

/**
 * CLI 顶层参数（`clover` 自身的行为）。
 *
 * 端口与鉴权密钥仍然只通过环境变量传递，CLI 不引入新的配置层。
 */
export interface CliOptions {
  commandName: string;
  description: string;
  getVersion: () => string;
  defaultPort: number;
  portEnvKey: string;
  tokenSecretEnvKey: string;
}

/** CLI 支持的子命令。 */
export type CliCommandName = 'run' | 'serve';

/**
 * 解析出来的子命令。
 *
 * `args` 是子命令名之后的原始参数，由对应命令自己解析（各自知道自己的选项）。
 */
export interface ParsedCommand {
  name: CliCommandName;
  args: string[];
}

/**
 * `processCliArgs` 的结果。
 *
 * `shouldExit: true` 表示已经打印了内容并应立刻退出；
 * `shouldExit: false` 时可能带一个子命令，由调用方决定执行它还是继续启动服务。
 */
export type CliResult =
  | { shouldExit: true; exitCode: number }
  | { shouldExit: false; command?: ParsedCommand };

/** 子命令的执行结果。 */
export type CliCommandResult =
  /** 进程应以该退出码结束。 */
  | { action: 'exit'; exitCode: number }
  /** 调用方应继续走默认的启动路径。 */
  | { action: 'continue' };

/** 可用的子命令清单（帮助与错误提示都用它）。 */
export const CLI_COMMANDS: readonly CliCommandName[] = ['run', 'serve'];

/** 判断是否为受支持的子命令。 */
export function isCliCommand(value: string): value is CliCommandName {
  return (CLI_COMMANDS as readonly string[]).includes(value);
}

/** `clover --help` 的帮助文本。 */
export function buildHelpText(options: CliOptions): string {
  return [
    `${options.commandName} - ${options.description}`,
    '',
    'Usage:',
    `  ${options.commandName} [options]`,
    `  ${options.commandName} run <prompt> [options]`,
    `  ${options.commandName} serve [options]`,
    '',
    'Commands:',
    '  run <prompt>    Run one task with an installed agent, then exit',
    '  serve           Start the local server (same as no arguments)',
    '',
    'Options:',
    `  -v, --version  Print the ${options.commandName} version`,
    '  -h, --help     Show this help message',
    `  -p, --port N   Set the server port (default ${options.defaultPort})`,
    '',
    'Environment:',
    `  ${options.portEnvKey.padEnd(22)}Server port (default ${options.defaultPort})`,
    `  ${options.tokenSecretEnvKey.padEnd(22)}Auth token secret for the server`,
  ].join('\n');
}

/**
 * 解析命令行参数。
 *
 * 解析顺序：
 * 1. 第一个参数是已知子命令 → 切出子命令边界，其余参数交给该命令自己解析；
 * 2. 第一个参数是以 `-` 开头的选项 → 走既有的 `-h` / `-v` / `-p` 逻辑；
 * 3. 第一个参数是其它词 → 未知子命令，报错退出（不静默启动服务）；
 * 4. 没有任何参数 → 等价于 `serve`。
 *
 * 子命令边界必须先切出来：否则 `clover run "..." -p 9000` 里的 `-p` 会被顶层
 * 扫描误当成服务端口。
 */
export function processCliArgs(args: readonly string[], options: CliOptions): CliResult {
  const first = args[0];

  if (first !== undefined && !first.startsWith('-')) {
    if (isCliCommand(first)) {
      return { shouldExit: false, command: { name: first, args: args.slice(1) } };
    }

    console.error(`Unknown command: ${first}`);
    console.error(`Available commands: ${CLI_COMMANDS.join(', ')}`);
    return { shouldExit: true, exitCode: 1 };
  }

  if (args.includes('-h') || args.includes('--help')) {
    console.log(buildHelpText(options));
    return { shouldExit: true, exitCode: 0 };
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(options.getVersion());
    return { shouldExit: true, exitCode: 0 };
  }

  const portIndex = args.findIndex((arg) => arg === '-p' || arg === '--port');
  if (portIndex !== -1) {
    const rawPort = args[portIndex + 1];
    const port = Number(rawPort);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      process.env[options.portEnvKey] = String(port);
    } else {
      console.error(`Invalid port: ${rawPort}`);
      return { shouldExit: true, exitCode: 1 };
    }
  }

  // 没有参数 → 与 `clover serve` 等价（保持向后兼容）。
  return { shouldExit: false };
}

/**
 * 执行一个子命令。
 *
 * - `run`：跑完一次任务并返回退出码（不启动 Web 服务）；
 * - `serve`：只把选项落到既有环境变量上，随后由调用方走默认的启动路径
 *   —— 与「无参数」完全同一条路，不复制任何装配逻辑。
 */
export async function runCliCommand(command: ParsedCommand): Promise<CliCommandResult> {
  if (command.name === 'run') {
    if (hasHelpFlag(command.args)) {
      console.log(RUN_HELP);
      return { action: 'exit', exitCode: 0 };
    }

    let options;
    try {
      options = parseRunArgs(command.args);
    } catch (error) {
      if (error instanceof CliUsageError) {
        console.error(error.message);
        console.error(RUN_HELP);
        return { action: 'exit', exitCode: 1 };
      }
      throw error;
    }

    return { action: 'exit', exitCode: await runCommand(options) };
  }

  if (hasHelpFlag(command.args)) {
    console.log(SERVE_HELP);
    return { action: 'exit', exitCode: 0 };
  }

  try {
    const options = parseServeArgs(command.args);
    applyServeOptions(options);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error(SERVE_HELP);
      return { action: 'exit', exitCode: 1 };
    }
    throw error;
  }

  return { action: 'continue' };
}

/** 参数里是否带了帮助开关。 */
function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes('-h') || args.includes('--help');
}
