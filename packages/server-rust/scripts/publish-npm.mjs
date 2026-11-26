#!/usr/bin/env node
// Publishes the Clover CLI npm packages built by scripts/build-npm.mjs.
//
// Platform packages are published first, then the root `@julyware/clover-cli`
// package whose optionalDependencies point at them. Publishing out of order
// would briefly expose a root package with missing binaries.
//
// The committed root manifest has no optionalDependencies: `packages/server-rust`
// is a pnpm workspace member, and the platform packages only exist after a
// build. They are injected into the manifest for the duration of the root
// publish and restored afterwards, so `pnpm install` and `pnpm-lock.yaml` never
// see them.
//
// The version is whatever `packages/server-rust/package.json` says; changesets
// owns it like every other `@julyware/*` package. There is no override on
// purpose, and CI rejects a `clover-cli-v*` tag that does not match it.
//
// Usage:
//   node scripts/publish-npm.mjs                      # publish current version
//   node scripts/publish-npm.mjs --dry-run            # pack without uploading
//   node scripts/publish-npm.mjs --tag next           # publish under a dist-tag
//   node scripts/publish-npm.mjs --allow-partial      # publish a subset of platforms
//
// CI sets NODE_AUTH_TOKEN (see .github/workflows/publish-clover-cli.yml).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  PACKAGE_DIR,
  PACKAGE_PREFIX,
  ROOT_MANIFEST_PATH,
  SEMVER_PATTERN,
  listPlatformPackages,
  readJson,
} from './manifest.mjs';

const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const GUARD_SCRIPT = join(REPO_ROOT, 'scripts/guard-publish.mjs');

// Platform packages the release workflow builds. Publishing the root package
// without all of these would ship a package that cannot install everywhere.
const REQUIRED_PLATFORMS = [
  'win32-x64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64-gnu',
  'linux-arm64-gnu',
];

function fail(message) {
  process.stderr.write(`[publish-npm] ${message}\n`);
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

function quoteWindowsArg(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// pnpm publishes the package in the given directory, so every package is
// published from its own cwd (the same command release.mjs uses for the JS
// packages). `--no-git-checks` is required because releases run from a detached
// tag checkout and from a working tree that still has the version bump.
function pnpm(args, { cwd, dryRun }) {
  const argv = dryRun ? [...args, '--dry-run'] : args;
  process.stdout.write(`[publish-npm] (${cwd}) pnpm ${argv.join(' ')}\n`);
  if (process.platform === 'win32') {
    // pnpm resolves to pnpm.cmd on Windows, which only runs through cmd.exe.
    const line = ['pnpm.cmd', ...argv].map(quoteWindowsArg).join(' ');
    execSync(line, { stdio: 'inherit', cwd });
    return;
  }
  execFileSync('pnpm', argv, { stdio: 'inherit', cwd });
}

// The platform dependencies only exist once `build-npm.mjs` has run, so they
// live in the published manifest, not in the committed one.
function publishRoot({ version, platforms, tag, dryRun }) {
  const original = readFileSync(ROOT_MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(original);
  manifest.optionalDependencies = {
    ...(manifest.optionalDependencies ?? {}),
    ...Object.fromEntries(
      platforms.map((platform) => [`${PACKAGE_PREFIX}-${platform.id}`, version]),
    ),
  };
  writeFileSync(ROOT_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  try {
    pnpm(
      ['publish', '--access', 'public', '--tag', tag, '--no-git-checks', '--ignore-scripts'],
      { cwd: PACKAGE_DIR, dryRun },
    );
  } finally {
    writeFileSync(ROOT_MANIFEST_PATH, original);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/publish-npm.mjs [--tag <dist-tag>] ' +
        '[--dry-run] [--allow-partial] [--no-guard]\n',
    );
    return;
  }

  const dryRun = args['dry-run'] === true;
  const tag = String(args.tag ?? 'latest');
  const version = readJson(ROOT_MANIFEST_PATH).version;

  if (!SEMVER_PATTERN.test(String(version))) {
    fail(`invalid version "${version}" in ${ROOT_MANIFEST_PATH}`);
  }

  const platforms = listPlatformPackages();
  if (platforms.length === 0) {
    fail('no platform packages found in npm/; run scripts/build-npm.mjs first');
  }

  if (!args['allow-partial']) {
    const missing = REQUIRED_PLATFORMS.filter(
      (id) => !platforms.some((platform) => platform.id === id),
    );
    if (missing.length > 0) {
      fail(
        `missing platform packages: ${missing.join(', ')}.\n` +
          'Build them (scripts/build-npm.mjs --target <triple>) or pass --allow-partial ' +
          'when intentionally publishing a subset.',
      );
    }
  }

  for (const platform of platforms) {
    if (platform.manifest.version !== version) {
      fail(
        `${platform.id} was built for ${platform.manifest.version}, expected ${version}. ` +
          'Rebuild it with scripts/build-npm.mjs.',
      );
    }

    const binary = ['clover', 'clover.exe']
      .map((name) => join(platform.dir, 'bin', name))
      .find((candidate) => existsSync(candidate));
    if (!binary) {
      fail(`${platform.id} has no binary under ${join(platform.dir, 'bin')}`);
    }
  }

  if (!dryRun && !args['no-guard']) {
    execFileSync(process.execPath, [GUARD_SCRIPT], { stdio: 'inherit' });
  }

  // Platform packages first, root package last.
  for (const platform of platforms) {
    pnpm(['publish', '--access', 'public', '--tag', tag, '--no-git-checks'], {
      cwd: platform.dir,
      dryRun,
    });
  }
  publishRoot({ version, platforms, tag, dryRun });

  process.stdout.write(
    `[publish-npm] ${dryRun ? 'dry run finished' : 'published'} ${PACKAGE_PREFIX}@${version} ` +
      `(${platforms.map((platform) => platform.id).join(', ')})\n`,
  );
}

main();