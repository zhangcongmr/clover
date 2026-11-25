#!/usr/bin/env node
/**
 * Executable parity spec for the `packages/server` → `packages/server-rust`
 * migration (P9).
 *
 * Both servers are started side by side with the same token secret, the same
 * seeded `~/.clover` contents and identical workspaces. The same scripted
 * requests are replayed against each one and the transcripts are diffed field
 * by field — status codes, JSON bodies, SSE event sequences and WebSocket
 * frames.
 *
 * usage:
 *   node scripts/parity.mjs                     # all stages
 *   node scripts/parity.mjs --stage http        # no ACP/WS (fast)
 *   node scripts/parity.mjs --only mcp --verbose
 *   node scripts/parity.mjs --list
 *   node scripts/parity.mjs --keep              # keep temp dirs + server logs
 *
 * stages:
 *   http  stateless + CRUD endpoints (default)
 *   ws    /ws/terminal and /ws/file-watch
 *   acp   real ACP sessions driven by tests/fixtures/mock-acp-agent.mjs
 *
 * exit codes: 0 = parity, 1 = differences, 2 = harness/setup failure.
 */
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAGES = ['http', 'ws', 'acp'];
const SECRET = 'parity-secret';
const VOLATILE_KEYS = new Set([
  'token',
  'expiresIn',
  'timestamp',
  'createdAt',
  'lastActivity',
  'startedAt',
  'finishedAt',
  'updatedAt',
  'lastChecked',
  'checkedAt',
  'probedAt',
  'mtime',
  'mtimeMs',
  'ctimeMs',
  'birthtimeMs',
  'pid',
  'duration',
  'durationMs',
  'elapsedMs',
]);

/** Divergences that are accepted and documented in docs/rust-server-migration-plan.md. */
const ACCEPTED = [
  {
    case: 'ws.terminal',
    path: 'frame kind',
    reason: 'PTY output frames are binary in Rust (avoids splitting multi-byte UTF-8)',
  },
  {
    case: 'http.acp.agents',
    path: 'GET unknown agent.text',
    reason: 'the TS app has no GET /api/acp/agents/:id route, so Express answers with its default HTML 404',
  },
];

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const USAGE = `clover server parity harness

usage: node scripts/parity.mjs [options]

options:
  --stage <list>   comma separated: http, ws, acp, all (default: all)
  --only <text>    run cases whose name contains <text> (repeatable)
  --list           list cases and exit
  --verbose        print both transcripts for failing cases
  --keep           keep the temp workspace and server logs
  --no-build       start servers from existing binaries only
  --timeout <ms>   per-request timeout (default 20000)
  -h, --help       show this help`;

function fail(message) {
  console.error(`[parity] ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    stages: new Set(STAGES),
    only: [],
    list: false,
    verbose: false,
    keep: false,
    build: true,
    timeout: 20000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) fail(`missing value for ${arg}`);
      return next;
    };
    switch (arg) {
      case '--stage': {
        const list = value();
        opts.stages = new Set(list === 'all' ? STAGES : list.split(',').map((s) => s.trim()));
        break;
      }
      case '--only':
        opts.only.push(value());
        break;
      case '--list':
        opts.list = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--keep':
        opts.keep = true;
        break;
      case '--no-build':
        opts.build = false;
        break;
      case '--timeout':
        opts.timeout = Number(value());
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }
  for (const stage of opts.stages) {
    if (!STAGES.includes(stage)) fail(`unknown stage: ${stage}`);
  }
  return opts;
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function writeDeep(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

function seedWorkspace(root) {
  mkdirSync(root, { recursive: true });
  const files = {
    'README.md': '# Parity workspace\n\nshared fixture for both servers\n',
    'src/index.ts': 'export const answer: number = 42;\n',
    'src/util/strings.ts': 'export const upper = (s: string): string => s.toUpperCase();\n',
    'src/util/format.ts': "export const pad = (n: number): string => String(n).padStart(2, '0');\n",
    'notes/todo.md': '- [ ] parity\n- [x] fixture\n',
    'data/config.json': '{"a":1,"b":[2,3]}\n',
    'empty.txt': '',
    '.hidden/secret.txt': 'hidden\n',
    'node_modules/fake/index.js': 'module.exports = 1;\n',
  };
  for (const [rel, content] of Object.entries(files)) writeDeep(join(root, rel), content);
}

function seedHome(home) {
  const clover = join(home, '.clover');

  writeDeep(join(clover, 'mcp-servers.json'), JSON.stringify({
    servers: {
      seeded: {
        type: 'stdio',
        description: 'seeded stdio server',
        command: 'node',
        args: ['-e', 'console.log(1)'],
        env: { PARITY_TOKEN: '${PARITY_TOKEN}' },
        name: 'seeded',
      },
      remote: {
        type: 'http',
        description: 'seeded http server',
        url: 'https://example.invalid/mcp',
        headers: { Authorization: 'Bearer ${PARITY_TOKEN}' },
        name: 'remote',
      },
    },
  }, null, 2));

  // Writable directory store skill: ~/.clover/skills/demo
  writeDeep(join(clover, 'skills', 'demo', 'SKILL.md'), [
    '---',
    'name: demo',
    'description: Parity demo skill',
    '---',
    '',
    '# Demo skill',
    '',
    'Steps for the parity harness.',
    '',
  ].join('\n'));
  writeDeep(join(clover, 'skills', 'demo', 'references', 'notes.md'), 'reference notes\n');

  // Read-only discovered skill: ~/.claude/skills/disk-only
  writeDeep(join(home, '.claude', 'skills', 'disk-only', 'SKILL.md'), [
    '---',
    'name: disk-only',
    'description: Discovered on disk, not writable',
    '---',
    '',
    '# Disk only',
    '',
  ].join('\n'));

  const fixture = join(repoRoot, 'packages', 'server-rust', 'tests', 'fixtures', 'mock-acp-agent.mjs');
  writeDeep(join(clover, 'acp.json'), JSON.stringify({
    version: '1.0.0',
    agents: [
      {
        id: 'mock',
        name: 'Mock Agent',
        command: process.execPath,
        args: [fixture],
        source: 'disk',
        installed: true,
      },
      {
        id: 'ghost',
        name: 'Ghost Agent',
        command: 'clover-parity-missing-command',
        args: [],
        source: 'disk',
        installed: true,
      },
    ],
  }, null, 2));
}

/* -------------------------------------------------------------------------- */
/* Servers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Root for the per-run sandbox.
 *
 * Kept inside the repo by default: sandboxed child binaries may be allowed to
 * write only under the workspace, and a temp dir under `%TEMP%` fails with
 * EACCES even though the harness itself can create it. `PARITY_TMPDIR`
 * overrides it.
 */
function tempParent() {
  const base = process.env.PARITY_TMPDIR
    ? resolve(process.env.PARITY_TMPDIR)
    : join(repoRoot, 'target', 'parity');
  mkdirSync(base, { recursive: true });
  return base;
}

function freePort() {
  return new Promise((ok, bad) => {
    const server = createNetServer();
    server.once('error', bad);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => ok(port));
    });
  });
}

function waitForHttp(url, timeoutMs) {
  return new Promise((ok, bad) => {
    const deadline = Date.now() + timeoutMs;
    const tick = async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        await res.arrayBuffer();
        if (res.status === 200) return ok();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return bad(new Error(`timeout waiting for ${url}`));
      setTimeout(tick, 150);
    };
    tick();
  });
}

class ServerInstance {
  constructor({ name, baseUrl, port, home, workspace, timeout }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.port = port;
    this.home = home;
    this.workspace = workspace;
    this.timeout = timeout;
    this.token = '';
  }

  /* ---------------- normalization ---------------- */

  norm(value, key) {
    if (key && VOLATILE_KEYS.has(key)) return `<${key}>`;
    if (Array.isArray(value)) return value.map((item) => this.norm(item, key));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [childKey, item] of Object.entries(value)) out[childKey] = this.norm(item, childKey);
      return out;
    }
    if (typeof value === 'string') return this.normText(value, key);
    return value;
  }

  normText(text, key) {
    if (key && VOLATILE_KEYS.has(key)) return `<${key}>`;
    let out = String(text);
    const pairs = [
      [this.workspace, '<workspace>'],
      [this.workspace.replaceAll('\\', '/'), '<workspace>'],
      [this.home, '<home>'],
      [this.home.replaceAll('\\', '/'), '<home>'],
      [`127.0.0.1:${this.port}`, '127.0.0.1:<port>'],
      [`localhost:${this.port}`, 'localhost:<port>'],
    ];
    for (const [from, to] of pairs) {
      if (from) out = out.split(from).join(to);
    }
    out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '<uuid>');
    out = out.replace(/\bperm_\d+_[a-z0-9]+\b/giu, '<permissionId>');
    out = out.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<timestamp>');
    return out;
  }

  /* ---------------- HTTP ---------------- */

  async call(method, path, { body, rawBody, token = true, headers = {} } = {}) {
    const sent = { ...headers };
    if (body !== undefined) sent['content-type'] = 'application/json';
    if (rawBody !== undefined) sent['content-type'] = 'application/json';
    if (token) sent.authorization = `Bearer ${this.token}`;
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: sent,
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return {
      status: res.status,
      headers: res.headers,
      body: parsed,
      text: parsed === undefined ? text : undefined,
    };
  }

  async mintToken() {
    const res = await this.call('GET', '/api/local/auth/token', { token: false });
    if (res.status !== 200 || !res.body?.token) {
      throw new Error(`${this.name}: cannot mint token (${res.status} ${res.text ?? ''})`);
    }
    this.token = res.body.token;
    return res;
  }

  step(label, res, { headers = false } = {}) {
    const entry = { label, status: res.status };
    if (headers) entry.headers = pickHeaders(res.headers);
    if (res.body !== undefined) entry.body = this.norm(res.body);
    else if (res.text !== undefined) entry.text = this.normText(res.text);
    return entry;
  }

  note(label, value) {
    return { label, value: this.norm(value) };
  }

  /* ---------------- SSE ---------------- */

  async openSse(path, { headers = {}, token = true } = {}) {
    const controller = new AbortController();
    const res = await fetch(this.baseUrl + path, {
      headers: {
        accept: 'text/event-stream',
        ...(token ? { authorization: `Bearer ${this.token}` } : {}),
        ...headers,
      },
      signal: controller.signal,
    });
    if (res.status !== 200 || !res.body) {
      const text = await res.text();
      controller.abort();
      return {
        status: res.status,
        headers: res.headers,
        text,
        next: async () => null,
        collectUntil: async () => [],
        close() {},
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;
    const queue = [];

    const pump = async () => {
      while (!queue.length && !finished) {
        const { value, done } = await reader.read();
        if (done) {
          finished = true;
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (event) queue.push(event);
        }
      }
    };

    const stream = {
      status: res.status,
      headers: res.headers,
      async next(timeoutMs = 5000) {
        if (queue.length) return queue.shift();
        if (finished) return null;
        let timer;
        const timeout = new Promise((ok) => {
          timer = setTimeout(() => ok('timeout'), timeoutMs);
        });
        const outcome = await Promise.race([pump().then(() => 'read'), timeout]);
        clearTimeout(timer);
        if (outcome === 'timeout') return null;
        return queue.shift() ?? null;
      },
      async collectUntil(predicate, timeoutMs = 10000) {
        const events = [];
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const event = await this.next(deadline - Date.now());
          if (!event) break;
          events.push(event);
          if (predicate(event)) return events;
        }
        return events;
      },
      close() {
        controller.abort();
      },
    };
    return stream;
  }

  /* ---------------- WebSocket ---------------- */

  async connectWs(path) {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}${path}`);
    ws.binaryType = 'arraybuffer';
    const frames = [];
    const waiters = [];
    const flush = () => {
      while (waiters.length && frames.length) waiters.shift()(frames.shift());
    };
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => bad(new Error(`${this.name}: ws connect failed`)), { once: true });
    });
    ws.addEventListener('message', (event) => {
      const frame =
        typeof event.data === 'string'
          ? { kind: 'text', text: event.data }
          : { kind: 'binary', text: new TextDecoder().decode(event.data) };
      frames.push(frame);
      flush();
    });
    ws.addEventListener('close', () => {
      while (waiters.length) waiters.shift()(null);
    });
    return {
      send(value) {
        ws.send(typeof value === 'string' ? value : JSON.stringify(value));
      },
      next(timeoutMs = 5000) {
        if (frames.length) return Promise.resolve(frames.shift());
        return new Promise((ok) => {
          const timer = setTimeout(() => ok(null), timeoutMs);
          waiters.push((frame) => {
            clearTimeout(timer);
            ok(frame);
          });
        });
      },
      close() {
        try {
          ws.close();
        } catch {
          // already closed
        }
      },
    };
  }
}

function pickHeaders(headers) {
  const picked = {};
  for (const key of [
    'content-type',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'vary',
  ]) {
    const value = headers.get(key);
    if (value != null) {
      picked[key] = key === 'content-type' ? value.replace(/;\s*charset=utf-8/i, '') : value;
    }
  }
  return picked;
}

function parseSseBlock(block) {
  const lines = block.split(/\r?\n/);
  let event;
  let id;
  const data = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // keep the raw text (comments, plain payloads)
  }
  return { event, id, data: parsed };
}

/* -------------------------------------------------------------------------- */
/* Case registry                                                              */
/* -------------------------------------------------------------------------- */

const cases = [];
function define(name, stage, run) {
  cases.push({ name, stage, run });
}

function tokenShape(token) {
  if (typeof token !== 'string') return { format: 'missing' };
  let raw = '';
  try {
    raw = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return { format: 'not-base64url' };
  }
  const match = /^(\d{10,16}):([0-9a-f]{16,64}):([0-9a-f]{64})$/u.exec(raw);
  if (!match) return { format: 'unexpected', rawLength: raw.length };
  return { format: 'expires:nonce:hmac', nonceLen: match[2].length, hmacLen: match[3].length };
}

/* ---------------------------------- http ---------------------------------- */

define('http.auth.token', 'http', async (ctx) => {
  const first = await ctx.call('GET', '/api/local/auth/token', { token: false });
  const second = await ctx.call('GET', '/api/local/auth/token', { token: false });
  return [
    ctx.step('GET /api/local/auth/token', first),
    ctx.note('token shape', tokenShape(first.body?.token)),
    ctx.note('rotates per call', first.body?.token !== second.body?.token),
  ];
});

define('http.auth.guards', 'http', async (ctx) => {
  const out = [];
  const unauthorized = [
    ['POST', '/api/local/scan', { path: ctx.workspace }],
    ['POST', '/api/local/readFile', { path: join(ctx.workspace, 'README.md') }],
    ['GET', '/api/acp/status', undefined],
    ['GET', '/api/acp/session/list', undefined],
    ['POST', '/api/a2a/collab/spaces', {}],
  ];
  for (const [method, path, body] of unauthorized) {
    out.push(ctx.step(`${method} ${path} (no token)`, await ctx.call(method, path, { body, token: false })));
    out.push(
      ctx.step(
        `${method} ${path} (bad token)`,
        await ctx.call(method, path, { body, token: false, headers: { authorization: 'Bearer nope' } }),
      ),
    );
  }

  // These are intentionally unauthenticated: the settings UI calls them without
  // a token.
  for (const [method, path, body] of [
    ['GET', '/api/mcp/servers', undefined],
    ['GET', '/api/skills', undefined],
    ['POST', '/api/projects', {}],
  ]) {
    out.push(ctx.step(`${method} ${path} (no token)`, await ctx.call(method, path, { body, token: false })));
  }

  // Unknown paths are 404, never 401: the bearer middleware guards registered
  // routes only, not the router fallback. Only the status is compared — Express
  // sends its default HTML body, the Rust router an empty one.
  for (const path of ['/', '/api/unknown']) {
    const res = await ctx.call('GET', path, { token: false });
    out.push({ label: `GET ${path} (no token)`, status: res.status });
  }

  out.push(
    ctx.step(
      'OPTIONS /api/local/scan',
      await ctx.call('OPTIONS', '/api/local/scan', {
        token: false,
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization',
        },
      }),
      { headers: true },
    ),
  );
  // The A2A SDK sends `A2A-Version` on the card and JSON-RPC requests. A
  // preflight that does not allow it blocks every cross-origin A2A call while
  // same-origin keeps working — compare the allow-headers list to catch drift.
  out.push(
    ctx.step(
      'OPTIONS A2A agent card (cross-origin)',
      await ctx.call('OPTIONS', '/api/a2a/orchestrator/.well-known/agent-card.json', {
        token: false,
        headers: {
          origin: 'http://localhost:4200',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'a2a-version,authorization',
        },
      }),
      { headers: true },
    ),
  );
  out.push(
    ctx.step(
      'GET /api/local/health (Origin)',
      await ctx.call('GET', '/api/local/health', {
        token: false,
        headers: { origin: 'http://localhost:3000' },
      }),
      { headers: true },
    ),
  );
  return out;
});

define('http.local.roots', 'http', async (ctx) => [
  ctx.step('POST /api/local/roots', await ctx.call('POST', '/api/local/roots', { body: {} })),
]);

define('http.local.listDir', 'http', async (ctx) => {
  const file = join(ctx.workspace, 'README.md');
  return [
    ctx.step('workspace', await ctx.call('POST', '/api/local/listDir', { body: { path: ctx.workspace } })),
    ctx.step('src', await ctx.call('POST', '/api/local/listDir', { body: { path: join(ctx.workspace, 'src') } })),
    ctx.step('missing path', await ctx.call('POST', '/api/local/listDir', { body: {} })),
    ctx.step('nonexistent dir', await ctx.call('POST', '/api/local/listDir', { body: { path: join(ctx.workspace, 'nope') } })),
    ctx.step('file instead of dir', await ctx.call('POST', '/api/local/listDir', { body: { path: file } })),
  ];
});

define('http.local.scan', 'http', async (ctx) => [
  ctx.step('depth 2', await ctx.call('POST', '/api/local/scan', { body: { path: ctx.workspace, depth: 2 } })),
  ctx.step(
    'depth 4 + ignore',
    await ctx.call('POST', '/api/local/scan', {
      body: { path: ctx.workspace, depth: 4, ignore: ['node_modules', 'data'] },
    }),
  ),
  ctx.step('missing path', await ctx.call('POST', '/api/local/scan', { body: {} })),
  ctx.step('nonexistent', await ctx.call('POST', '/api/local/scan', { body: { path: join(ctx.workspace, 'nope') } })),
]);

define('http.local.readFile', 'http', async (ctx) => [
  ctx.step('README.md', await ctx.call('POST', '/api/local/readFile', { body: { path: join(ctx.workspace, 'README.md') } })),
  ctx.step('empty.txt', await ctx.call('POST', '/api/local/readFile', { body: { path: join(ctx.workspace, 'empty.txt') } })),
  ctx.step('missing path', await ctx.call('POST', '/api/local/readFile', { body: {} })),
  ctx.step('nonexistent', await ctx.call('POST', '/api/local/readFile', { body: { path: join(ctx.workspace, 'nope.txt') } })),
  ctx.step('directory', await ctx.call('POST', '/api/local/readFile', { body: { path: join(ctx.workspace, 'src') } })),
]);

define('http.local.stat', 'http', async (ctx) => [
  ctx.step('README.md', await ctx.call('POST', '/api/local/stat', { body: { path: join(ctx.workspace, 'README.md') } })),
  ctx.step('src', await ctx.call('POST', '/api/local/stat', { body: { path: join(ctx.workspace, 'src') } })),
  ctx.step('missing path', await ctx.call('POST', '/api/local/stat', { body: {} })),
  ctx.step('nonexistent', await ctx.call('POST', '/api/local/stat', { body: { path: join(ctx.workspace, 'nope.txt') } })),
  ctx.step('exists file', await ctx.call('POST', '/api/local/exists', { body: { path: join(ctx.workspace, 'README.md') } })),
  ctx.step('exists dir', await ctx.call('POST', '/api/local/exists', { body: { path: join(ctx.workspace, 'src') } })),
  ctx.step('exists missing', await ctx.call('POST', '/api/local/exists', { body: { path: join(ctx.workspace, 'nope') } })),
  ctx.step('exists no path', await ctx.call('POST', '/api/local/exists', { body: {} })),
]);

define('http.local.mutations', 'http', async (ctx) => {
  const out = join(ctx.workspace, 'out');
  const a = join(out, 'a.txt');
  const b = join(out, 'b.txt');
  return [
    ctx.step('createDir', await ctx.call('POST', '/api/local/createDir', { body: { path: out } })),
    ctx.step('createFile', await ctx.call('POST', '/api/local/createFile', { body: { path: a } })),
    ctx.step('writeFile', await ctx.call('POST', '/api/local/writeFile', { body: { path: b, content: 'parity\n' } })),
    ctx.step('readFile', await ctx.call('POST', '/api/local/readFile', { body: { path: b } })),
    ctx.step('exists', await ctx.call('POST', '/api/local/exists', { body: { path: a } })),
    ctx.step('rename', await ctx.call('POST', '/api/local/rename', { body: { path: a, newName: 'a2.txt' } })),
    ctx.step('rename missing args', await ctx.call('POST', '/api/local/rename', { body: { path: a } })),
    ctx.step('listDir out', await ctx.call('POST', '/api/local/listDir', { body: { path: out } })),
    ctx.step('deleteDir', await ctx.call('POST', '/api/local/deleteFile', { body: { path: out } })),
    ctx.step('exists after delete', await ctx.call('POST', '/api/local/exists', { body: { path: out } })),
    ctx.step('delete nonexistent', await ctx.call('POST', '/api/local/deleteFile', { body: { path: join(ctx.workspace, 'nope') } })),
  ];
});

define('http.local.writeValidation', 'http', async (ctx) => [
  ctx.step('writeFile without path', await ctx.call('POST', '/api/local/writeFile', { body: { content: 'x' } })),
  ctx.step(
    'writeFile without content',
    await ctx.call('POST', '/api/local/writeFile', { body: { path: join(ctx.workspace, 'data', 'nofield.txt') } }),
  ),
  ctx.step(
    'writeFile into missing dir',
    await ctx.call('POST', '/api/local/writeFile', {
      body: { path: join(ctx.workspace, 'missing-dir', 'x.txt'), content: 'x' },
    }),
  ),
  ctx.step('createFile no path', await ctx.call('POST', '/api/local/createFile', { body: {} })),
  ctx.step('createDir no path', await ctx.call('POST', '/api/local/createDir', { body: {} })),
]);

define('http.mcp.list', 'http', async (ctx) => [
  ctx.step('GET /api/mcp/servers', await ctx.call('GET', '/api/mcp/servers', { token: false })),
  ctx.step('GET /api/mcp/servers/seeded', await ctx.call('GET', '/api/mcp/servers/seeded', { token: false })),
  ctx.step('GET /api/mcp/servers/unknown', await ctx.call('GET', '/api/mcp/servers/unknown', { token: false })),
]);

define('http.mcp.crud', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  at('create without name', await ctx.call('POST', '/api/mcp/servers', { body: { type: 'stdio', command: 'node' } }));
  at('create stdio without command', await ctx.call('POST', '/api/mcp/servers', { body: { name: 'x', type: 'stdio' } }));
  at('create http without url', await ctx.call('POST', '/api/mcp/servers', { body: { name: 'x', type: 'http' } }));
  at('create bad type', await ctx.call('POST', '/api/mcp/servers', { body: { name: 'x', type: 'sse' } }));
  at(
    'create stdio',
    await ctx.call('POST', '/api/mcp/servers', {
      body: { name: 'parity-stdio', type: 'stdio', description: 'd', command: 'node', args: ['-e', '0'], env: { A: 'b' } },
    }),
  );
  at(
    'create http',
    await ctx.call('POST', '/api/mcp/servers', {
      body: { name: 'parity-http', type: 'http', url: 'https://example.invalid', headers: { H: 'v' } },
    }),
  );
  at('list', await ctx.call('GET', '/api/mcp/servers', { token: false }));
  at('get created', await ctx.call('GET', '/api/mcp/servers/parity-stdio', { token: false }));
  at(
    'update stdio',
    await ctx.call('PUT', '/api/mcp/servers/parity-stdio', { body: { description: 'updated', args: ['-e', '1'] } }),
  );
  at('get updated', await ctx.call('GET', '/api/mcp/servers/parity-stdio', { token: false }));
  at('update unknown', await ctx.call('PUT', '/api/mcp/servers/nope', { body: { description: 'x' } }));
  at('delete', await ctx.call('DELETE', '/api/mcp/servers/parity-stdio'));
  at('delete again', await ctx.call('DELETE', '/api/mcp/servers/parity-stdio'));
  at('list after delete', await ctx.call('GET', '/api/mcp/servers', { token: false }));
  return out;
});

define('http.skills.list', 'http', async (ctx) => [
  ctx.step('GET /api/skills', await ctx.call('GET', '/api/skills', { token: false })),
  ctx.step('POST /api/skills/reload', await ctx.call('POST', '/api/skills/reload', { body: {} })),
]);

define('http.skills.detail', 'http', async (ctx) => [
  ctx.step('GET demo', await ctx.call('GET', '/api/skills/demo', { token: false })),
  ctx.step('GET disk-only', await ctx.call('GET', '/api/skills/disk-only', { token: false })),
  ctx.step('GET unknown', await ctx.call('GET', '/api/skills/nope', { token: false })),
]);

define('http.skills.crud', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  at('create without name', await ctx.call('POST', '/api/skills', { body: { content: 'x' } }));
  at('create blank name', await ctx.call('POST', '/api/skills', { body: { name: '   ', content: 'x' } }));
  at('create without content', await ctx.call('POST', '/api/skills', { body: { name: 'parity-skill' } }));
  at(
    'create with bad files',
    await ctx.call('POST', '/api/skills', { body: { name: 'parity-skill', content: 'x', files: [] } }),
  );
  at(
    'create',
    await ctx.call('POST', '/api/skills', {
      body: {
        name: 'parity-skill',
        description: 'created by parity',
        content: '---\nname: parity-skill\n---\n\n# Parity\n',
        files: { 'references/one.md': 'one\n' },
      },
    }),
  );
  at('get created', await ctx.call('GET', '/api/skills/parity-skill', { token: false }));
  at('update content', await ctx.call('PUT', '/api/skills/parity-skill', { body: { content: '# Updated\n' } }));
  at('get updated', await ctx.call('GET', '/api/skills/parity-skill', { token: false }));
  at('update blank content', await ctx.call('PUT', '/api/skills/parity-skill', { body: { content: ' ' } }));
  at('update unknown', await ctx.call('PUT', '/api/skills/nope', { body: { content: 'x' } }));
  at('update read-only', await ctx.call('PUT', '/api/skills/disk-only', { body: { content: '# nope\n' } }));
  at('duplicate', await ctx.call('POST', '/api/skills/parity-skill/duplicate', { body: {} }));
  at('duplicate unknown', await ctx.call('POST', '/api/skills/nope/duplicate', { body: {} }));
  at('delete read-only', await ctx.call('DELETE', '/api/skills/disk-only'));
  at('delete', await ctx.call('DELETE', '/api/skills/parity-skill'));
  at('delete copy', await ctx.call('DELETE', '/api/skills/parity-skill-copy'));
  at('delete unknown', await ctx.call('DELETE', '/api/skills/nope'));
  return out;
});

define('http.projects.flow', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  const projectPath = join(ctx.workspace, 'src');
  at('list projects', await ctx.call('POST', '/api/projects', { body: {} }));
  at('list tasks', await ctx.call('POST', '/api/tasks', { body: {} }));
  at('add project without name', await ctx.call('POST', '/api/projects/add', { body: { path: projectPath } }));
  at(
    'add project missing dir',
    await ctx.call('POST', '/api/projects/add', { body: { name: 'Nope', path: join(ctx.workspace, 'nope') } }),
  );
  at('add project', await ctx.call('POST', '/api/projects/add', { body: { name: 'Src', path: projectPath } }));
  at('add duplicate', await ctx.call('POST', '/api/projects/add', { body: { name: 'Src again', path: projectPath } }));
  at('add task without id', await ctx.call('POST', '/api/projects/add', { body: { name: 'T', type: 'task' } }));
  at(
    'add task',
    await ctx.call('POST', '/api/projects/add', { body: { name: 'Task', type: 'task', id: 'task-1' } }),
  );
  at('list projects 2', await ctx.call('POST', '/api/projects', { body: {} }));
  at('list tasks 2', await ctx.call('POST', '/api/tasks', { body: {} }));
  at(
    'save session',
    await ctx.call('POST', '/api/projects/save-session', {
      body: {
        projectPath,
        session: { sessionId: 's-1', agentId: 'mock', title: 'First', updatedAt: '2026-01-02T03:04:05.000Z' },
      },
    }),
  );
  at(
    'save same session again',
    await ctx.call('POST', '/api/projects/save-session', {
      body: { projectPath, session: { sessionId: 's-1', agentId: 'mock', title: 'First renamed' } },
    }),
  );
  at(
    'save session unknown project',
    await ctx.call('POST', '/api/projects/save-session', {
      body: { projectPath: join(ctx.workspace, 'nope'), session: { sessionId: 's-2', agentId: 'mock' } },
    }),
  );
  at(
    'save session missing args',
    await ctx.call('POST', '/api/projects/save-session', { body: { projectPath } }),
  );
  at('selected', await ctx.call('POST', '/api/projects/selected', { body: {} }));
  at('set selected', await ctx.call('POST', '/api/projects/selected', { body: { path: projectPath } }));
  at('selected 2', await ctx.call('POST', '/api/projects/selected', { body: {} }));
  at(
    'delete session',
    await ctx.call('POST', '/api/projects/delete-session', { body: { projectPath, sessionId: 's-1' } }),
  );
  at('delete session missing args', await ctx.call('POST', '/api/projects/delete-session', { body: {} }));
  at('delete project without path', await ctx.call('POST', '/api/projects/delete', { body: {} }));
  at('delete project', await ctx.call('POST', '/api/projects/delete', { body: { path: projectPath } }));
  at('delete task', await ctx.call('POST', '/api/projects/delete', { body: { type: 'task', id: 'task-1' } }));
  at('list projects 3', await ctx.call('POST', '/api/projects', { body: {} }));
  at('list tasks 3', await ctx.call('POST', '/api/tasks', { body: {} }));
  return out;
});

define('http.acp.agents', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  at('GET /api/acp/agents', await ctx.call('GET', '/api/acp/agents'));
  at('GET /api/acp/agent-config', await ctx.call('GET', '/api/acp/agent-config'));
  at('POST agent-config invalid', await ctx.call('POST', '/api/acp/agent-config', { body: { agents: 'nope' } }));
  at('GET /api/acp/status', await ctx.call('GET', '/api/acp/status'));
  at('GET /api/acp/health', await ctx.call('GET', '/api/acp/health'));
  at('POST /api/acp/ping mock', await ctx.call('POST', '/api/acp/ping', { body: { agentId: 'mock' } }));
  at('POST /api/acp/ping unknown', await ctx.call('POST', '/api/acp/ping', { body: { agentId: 'nope' } }));
  at('POST check mock', await ctx.call('POST', '/api/acp/agents/mock/check'));
  at('POST check ghost', await ctx.call('POST', '/api/acp/agents/ghost/check'));
  at('POST check unknown', await ctx.call('POST', '/api/acp/agents/nope/check'));
  at('GET unknown agent', await ctx.call('GET', '/api/acp/agents/nope'));
  at('POST install without body', await ctx.call('POST', '/api/acp/agents/install', { body: {} }));
  at('POST install bad source', await ctx.call('POST', '/api/acp/agents/install', { body: { source: 'nope' } }));
  at('GET unknown install job', await ctx.call('GET', '/api/acp/agents/install/nope'));
  at('POST update unknown', await ctx.call('POST', '/api/acp/agents/nope/update'));
  at('DELETE uninstall unknown', await ctx.call('DELETE', '/api/acp/agents/nope/uninstall'));
  at('session create without agentId', await ctx.call('POST', '/api/acp/session/create', { body: {} }));
  at('session list without agentId', await ctx.call('POST', '/api/acp/session/list', { body: {} }));
  at(
    'list-all-sessions without cwd',
    await ctx.call('POST', '/api/acp/list-all-sessions', { body: {} }),
  );
  at('session load unknown', await ctx.call('POST', '/api/acp/session/load', { body: { sessionId: 'nope' } }));
  at('session resume unknown', await ctx.call('POST', '/api/acp/session/resume', { body: { sessionId: 'nope' } }));
  at('session delete unknown', await ctx.call('POST', '/api/acp/session/delete', { body: { sessionId: 'nope' } }));
  at('session config unknown', await ctx.call('POST', '/api/acp/config', { body: { sessionId: 'nope' } }));
  at('GET session unknown', await ctx.call('GET', '/api/acp/session/nope'));
  at('GET stream unknown', await ctx.call('GET', '/api/acp/stream/nope', { headers: { accept: 'text/event-stream' } }));
  at('GET stream without accept', await ctx.call('GET', '/api/acp/stream/nope'));
  at('POST stream unknown method', await ctx.call('POST', '/api/acp/stream/nope', { body: {} }));
  at('DELETE stream unknown', await ctx.call('DELETE', '/api/acp/stream/nope'));
  return out;
});

define('http.a2a.cards', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  at('orchestrator card', await ctx.call('GET', '/api/a2a/orchestrator/.well-known/agent-card.json'));
  at('mock agent card', await ctx.call('GET', '/api/a2a/agents/mock/.well-known/agent-card.json'));
  at('unknown agent card', await ctx.call('GET', '/api/a2a/agents/nope/.well-known/agent-card.json'));
  at('card without token', await ctx.call('GET', '/api/a2a/orchestrator/.well-known/agent-card.json', { token: false }));
  return out;
});

define('http.a2a.rpc', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  const version = { 'A2A-Version': '1.0' };
  const rpc = (body, headers = version) => ctx.call('POST', '/api/a2a/orchestrator/', { body, headers });
  at('malformed json', await ctx.call('POST', '/api/a2a/orchestrator/', { rawBody: 'not json', headers: version }));
  at('no version header', await rpc({ jsonrpc: '2.0', id: 'v1', method: 'GetTask', params: { id: 'nope' } }, {}));
  at(
    'legacy version',
    await rpc({ jsonrpc: '2.0', id: 'v2', method: 'GetTask', params: { id: 'nope' } }, { 'A2A-Version': '0.3' }),
  );
  at('jsonrpc 1.0', await rpc({ jsonrpc: '1.0', id: 'r0', method: 'GetTask', params: { id: 'nope' } }));
  at('missing method', await rpc({ jsonrpc: '2.0', id: 'r1' }));
  at('unknown method', await rpc({ jsonrpc: '2.0', id: 'r2', method: 'Nope', params: {} }));
  at('GetTask unknown', await rpc({ jsonrpc: '2.0', id: 'r3', method: 'GetTask', params: { id: 'nope' } }));
  at('GetTask no id', await rpc({ jsonrpc: '2.0', id: 'r3b', method: 'GetTask', params: {} }));
  at('CancelTask unknown', await rpc({ jsonrpc: '2.0', id: 'r4', method: 'CancelTask', params: { id: 'nope' } }));
  at('CancelTask no id', await rpc({ jsonrpc: '2.0', id: 'r4b', method: 'CancelTask', params: {} }));
  at('SubscribeToTask unknown', await rpc({ jsonrpc: '2.0', id: 'r5', method: 'SubscribeToTask', params: { id: 'nope' } }));
  at('GetExtendedAgentCard', await rpc({ jsonrpc: '2.0', id: 'r5b', method: 'GetExtendedAgentCard', params: {} }));
  at('SendMessage no message', await rpc({ jsonrpc: '2.0', id: 'r6', method: 'SendMessage', params: {} }));
  at(
    'SendMessage no messageId',
    await rpc({ jsonrpc: '2.0', id: 'r6b', method: 'SendMessage', params: { message: {} } }),
  );
  at(
    'SendMessage bad params',
    await rpc({ jsonrpc: '2.0', id: 'r6c', method: 'SendMessage', params: [] }),
  );
  at(
    'agent rpc unknown agent',
    await ctx.call('POST', '/api/a2a/agents/nope/', {
      body: { jsonrpc: '2.0', id: 'r7', method: 'GetTask', params: { id: 'x' } },
      headers: version,
    }),
  );
  return out;
});

define('http.a2a.collab.validation', 'http', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  at('create without body', await ctx.call('POST', '/api/a2a/collab/spaces', { body: {} }));
  at('create without cwd', await ctx.call('POST', '/api/a2a/collab/spaces', { body: { participants: [{ id: 'p1', agentId: 'mock' }] } }));
  at('create without participants', await ctx.call('POST', '/api/a2a/collab/spaces', { body: { cwd: ctx.workspace } }));
  at(
    'create empty participants',
    await ctx.call('POST', '/api/a2a/collab/spaces', { body: { cwd: ctx.workspace, participants: [] } }),
  );
  at(
    'create unknown agent',
    await ctx.call('POST', '/api/a2a/collab/spaces', {
      body: { cwd: ctx.workspace, participants: [{ id: 'p1', agentId: 'nope' }] },
    }),
  );
  at(
    'create duplicate participant',
    await ctx.call('POST', '/api/a2a/collab/spaces', {
      body: {
        cwd: ctx.workspace,
        participants: [
          { id: 'p1', agentId: 'mock' },
          { id: 'p1', agentId: 'mock' },
        ],
      },
    }),
  );
  at('delete unknown space', await ctx.call('DELETE', '/api/a2a/collab/spaces/nope'));
  return out;
});

/* ----------------------------------- ws ----------------------------------- */

define('ws.terminal', 'ws', async (ctx) => {
  const marker = 'PARITY_TERMINAL_MARKER';
  const socket = await ctx.connectWs(`/ws/terminal?token=${encodeURIComponent(ctx.token)}`);
  const out = [];
  // A real terminal answers PowerShell's cursor-position query; without the
  // reply PSReadLine blocks and never renders a prompt.
  const answerCursorQuery = (frame) => {
    if (frame?.text.includes('\u001b[6n')) socket.send('\u001b[1;1R');
  };
  try {
    socket.send({ type: 'pty', cols: 80, rows: 24, cwd: ctx.workspace });
    const banner = await socket.next(10000);
    answerCursorQuery(banner);
    out.push(ctx.note('banner received', Boolean(banner)));
    out.push(ctx.note('first frame kind', banner?.kind ?? 'none'));
    socket.send(`echo ${marker}\r`);
    let sawMarker = false;
    let markerKind = null;
    for (let i = 0; i < 40 && !sawMarker; i++) {
      const frame = await socket.next(2000);
      if (!frame) break;
      answerCursorQuery(frame);
      if (frame.text.includes(marker)) {
        sawMarker = true;
        markerKind = frame.kind;
      }
    }
    out.push(ctx.note('echo received', sawMarker));
    out.push(ctx.note('frame kind', markerKind));
  } finally {
    socket.close();
  }
  return out;
});

define('ws.file-watch', 'ws', async (ctx) => {
  const target = join(ctx.workspace, 'watched.txt');
  writeFileSync(target, 'before\n');
  const socket = await ctx.connectWs(`/ws/file-watch?token=${encodeURIComponent(ctx.token)}`);
  const out = [];
  try {
    socket.send({ type: 'file-watch-start', path: ctx.workspace, requestId: 'watch-1' });
    await new Promise((ok) => setTimeout(ok, 400));
    writeFileSync(target, 'after\n');
    const frame = await socket.next(8000);
    let message = null;
    try {
      message = frame ? JSON.parse(frame.text) : null;
    } catch {
      message = { raw: frame?.text ?? null };
    }
    out.push(ctx.note('event', message));
    socket.send({ type: 'file-watch-stop', path: ctx.workspace });
  } finally {
    socket.close();
  }
  return out;
});

/* ---------------------------------- acp ----------------------------------- */

function summarizeEvents(events, instance) {
  return events.map((event) => {
    const data = event.data;
    if (data && typeof data === 'object') {
      return { event: event.event ?? null, type: data.type ?? null, payload: instance.norm(data.payload ?? null) };
    }
    return { event: event.event ?? null, data: instance.norm(data ?? null) };
  });
}

define('acp.session.flow', 'acp', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  const cwd = ctx.workspace;

  at('create', await ctx.call('POST', '/api/acp/session/create', { body: { agentId: 'mock', cwd } }));
  const sessionId = 'mock-session';
  at('list', await ctx.call('POST', '/api/acp/session/list', { body: { agentId: 'mock', cwd } }));
  at('status', await ctx.call('GET', '/api/acp/status'));

  const stream = await ctx.openSse(`/api/acp/stream/${sessionId}`, { headers: { 'X-Client-Id': 'parity' } });
  if (stream.status !== 200) {
    at('GET stream', stream);
    return out;
  }
  const handshake = await stream.collectUntil((event) => event.data?.type === 'status', 8000);
  out.push(ctx.note('handshake', summarizeEvents(handshake, ctx)));
  const connected = handshake.find((event) => event.data?.type === 'connected');
  const epoch = connected?.data?.payload?.epoch;

  at(
    'prompt',
    await ctx.call('POST', `/api/acp/stream/${sessionId}`, {
      body: { id: 'p1', method: 'prompt', params: { content: [{ type: 'text', text: 'hello' }] } },
    }),
  );
  const turn = await stream.collectUntil((event) => event.data?.type === 'prompt_complete', 15000);
  out.push(ctx.note('prompt events', summarizeEvents(turn, ctx)));

  at('session status', await ctx.call('GET', `/api/acp/session/${sessionId}`));
  const activity = await ctx.openSse('/api/acp/sessions/events');
  out.push({ label: 'activity stream', value: { status: activity.status } });
  activity.close();

  at(
    'permission prompt',
    await ctx.call('POST', `/api/acp/stream/${sessionId}`, {
      body: { id: 'p2', method: 'prompt', params: { content: [{ type: 'text', text: 'permission please' }] } },
    }),
  );
  const permissionEvents = await stream.collectUntil((event) => event.data?.type === 'permission_request', 15000);
  out.push(ctx.note('permission events', summarizeEvents(permissionEvents, ctx)));
  const request = permissionEvents.find((event) => event.data?.type === 'permission_request');
  const requestId = request?.data?.payload?.requestId;
  out.push(ctx.note('permission request has id', typeof requestId === 'string' && requestId.length > 0));
  at(
    'permission answer',
    await ctx.call('POST', `/api/acp/stream/${sessionId}`, {
      body: {
        id: 'p3',
        method: 'permission',
        params: { requestId, outcome: { outcome: 'selected', optionId: 'allow' } },
      },
    }),
  );
  const permissionTurn = await stream.collectUntil((event) => event.data?.type === 'prompt_complete', 15000);
  out.push(ctx.note('permission turn', summarizeEvents(permissionTurn, ctx)));

  at(
    'slow prompt',
    await ctx.call('POST', `/api/acp/stream/${sessionId}`, {
      body: { id: 'p4', method: 'prompt', params: { content: [{ type: 'text', text: 'slow request' }] } },
    }),
  );
  const slowEvents = await stream.collectUntil((event) => event.data?.type === 'prompt_processing', 10000);
  out.push(ctx.note('slow events', summarizeEvents(slowEvents, ctx)));
  at('cancel', await ctx.call('POST', `/api/acp/stream/${sessionId}`, { body: { id: 'p5', method: 'cancel', params: {} } }));
  const cancelled = await stream.collectUntil((event) => event.data?.type === 'cancel_complete', 15000);
  out.push(ctx.note('cancel events', summarizeEvents(cancelled, ctx)));

  out.push(ctx.note('epoch', epoch ?? null));
  stream.close();
  await new Promise((ok) => setTimeout(ok, 200));
  // Release as the same client: the stream endpoint checks `X-Client-Id`
  // against the epoch from the `connected` event.
  at(
    'release stream',
    await ctx.call('DELETE', `/api/acp/stream/${sessionId}`, {
      headers: {
        'X-Client-Id': 'parity',
        ...(epoch === undefined ? {} : { 'X-Epoch': String(epoch) }),
      },
    }),
  );
  at('delete session', await ctx.call('DELETE', `/api/acp/session/${sessionId}`));
  at('session after delete', await ctx.call('GET', `/api/acp/session/${sessionId}`));
  return out;
});

define('acp.a2a.space', 'acp', async (ctx) => {
  const out = [];
  const at = (label, res) => out.push(ctx.step(label, res));
  const created = await ctx.call('POST', '/api/a2a/collab/spaces', {
    body: { cwd: ctx.workspace, participants: [{ id: 'p1', agentId: 'mock' }] },
  });
  at('create space', created);
  const spaceId = created.body?.spaceId;
  out.push(ctx.note('space id is a string', typeof spaceId === 'string' && spaceId.length > 0));
  at('orchestrator card', await ctx.call('GET', '/api/a2a/orchestrator/.well-known/agent-card.json'));
  at('space GetTask unknown', await ctx.call('POST', '/api/a2a/orchestrator/', {
    body: { jsonrpc: '2.0', id: 's1', method: 'GetTask', params: { id: 'nope' } },
    headers: { 'A2A-Version': '1.0' },
  }));
  at('delete space', await ctx.call('DELETE', `/api/a2a/collab/spaces/${spaceId}`));
  at('delete space again', await ctx.call('DELETE', `/api/a2a/collab/spaces/${spaceId}`));
  at('session list after space', await ctx.call('POST', '/api/acp/session/list', { body: { agentId: 'mock', cwd: ctx.workspace } }));
  return out;
});

/* -------------------------------------------------------------------------- */
/* Diff                                                                       */
/* -------------------------------------------------------------------------- */

function formatValue(value) {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

function diff(expected, actual, path = '$', out = []) {
  if (Object.is(expected, actual)) return out;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) out.push(`${path}.length: ${expected.length} (legacy) !== ${actual.length} (rust)`);
    const shared = Math.min(expected.length, actual.length);
    for (let i = 0; i < shared; i++) diff(expected[i], actual[i], `${path}[${i}]`, out);
    return out;
  }
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      if (!(key in expected)) {
        out.push(`${path}.${key}: only in rust (${formatValue(actual[key])})`);
        continue;
      }
      if (!(key in actual)) {
        out.push(`${path}.${key}: only in legacy (${formatValue(expected[key])})`);
        continue;
      }
      diff(expected[key], actual[key], `${path}.${key}`, out);
    }
    return out;
  }
  out.push(`${path}: legacy ${formatValue(expected)} !== rust ${formatValue(actual)}`);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                     */
/* -------------------------------------------------------------------------- */

function pick(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function runCase(instance, testCase) {
  const ctx = instance;
  try {
    const transcript = await testCase.run(ctx);
    // Key by label so diffs name the step, not its position.
    const keyed = {};
    for (const entry of transcript ?? []) keyed[entry.label] = pick(entry);
    return { ok: true, transcript: keyed };
  } catch (error) {
    return { ok: false, transcript: null, error: error?.stack ?? String(error) };
  }
}

function printTranscript(title, transcript) {
  console.log(`  ${title}:`);
  for (const [label, entry] of Object.entries(transcript ?? {})) {
    console.log(`    ${label}: ${JSON.stringify(entry)}`);
  }
}

function runCommand(command, args, options = {}) {
  // On Windows the package managers are `.cmd` shims, which `spawn` refuses to
  // execute without a shell; hand them to `cmd.exe` explicitly.
  const [executable, argv] =
    process.platform === 'win32' && command === 'pnpm'
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/c', command, ...args]]
      : [command, args];
  return new Promise((ok, bad) => {
    const child = spawn(executable, argv, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    child.once('error', bad);
    child.once('exit', (code) => (code === 0 ? ok() : bad(new Error(`${command} ${args.join(' ')} exited with ${code}`))));
  });
}

async function ensureLegacyBuild(enabled) {
  const entry = join(repoRoot, 'packages', 'server-legacy', 'dist', 'index.js');
  if (existsSync(entry)) return entry;
  if (!enabled) fail(`missing ${entry} (run without --no-build)`);
  console.log('[parity] building legacy TypeScript server...');
  await runCommand('pnpm', ['--filter', '@julyware/clover-server', 'build']);
  if (!existsSync(entry)) fail(`legacy build did not produce ${entry}`);
  return entry;
}

async function ensureRustBinary(enabled) {
  const binary = join(repoRoot, 'target', 'debug', `${process.platform === 'win32' ? 'clover.exe' : 'clover'}`);
  if (!enabled) {
    if (!existsSync(binary)) fail(`missing ${binary} (run without --no-build)`);
    return binary;
  }
  console.log('[parity] building clover-server...');
  await runCommand('cargo', ['build', '-p', 'clover-server']);
  if (!existsSync(binary)) fail(`cargo build did not produce ${binary}`);
  return binary;
}

function startServer(entry, args, { env, logFile }) {
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, `\n=== parity run ${new Date().toISOString()} ===\n`);
  const child = spawn(entry, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const write = (chunk) => appendFileSync(logFile, chunk);
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  return child;
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    child.once('exit', finish);
    child.once('error', finish);
    if (process.platform === 'win32') {
      // `/T` also reaps the agents/shells the server spawned.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', () => child.kill());
    } else {
      child.kill('SIGTERM');
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const selected = cases.filter(
    (testCase) =>
      opts.stages.has(testCase.stage) &&
      (opts.only.length === 0 || opts.only.some((text) => testCase.name.includes(text))),
  );

  if (opts.list) {
    for (const testCase of cases) console.log(`${testCase.stage.padEnd(4)} ${testCase.name}`);
    return 0;
  }
  if (!selected.length) fail('no cases selected');

  const acpNeeded = selected.some((testCase) => testCase.stage === 'acp');
  if (acpNeeded) {
    const probe = spawn(process.execPath, ['--version'], { stdio: 'ignore' });
    const okNode = await new Promise((resolveProbe) => probe.once('exit', (code) => resolveProbe(code === 0)));
    if (!okNode) fail('the acp stage needs node on PATH');
  }

  const legacyEntry = await ensureLegacyBuild(opts.build);
  const rustBinary = await ensureRustBinary(opts.build);

  const tempRoot = mkdtempSync(join(tempParent(), 'run-'));
  const layout = {
    tsHome: join(tempRoot, 'ts', 'home'),
    rustHome: join(tempRoot, 'rust', 'home'),
    tsWorkspace: join(tempRoot, 'ts', 'workspace'),
    rustWorkspace: join(tempRoot, 'rust', 'workspace'),
  };
  seedHome(layout.tsHome);
  seedHome(layout.rustHome);
  seedWorkspace(layout.tsWorkspace);
  seedWorkspace(layout.rustWorkspace);

  const tsPort = await freePort();
  const rustPort = await freePort();
  const sharedEnv = {
    PARITY_TOKEN: 'expanded-token',
    CLOVER_TOKEN_SECRET: SECRET,
    CLOVER_READONLY: 'false',
  };
  const logs = {
    ts: join(tempRoot, 'legacy.log'),
    rust: join(tempRoot, 'rust.log'),
  };

  console.log(`[parity] temp dir: ${tempRoot}`);
  console.log(`[parity] legacy: http://127.0.0.1:${tsPort}  rust: http://127.0.0.1:${rustPort}`);
  console.log(`[parity] ${selected.length} case(s): ${STAGES.map((stage) => `${stage}=${selected.filter((c) => c.stage === stage).length}`).join(' ')}`);

  const legacy = startServer(process.execPath, [join(repoRoot, 'scripts', 'parity', 'ts-server.mjs'), String(tsPort), legacyEntry], {
    env: {
      ...process.env,
      ...sharedEnv,
      USERPROFILE: layout.tsHome,
      HOME: layout.tsHome,
    },
    logFile: logs.ts,
  });
  const rust = startServer(rustBinary, ['serve', '-p', String(rustPort), '--static-dir', join(tempRoot, 'no-static')], {
    env: {
      ...process.env,
      ...sharedEnv,
      PORT: String(rustPort),
      CLOVER_STATE_DIR: join(layout.rustHome, '.clover'),
      CLOVER_HOME_DIR: layout.rustHome,
      CLOVER_LOG_TO_FILE: 'false',
      RUST_LOG: 'warn',
    },
    logFile: logs.rust,
  });

  const legacyInstance = new ServerInstance({
    name: 'legacy',
    baseUrl: `http://127.0.0.1:${tsPort}`,
    port: tsPort,
    home: layout.tsHome,
    workspace: layout.tsWorkspace,
    timeout: opts.timeout,
  });
  const rustInstance = new ServerInstance({
    name: 'rust',
    baseUrl: `http://127.0.0.1:${rustPort}`,
    port: rustPort,
    home: layout.rustHome,
    workspace: layout.rustWorkspace,
    timeout: opts.timeout,
  });

  let failures = 0;
  let completed = false;
  try {
    await Promise.all([
      waitForHttp(`${legacyInstance.baseUrl}/api/local/health`, 120000),
      waitForHttp(`${rustInstance.baseUrl}/api/local/health`, 120000),
    ]).catch((error) => fail(`${error.message}\n  legacy log: ${logs.ts}\n  rust log: ${logs.rust}`));
    await Promise.all([legacyInstance.mintToken(), rustInstance.mintToken()]);

    for (const testCase of selected) {
      const left = await runCase(legacyInstance, testCase);
      const right = await runCase(rustInstance, testCase);
      if (!left.ok || !right.ok) {
        failures++;
        console.log(`✗ ${testCase.name} (threw)`);
        if (!left.ok) console.log(`  legacy: ${left.error}`);
        if (!right.ok) console.log(`  rust: ${right.error}`);
        continue;
      }
      const differences = diff(left.transcript, right.transcript);
      const accepted = differences.filter((line) =>
        ACCEPTED.some(
          (entry) =>
            entry.case === testCase.name &&
            (line.includes(entry.path) || entry.path === '*'),
        ),
      );
      const blocking = differences.filter((line) => !accepted.includes(line));
      if (!blocking.length) {
        const suffix = accepted.length ? ` (${accepted.length} accepted divergence)` : '';
        console.log(`✓ ${testCase.name}${suffix}`);
        continue;
      }
      failures++;
      console.log(`✗ ${testCase.name} (${blocking.length} difference(s))`);
      for (const line of blocking.slice(0, 40)) console.log(`    ${line}`);
      if (blocking.length > 40) console.log(`    … ${blocking.length - 40} more`);
      if (opts.verbose) {
        printTranscript('legacy', left.transcript);
        printTranscript('rust', right.transcript);
      }
    }
    completed = true;
  } finally {
    await Promise.all([killTree(legacy), killTree(rust)]);
    // Keep the sandbox (and its server logs) when something failed, so the
    // reported paths still exist.
    if (!opts.keep && completed && failures === 0) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }

  console.log('');
  if (failures) {
    console.log(`[parity] FAILED: ${failures}/${selected.length} case(s) differ`);
    console.log(`[parity] logs: ${logs.ts}  ${logs.rust}`);
    console.log(`[parity] sandbox kept: ${tempRoot}`);
    return 1;
  }
  console.log(`[parity] OK: ${selected.length}/${selected.length} case(s) match`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(`[parity] ${error?.stack ?? error}`);
    process.exit(2);
  });