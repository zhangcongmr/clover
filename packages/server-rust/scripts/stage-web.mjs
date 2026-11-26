#!/usr/bin/env node
// Stages the built Angular app for the `web-ui` cargo feature.
//
// `rust-embed` reads `packages/server-rust/web` at compile time, so the assets
// must be copied there before `cargo build --features web-ui` (build-npm.mjs
// does it automatically). Source maps are never staged: the production build
// does not emit them, and this filter keeps stray ones out of the binary.
//
// Usage:
//   node scripts/stage-web.mjs
//   node scripts/stage-web.mjs --src packages/assistant/dist/clover/browser
//   node scripts/stage-web.mjs --out /tmp/clover-web

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_DIR, '../..');
const DEFAULT_SOURCE = join(REPO_ROOT, 'packages/assistant/dist/clover/browser');
const DEFAULT_TARGET = join(PACKAGE_DIR, 'web');

function fail(message) {
  process.stderr.write(`[stage-web] ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      fail(`unexpected argument: ${arg}`);
    }
    const [key, inline] = arg.slice(2).split('=', 2);
    const value = inline ?? argv[index + 1];
    if (value === undefined) {
      fail(`missing value for --${key}`);
    }
    if (inline === undefined) {
      index += 1;
    }
    args[key] = value;
  }
  return args;
}

function isMapFile(path) {
  return path.endsWith('.map') || path.endsWith('.DS_Store');
}

function summarize(root) {
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files += 1;
        bytes += statSync(path).size;
      }
    }
  };
  walk(root);
  return { files, bytes };
}

const args = parseArgs(process.argv.slice(2));
const source = args.src ? resolve(REPO_ROOT, args.src) : DEFAULT_SOURCE;
const target = args.out ? resolve(REPO_ROOT, args.out) : DEFAULT_TARGET;

if (!existsSync(join(source, 'index.html'))) {
  fail(
    `no index.html in ${source}\n` +
      '  Build the web app first: pnpm --filter @julyware/clover-ui run build:web',
  );
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

cpSync(source, target, {
  recursive: true,
  filter: (path) => {
    if (statSync(path).isDirectory()) {
      return true;
    }
    return !isMapFile(path);
  },
});

const { files, bytes } = summarize(target);
if (files === 0) {
  fail(`staged no files into ${target}`);
}

process.stdout.write(
  `[stage-web] ${source} -> ${target} (${files} files, ` +
    `${(bytes / 1024 / 1024).toFixed(2)} MiB, source maps excluded)\n`,
);