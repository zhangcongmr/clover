/*
 * 冒烟测试：用真实 registry v0.1 响应样本验证 mcp-registry.service 的归一化/映射纯函数。
 *
 * 不进入 ng build（tsconfig 仅含 src/**）。运行方式（仓库根目录、PowerShell）：
 *   & (Get-ChildItem node_modules\.pnpm\@esbuild+win32-x64*\node_modules\@esbuild\win32-x64\esbuild.exe).FullName `
 *       packages\assistant\scripts\registry-smoke.ts --bundle --platform=node --format=cjs `
 *       --alias:@angular/core=./packages/assistant/scripts/angular-stub.ts `
 *       --outfile=packages\assistant\scripts\registry-smoke.cjs
 *   node packages\assistant\scripts\registry-smoke.cjs
 */
import {
  buildLocalConfig,
  deriveLocalName,
  localNameCandidates,
  normalizeListResponse,
  summarizeServer,
} from '../src/app/shared/mcp-manager/mcp-registry.service';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${label}`);
  } else {
    failures++;
    console.error(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}

/* ---- 1. normalizeListResponse：真实样本（search=filesystem, version 全量返回） ---- */
const sample = {
  servers: [
    {
      server: {
        name: 'com.pulsemcp/remote-filesystem',
        description: 'MCP server for remote filesystem operations on cloud storage (Google Cloud Storage).',
        version: '0.1.2',
        packages: [
          {
            registryType: 'npm',
            registryBaseUrl: 'https://registry.npmjs.org',
            identifier: 'remote-filesystem-mcp-server',
            version: '0.1.2',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            runtimeArguments: [{ value: '-y', type: 'positional' }],
            environmentVariables: [
              { description: 'bucket', isRequired: true, name: 'GCS_BUCKET' },
              { description: 'make default', name: 'GCS_MAKE_DEFAULT', default: 'false' },
            ],
          },
        ],
      },
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          status: 'active',
          statusChangedAt: '2026-05-18T13:28:59.991989Z',
          publishedAt: '2026-05-18T13:28:59.991989Z',
          updatedAt: '2026-05-18T13:28:59.991989Z',
          isLatest: false,
        },
      },
    },
    {
      server: { name: 'com.pulsemcp/remote-filesystem', version: '0.1.3' },
      _meta: {
        'io.modelcontextprotocol.registry/official': { status: 'deprecated', isLatest: false },
      },
    },
    { server: null as never }, // 脏数据：应被跳过
    { server: { version: '9.9.9' } as never }, // 脏数据：缺 name，应被跳过
  ],
  metadata: { nextCursor: 'com.pulsemcp/remote-filesystem:0.1.3', count: 2 },
};

const page = normalizeListResponse(sample as never, 30);
check('page keys 去重（name@version）', page.items.map(i => i.key), [
  'com.pulsemcp/remote-filesystem@0.1.2',
  'com.pulsemcp/remote-filesystem@0.1.3',
]);
check('status 归一化', page.items.map(i => i.status), ['active', 'deprecated']);
check('nextCursor 透传', page.nextCursor, 'com.pulsemcp/remote-filesystem:0.1.3');
check('空响应', normalizeListResponse({}, 30).items, []);
check('limit 截断', normalizeListResponse(sample as never, 1).items.length, 1);

/* ---- 2. deriveLocalName / localNameCandidates ---- */
// 本地 name 只允许 [a-zA-Z0-9_-]，`.` 与 `/` 均被 sanitize 为 `-`
check('候选名（基名 + 全名）', localNameCandidates('io.github.user/weather'), [
  'weather',
  'io-github-user-weather',
]);
check('无斜杠', localNameCandidates('my-server'), ['my-server']);
check('派生名：空闲取基名', deriveLocalName('io.github.user/weather', []), 'weather');
check(
  '派生名：基名被占回退全名',
  deriveLocalName('io.github.user/weather', ['weather']),
  'io-github-user-weather',
);
check(
  '派生名：全部冲突返回 null',
  deriveLocalName('io.github.user/weather', ['weather', 'io-github-user-weather']),
  null,
);

/* ---- 3. buildLocalConfig：npm stdio 条目 ---- */
const npmServer = sample.servers[0].server;
const npmConfig = buildLocalConfig(npmServer, 'remote-filesystem');
check('npm → stdio', npmConfig?.type, 'stdio');
check('npm command', npmConfig?.command, 'npx');
check('npm args', npmConfig?.args, ['-y', 'remote-filesystem-mcp-server@0.1.2']);
check('npm env（required 空串 / default 取默认）', npmConfig?.env, {
  GCS_BUCKET: '',
  GCS_MAKE_DEFAULT: 'false',
});
check('npm 预览', summarizeServer(npmServer), 'npx -y remote-filesystem-mcp-server@0.1.2');

/* ---- 4. buildLocalConfig：remote http 条目 ---- */
const remoteServer = {
  name: 'io.example/remote',
  description: 'remote server',
  remotes: [
    {
      type: 'streamable-http',
      url: 'https://api.example.com/mcp',
      headers: [
        { name: 'Authorization', value: 'Bearer x' },
        { name: 'X-Empty', value: '' },
      ],
    },
  ],
};
const remoteConfig = buildLocalConfig(remoteServer, 'remote');
check('remotes → http', remoteConfig?.type, 'http');
check('remotes url', remoteConfig?.url, 'https://api.example.com/mcp');
check('remotes headers（跳过空值）', remoteConfig?.headers, { Authorization: 'Bearer x' });
check('http 预览', summarizeServer(remoteServer), 'https://api.example.com/mcp');

/* ---- 5. 不可安装条目（mcpb 且无 runtimeHint） ---- */
const mcpbOnly = {
  name: 'io.example/bundle',
  packages: [{ registryType: 'mcpb', identifier: 'bundle.mcpb', transport: { type: 'stdio' } }],
};
check('mcpb 不可本地运行', buildLocalConfig(mcpbOnly, 'bundle'), null);
check('mcpb 无预览', summarizeServer(mcpbOnly), null);

/* ---- 6. named 参数展开 ---- */
const namedServer = {
  name: 'io.example/named',
  packages: [
    {
      registryType: 'pypi',
      identifier: 'my-mcp',
      version: '2.0.0',
      runtimeHint: 'uvx',
      transport: { type: 'stdio' },
      packageArguments: [
        { type: 'named', name: '--port', value: '8080' },
        { type: 'named', name: 'verbose' },
        { type: 'positional', value: 'extra' },
      ],
    },
  ],
};
const namedConfig = buildLocalConfig(namedServer, 'named');
check('pypi 锁版本 identifier@version', namedConfig?.args, [
  '--port',
  '8080',
  '--verbose',
  'extra',
  'my-mcp@2.0.0',
]);

/* ---- 7. 优先级：remotes 优先于 packages ---- */
const bothServer = {
  name: 'io.example/both',
  remotes: [{ type: 'sse', url: 'https://remote.example.com/sse' }],
  packages: [{ registryType: 'npm', identifier: 'x', runtimeHint: 'npx', transport: { type: 'stdio' } }],
};
check('remotes 优先', buildLocalConfig(bothServer, 'both')?.type, 'http');

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
