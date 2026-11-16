import { describe, expect, it, vi } from 'vitest';
import { buildHelpText, CLI_COMMANDS, isCliCommand, processCliArgs, type CliOptions } from '../cli.js';

const options: CliOptions = {
  commandName: 'clover',
  description: 'SSR with an embedded local server',
  getVersion: () => '9.9.9',
  defaultPort: 5178,
  portEnvKey: 'PORT',
  tokenSecretEnvKey: 'EDITOR_TOKEN_SECRET',
};

describe('processCliArgs', () => {
  it('帮助输出包含 Usage / run / serve', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = processCliArgs(['-h'], options);

    expect(result).toEqual({ shouldExit: true, exitCode: 0 });
    const text = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(text).toContain('Usage');
    expect(text).toContain('run');
    expect(text).toContain('serve');
    log.mockRestore();
  });

  it('帮助文本不含被砍掉的命令', () => {
    const text = buildHelpText(options);
    for (const gone of ['init', 'connect', 'open', 'config', 'changelog']) {
      expect(text).not.toContain(gone);
    }
  });

  it('版本输出与 exit code', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = processCliArgs(['-v'], options);

    expect(result).toEqual({ shouldExit: true, exitCode: 0 });
    expect(log).toHaveBeenCalledWith('9.9.9');
    log.mockRestore();
  });

  it('设置端口到环境变量', () => {
    const result = processCliArgs(['-p', '8080'], options);

    expect(result).toEqual({ shouldExit: false });
    expect(process.env['PORT']).toBe('8080');
  });

  it('非法端口报错并退出 1', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(processCliArgs(['--port', 'abc'], options)).toEqual({ shouldExit: true, exitCode: 1 });
    expect(processCliArgs(['--port', '0'], options)).toEqual({ shouldExit: true, exitCode: 1 });
    expect(processCliArgs(['--port', '65536'], options)).toEqual({ shouldExit: true, exitCode: 1 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('无参数时等价 serve（不退出）', () => {
    expect(processCliArgs([], options)).toEqual({ shouldExit: false });
  });

  it('切出 run 子命令并保留剩余参数', () => {
    const result = processCliArgs(['run', 'summarise the open PRs', '--json'], options);

    expect(result).toEqual({
      shouldExit: false,
      command: { name: 'run', args: ['summarise the open PRs', '--json'] },
    });
  });

  it('切出 serve 子命令', () => {
    const result = processCliArgs(['serve'], options);

    expect(result).toEqual({ shouldExit: false, command: { name: 'serve', args: [] } });
  });

  it('子命令里的 -p 不会被顶层吞掉', () => {
    const result = processCliArgs(['run', 'prompt', '-p', '9000'], options);

    expect(result).toEqual({
      shouldExit: false,
      command: { name: 'run', args: ['prompt', '-p', '9000'] },
    });
    expect(process.env['PORT']).toBeUndefined();
  });

  it('未知命令报错退出 1，不静默启动服务', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(processCliArgs(['init'], options)).toEqual({ shouldExit: true, exitCode: 1 });
    expect(error.mock.calls.map((call) => call.join(' ')).join('\n')).toContain('init');
    error.mockRestore();
  });

  it('未知子命令不进入命令分支', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const gone of ['init', 'connect', 'agent', 'config', 'changelog', 'open']) {
      expect(processCliArgs([gone], options)).toEqual({ shouldExit: true, exitCode: 1 });
    }
    error.mockRestore();
  });
});

describe('isCliCommand', () => {
  it('只认 run 与 serve', () => {
    expect(CLI_COMMANDS).toEqual(['run', 'serve']);
    expect(isCliCommand('run')).toBe(true);
    expect(isCliCommand('serve')).toBe(true);
    for (const gone of ['init', 'connect', 'agent', 'config', 'changelog', 'open']) {
      expect(isCliCommand(gone)).toBe(false);
    }
  });
});
