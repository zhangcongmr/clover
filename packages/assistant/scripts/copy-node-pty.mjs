import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const sourcePackageJsonPath = require.resolve('node-pty/package.json');
const sourceRoot = path.dirname(sourcePackageJsonPath);
const targetRoot = path.join(packageRoot, 'dist', 'clover');

function copyNodePty(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`node-pty source not found: ${src}`);
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === 'prebuilds') {
      continue;
    }

    entry.isDirectory() ? copyNodePty(srcPath, destPath) : fs.copyFileSync(srcPath, destPath);
  }

  const prebuildsSrc = path.join(src, 'prebuilds');
  const packagePrebuildsDest = path.join(dest, 'prebuilds');
  if (!fs.existsSync(prebuildsSrc)) {
    return;
  }

  fs.mkdirSync(packagePrebuildsDest, { recursive: true });

  const platform = process.platform;
  const arch = process.arch;
  const prebuildDirs = fs.readdirSync(prebuildsSrc, { withFileTypes: true });
  let matched = false;
  for (const dirEntry of prebuildDirs) {
    if (!dirEntry.isDirectory()) continue;
    const dirName = dirEntry.name;

    if (dirName.startsWith(platform) && dirName.includes(arch)) {
      const fromDir = path.join(prebuildsSrc, dirName);
      const toDir = path.join(packagePrebuildsDest, dirName);
      console.log(`Copying node-pty prebuild for ${platform} ${arch}: ${dirName}`);
      fs.cpSync(fromDir, toDir, { recursive: true });

      matched = true;
    }
  }

  if (!matched) {
    console.warn(`No exact prebuild found for ${platform} ${arch}, copying all prebuilds as fallback.`);
    fs.cpSync(prebuildsSrc, packagePrebuildsDest, { recursive: true });
  }
}

const targetNodePtyRoot = path.join(targetRoot, 'node_modules', 'node-pty');
console.log(`Copying node-pty from ${sourceRoot} to ${targetNodePtyRoot}`);
copyNodePty(sourceRoot, targetNodePtyRoot);
console.log('node-pty copied successfully.');
