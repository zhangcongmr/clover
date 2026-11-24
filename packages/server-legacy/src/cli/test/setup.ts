import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';

/**
 * 测试隔离：临时 HOME + 环境变量还原。
 *
 * CLI 读 `~/.clover/acp.json`，测试绝不能碰到真实的用户目录，也不能把
 * `PORT` / `CLOVER_READONLY` 之类的变量漏到别的用例里。
 */

const ENV_KEYS = ['HOME', 'USERPROFILE', 'PORT', 'CLOVER_READONLY', 'CLOVER_LOG_TO_FILE'] as const;

let tempHome: string | undefined;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'clover-cli-test-'));
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;
  delete process.env['PORT'];
  delete process.env['CLOVER_READONLY'];
  // 测试期间不写日志文件（免得在用户目录留下 ~/.clover/logs）。
  process.env['CLOVER_LOG_TO_FILE'] = 'false';
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = undefined;
  }
});
