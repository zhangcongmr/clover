#!/usr/bin/env node
// Keeps the Cargo workspace version aligned with the npm release version.
//
// `clover --version` is clap's built-in version flag, which prints
// CARGO_PKG_VERSION baked in at compile time. changesets only bumps the npm
// package.json files, so without this step the published npm package and the
// binary inside it report different versions.
//
// Runs automatically after `changeset version` (see scripts/release.mjs and the
// `version-packages` script). Can also be run manually:
//
//   node scripts/sync-cargo-version.mjs          # from packages/server-rust/package.json
//   node scripts/sync-cargo-version.mjs 1.0.1    # explicit version
//   node scripts/sync-cargo-version.mjs --check  # verify only (used by CI)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARGO_MANIFEST = join(REPO_ROOT, 'Cargo.toml');
const CLI_MANIFEST = join(REPO_ROOT, 'packages/server-rust/package.json');
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  process.stderr.write(`[sync-cargo-version] ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const version =
  args.find((arg) => !arg.startsWith('--')) ??
  JSON.parse(readFileSync(CLI_MANIFEST, 'utf8')).version;

if (!VERSION_PATTERN.test(version)) {
  fail(`invalid version "${version}"`);
}

const toml = readFileSync(CARGO_MANIFEST, 'utf8');
const pattern = /(\[workspace\.package\][^[]*?\nversion\s*=\s*")([^"]*)(")/;
const match = toml.match(pattern);

if (!match) {
  fail('could not find `version = "..."` in the [workspace.package] section of Cargo.toml');
}

if (match[2] === version) {
  process.stdout.write(`[sync-cargo-version] Cargo workspace version is already ${version}\n`);
  process.exit(0);
}

if (checkOnly) {
  fail(
    `Cargo workspace version is ${match[2]}, expected ${version} ` +
      '(run `pnpm release` or `node scripts/sync-cargo-version.mjs`)',
  );
}

writeFileSync(CARGO_MANIFEST, toml.replace(pattern, `$1${version}$3`));
process.stdout.write(`[sync-cargo-version] Cargo workspace version -> ${version}\n`);

// Refresh the tracked Cargo.lock so the workspace member version matches.
// Best effort: a stale lock is harmless for normal (non --locked) builds.
try {
  execFileSync('cargo', ['metadata', '--format-version', '1'], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
} catch (error) {
  process.stderr.write(
    `[sync-cargo-version] warning: could not refresh Cargo.lock (${error.message})\n`,
  );
}