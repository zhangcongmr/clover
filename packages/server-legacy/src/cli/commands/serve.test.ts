import { describe, expect, it } from 'vitest';
import { applyServeOptions, parseServeArgs } from '../commands/serve.js';
import { CliUsageError } from '../errors.js';

describe('parseServeArgs', () => {
  it('默认没有额外选项', () => {
    expect(parseServeArgs([])).toEqual({ port: undefined, readonly: false });
  });

  it('解析 --port 与 --readonly', () => {
    expect(parseServeArgs(['--port', '9000', '--readonly'])).toEqual({
      port: 9000,
      readonly: true,
    });
  });

  it('支持 -p 短参与 --port=value', () => {
    expect(parseServeArgs(['-p', '8080']).port).toBe(8080);
    expect(parseServeArgs(['--port=8080']).port).toBe(8080);
  });

  it('非法端口报错', () => {
    expect(() => parseServeArgs(['--port', 'abc'])).toThrow(CliUsageError);
    expect(() => parseServeArgs(['--port', '0'])).toThrow(CliUsageError);
    expect(() => parseServeArgs(['--port', '65536'])).toThrow(CliUsageError);
  });

  it('未知选项与多余参数报错', () => {
    expect(() => parseServeArgs(['--bogus'])).toThrow(CliUsageError);
    expect(() => parseServeArgs(['stray'])).toThrow(CliUsageError);
  });
});

describe('applyServeOptions', () => {
  it('把选项写到既有环境变量上', () => {
    const env: NodeJS.ProcessEnv = {};
    applyServeOptions({ port: 9000, readonly: true }, env);

    expect(env['PORT']).toBe('9000');
    expect(env['CLOVER_READONLY']).toBe('true');
  });

  it('没有选项时不污染环境变量', () => {
    const env: NodeJS.ProcessEnv = {};
    applyServeOptions({ port: undefined, readonly: false }, env);

    expect(env).toEqual({});
  });

  it('不写入源码里不存在的键', () => {
    const env: NodeJS.ProcessEnv = {};
    applyServeOptions({ port: 9000, readonly: false }, env);

    expect(Object.keys(env)).toEqual(['PORT']);
  });
});
