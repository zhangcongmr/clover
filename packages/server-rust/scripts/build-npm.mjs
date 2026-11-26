#!/usr/bin/env node
// Assembles the npm packages for the Rust `clover` CLI.
//
// Layout (the `npm/` directory is generated and git-ignored):
//
//   packages/server-rust/npm/<platform>/package.json
//   packages/server-rust/npm/<platform>/bin/clover[.exe]
//
// The root package (`@julyware/clover-cli`, this directory) only ships the
// `bin/clover.js` launcher and lists the platform packages as
// optionalDependencies, so npm installs just the binary for the current
// platform. Publish everything with `scripts/publish-npm.mjs`.
//
// The binary is built with `--features web-ui`, so `clover serve` hosts the
// Angular UI without any extra files. `scripts/stage-web.mjs` copies the
// production build into `packages/server-rust/web` first; pass
// `--web-prebuilt` in CI to reuse an artifact that was staged in another job.
//
// Usage:
//   node scripts/build-npm.mjs                       # host target, release build
//   node scripts/build-npm.mjs --target <triple>     # cross/native target
//   node scripts/build-npm.mjs --binary <path>       # reuse an existing binary
//   node scripts/build-npm.mjs --version 0.1.6       # override package version
//   node scripts/build-npm.mjs --web-prebuilt        # web/ already staged
//   node scripts/build-npm.mjs --web <dir>           # stage from another dist
//
// Flags can also be passed as `--flag=value`.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_PREFIX = '@julyware/clover-cli';
const REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/zhangcongmr/clover.git',
  directory: 'packages/server-rust',
};

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');

// Rust target triple -> npm platform package metadata.
const TARGETS = {
  'x86_64-pc-windows-msvc': { id: 'win32-x64', os: 'win32', cpu: 'x64', exe: '.exe' },
  'aarch64-pc-windows-msvc': { id: 'win32-arm64', os: 'win32', cpu: 'arm64', exe: '.exe' },
  'x86_64-apple-darwin': { id: 'darwin-x64', os: 'darwin', cpu: 'x64', exe: '' },
  'aarch64-apple-darwin': { id: 'darwin-arm64', os: 'darwin', cpu: 'arm64', exe: '' },
  'x86_64-unknown-linux-gnu': {
    id: 'linux-x64-gnu',
    os: 'linux',
    cpu: 'x64',
    libc: 'glibc',
    exe: '',
  },
  'aarch64-unknown-linux-gnu': {
    id: 'linux-arm64-gnu',
    os: 'linux',
    cpu: 'arm64',
    libc: 'glibc',
    exe: '',
  },
  'x86_64-unknown-linux-musl': {
    id: 'linux-x64-musl',
    os: 'linux',
    cpu: 'x64',
    libc: 'musl',
    exe: '',
  },
  'aarch64-unknown-linux-musl': {
    id: 'linux-arm64-musl',
    os: 'linux',
    cpu: 'arm64',
    libc: 'musl',
    exe: '',
  },
};

function fail(message) {
  process.stderr.write(`[build-npm] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      fail(`unexpected argument: ${arg}`);
    }
    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const key = rawKey.trim();
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index += 1;
      } else {
        value = true;
      }
    }
    args[key] = value;
  }
  return args;
}

function hostTarget() {
  const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith('host: '));
  if (!line) {
    fail('could not determine the host target from `rustc -vV`');
  }
  return line.slice('host: '.length).trim();
}

function readRootPackage() {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
}

function resolveVersion(args, rootPackage) {
  const version = String(args.version ?? process.env.CLOVER_CLI_VERSION ?? rootPackage.version);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid version "${version}" (expected something like 0.1.6 or 0.2.0-beta.1)`);
  }
  return version;
}

function buildBinary(target) {
  const cargoTargetDir = process.env.CARGO_TARGET_DIR
    ? resolve(REPO_ROOT, process.env.CARGO_TARGET_DIR)
    : join(REPO_ROOT, 'target');

  process.stdout.write(
    `[build-npm] cargo build --release -p clover-server --bin clover ` +
      `--features web-ui --target ${target}\n`,
  );
  execFileSync(
    'cargo',
    [
      'build',
      '--release',
      '-p',
      'clover-server',
      '--bin',
      'clover',
      '--features',
      'web-ui',
      '--target',
      target,
    ],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  );

  const binary = join(cargoTargetDir, target, 'release', `clover${TARGETS[target].exe}`);
  if (!existsSync(binary)) {
    fail(`build succeeded but the binary is missing: ${binary}`);
  }
  return binary;
}

/// Copies the Angular build into `web/` unless the caller already staged it.
function stageWeb(args) {
  if (args['web-prebuilt']) {
    const index = join(PACKAGE_DIR, 'web', 'index.html');
    if (!existsSync(index)) {
      fail(`--web-prebuilt was passed but ${index} is missing; run scripts/stage-web.mjs first`);
    }
    process.stdout.write('[build-npm] using pre-staged web assets from packages/server-rust/web\n');
    return;
  }

  const script = join(PACKAGE_DIR, 'scripts', 'stage-web.mjs');
  const stageArgs = [script];
  if (args.web) {
    stageArgs.push('--src', String(args.web));
  }
  execFileSync(process.execPath, stageArgs, { cwd: REPO_ROOT, stdio: 'inherit' });
}

function platformManifest(version, spec) {
  const manifest = {
    name: `${PACKAGE_PREFIX}-${spec.id}`,
    version,
    description: `Clover CLI native binary for ${spec.os}-${spec.cpu}${spec.libc ? ` (${spec.libc})` : ''}`,
    license: 'MIT',
    repository: REPOSITORY,
    os: [spec.os],
    cpu: [spec.cpu],
    files: [`bin/clover${spec.exe}`],
    // pnpm hard-links packages into a store; the launcher spawns the binary
    // directly, so leave it as a real file instead of a symlink.
    preferUnplugged: true,
  };
  if (spec.libc) {
    manifest.libc = [spec.libc];
  }
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/build-npm.mjs [--target <triple>] [--binary <path>] [--version <semver>] [--out <dir>]' +
        ' [--web <dir>] [--web-prebuilt]\n' +
        `Known targets: ${Object.keys(TARGETS).join(', ')}\n`,
    );
    return;
  }

  const target = String(args.target ?? hostTarget());
  const spec = TARGETS[target];
  if (!spec) {
    fail(`unknown target "${target}". Known targets: ${Object.keys(TARGETS).join(', ')}`);
  }

  const rootPackage = readRootPackage();
  const version = resolveVersion(args, rootPackage);

  let binary;
  if (args.binary) {
    binary = isAbsolute(String(args.binary))
      ? String(args.binary)
      : resolve(REPO_ROOT, String(args.binary));
    if (!existsSync(binary)) {
      fail(`--binary points at a missing file: ${binary}`);
    }
  } else {
    stageWeb(args);
    binary = buildBinary(target);
  }

  const outRoot = args.out
    ? resolve(REPO_ROOT, String(args.out))
    : join(PACKAGE_DIR, 'npm');
  const platformDir = join(outRoot, spec.id);
  const binDir = join(platformDir, 'bin');

  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(binDir, { recursive: true });

  const destination = join(binDir, `clover${spec.exe}`);
  copyFileSync(binary, destination);
  try {
    // npm preserves the executable bit on publish; no-op on Windows.
    chmodSync(destination, 0o755);
  } catch {
    /* Windows has no POSIX modes. */
  }

  writeFileSync(
    join(platformDir, 'package.json'),
    `${JSON.stringify(platformManifest(version, spec), null, 2)}\n`,
  );

  const license = join(PACKAGE_DIR, 'LICENSE');
  if (existsSync(license)) {
    copyFileSync(license, join(platformDir, 'LICENSE'));
  }

  process.stdout.write(
    `[build-npm] wrote ${platformDir} (${spec.id}, version ${version}, ` +
      `${(readFileSync(destination).length / 1024 / 1024).toFixed(2)} MiB)\n`,
  );
}

main();