#!/usr/bin/env node
'use strict';

// Thin launcher for the native `clover` binary.
//
// The binaries live in per-platform npm packages (`@julyware/clover-cli-*`)
// declared as optionalDependencies, so a normal install only downloads the
// binary for the current machine. This file stays dependency-free and works on
// every Node version the package supports.

const os = require('node:os');
const { spawn } = require('node:child_process');
const { constants } = os;

const PACKAGE_PREFIX = '@julyware/clover-cli';

// Mirrors the platform ids used by scripts/build-npm.mjs.
function platformId() {
  let libc = '';
  if (process.platform === 'linux') {
    const report =
      typeof process.report?.getReport === 'function' ? process.report.getReport() : null;
    libc = report?.header?.glibcVersionRuntime ? '-gnu' : '-musl';
  }
  return `${process.platform}-${process.arch}${libc}`;
}

function resolveBinary() {
  if (process.env.CLOVER_CLI_BIN) {
    return process.env.CLOVER_CLI_BIN;
  }

  const exe = process.platform === 'win32' ? 'clover.exe' : 'clover';
  const packageName = `${PACKAGE_PREFIX}-${platformId()}`;

  try {
    return require.resolve(`${packageName}/bin/${exe}`);
  } catch {
    process.stderr.write(
      `clover: no prebuilt binary is installed for ${platformId()}.\n` +
        `Expected the optional dependency "${packageName}" to be present.\n` +
        `Reinstall @julyware/clover-cli, or point CLOVER_CLI_BIN at a clover executable.\n`,
    );
    process.exit(1);
  }
}

const child = spawn(resolveBinary(), process.argv.slice(2), { stdio: 'inherit' });

child.on('error', (error) => {
  process.stderr.write(`clover: failed to start the binary: ${error.message}\n`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(128 + (constants.signals[signal] ?? 0));
  }
  process.exit(code ?? 1);
});