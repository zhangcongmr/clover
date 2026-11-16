import { describe, expect, it, vi } from 'vitest';
import { parseRunArgs, pickPermissionOutcome, resolveAgentId, resolveCwd } from '../commands/run.js';
import { CliUsageError } from '../errors.js';
import type { AgentConfig } from '../../acp/acp-agent.types.js';

function agent(id: string): AgentConfig {
  return { id, name: id, command: id };
}

describe('parseRunArgs', () => {
  it('解析提示词与 --agent', () => {
    expect(parseRunArgs(['summarise the open PRs', '--agent', 'codex'])).toEqual({
      prompt: 'summarise the open PRs',
      agent: 'codex',
      root: undefined,
      json: false,
      approve: false,
    });
  });

  it('选项可以出现在位置参数之前', () => {
    expect(parseRunArgs(['--agent', 'codex', 'hello'])).toMatchObject({
      prompt: 'hello',
      agent: 'codex',
    });
  });

  it('支持 --flag=value 形式', () => {
    expect(parseRunArgs(['--agent=codex', '--root=/tmp', 'hi'])).toMatchObject({
      prompt: 'hi',
      agent: 'codex',
      root: '/tmp',
    });
  });

  it('多段位置参数拼成一句话', () => {
    expect(parseRunArgs(['summarise', 'the', 'open', 'PRs']).prompt)
      .toBe('summarise the open PRs');
  });

  it('-- 之后的内容都算提示词', () => {
    expect(parseRunArgs(['--', '--not-an-option']).prompt).toBe('--not-an-option');
  });

  it('--json 与 --approve 是布尔开关', () => {
    expect(parseRunArgs(['--json', '--approve', 'x'])).toMatchObject({
      json: true,
      approve: true,
    });
  });

  it('缺少选项值时报错', () => {
    expect(() => parseRunArgs(['--agent'])).toThrow(CliUsageError);
    expect(() => parseRunArgs(['--root'])).toThrow(CliUsageError);
  });

  it('缺少提示词时报错', () => {
    expect(() => parseRunArgs([])).toThrow(CliUsageError);
    expect(() => parseRunArgs(['   '])).toThrow(CliUsageError);
  });

  it('未知选项报错', () => {
    expect(() => parseRunArgs(['--bogus', 'x'])).toThrow(CliUsageError);
  });
});

describe('resolveAgentId', () => {
  it('未安装任何 agent 时报错', () => {
    expect(() => resolveAgentId([], undefined)).toThrow(CliUsageError);
  });

  it('只装了一个时直接用它', () => {
    expect(resolveAgentId([agent('opencode')], undefined)).toBe('opencode');
  });

  it('装了多个且未指定时报错并列出已安装的 id', () => {
    expect(() => resolveAgentId([agent('a'), agent('b')], undefined)).toThrow(/a, b/);
  });

  it('指定的 agent 必须已安装', () => {
    expect(resolveAgentId([agent('a')], 'a')).toBe('a');
    expect(() => resolveAgentId([agent('a')], 'zzz')).toThrow(/Unknown agent/);
  });
});

describe('resolveCwd', () => {
  it('缺省时用当前目录', () => {
    expect(resolveCwd(undefined)).toBe(process.cwd());
  });

  it('--root 会解析成绝对路径', () => {
    expect(resolveCwd('some/dir')).toMatch(/some[/\\]dir$/);
  });
});

describe('pickPermissionOutcome', () => {
  const options = [
    { optionId: 'allow-1', kind: 'allow_once' },
    { optionId: 'reject-1', kind: 'reject_once' },
    { optionId: 'allow-2', kind: 'allow_always' },
  ];

  it('允许时优先 allow_once', () => {
    expect(pickPermissionOutcome(options, true)).toEqual({
      outcome: 'selected',
      optionId: 'allow-1',
    });
  });

  it('拒绝时优先 reject_once', () => {
    expect(pickPermissionOutcome(options, false)).toEqual({
      outcome: 'selected',
      optionId: 'reject-1',
    });
  });

  it('没有可选项时退化为 cancelled', () => {
    expect(pickPermissionOutcome([], true)).toEqual({ outcome: 'cancelled' });
    expect(pickPermissionOutcome(undefined, false)).toEqual({ outcome: 'cancelled' });
  });

  it('只有允许项时拒绝也退化为 cancelled', () => {
    expect(pickPermissionOutcome([{ optionId: 'a', kind: 'allow_once' }], false))
      .toEqual({ outcome: 'cancelled' });
  });
});
