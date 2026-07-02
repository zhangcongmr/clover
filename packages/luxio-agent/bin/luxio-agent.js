#!/usr/bin/env node

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 当作为 npm 包安装时，从 dist/ 加载编译后的代码
const distPath = resolve(__dirname, '..', 'dist', 'index.js');
let imported = false;
try {
  // Try to import the dist build first
  await import(pathToFileURL(distPath).href);
  imported = true;
} catch (err) {
  // If dist is missing, fall back to importing TypeScript source via src/index.ts using tsx (dev)
  if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME') {
    const srcPath = resolve(__dirname, '..', 'src', 'index.ts');
    try {
      await import(pathToFileURL(srcPath).href);
      imported = true;
    } catch (err2) {
      // final fallback: rethrow original error for visibility
      throw err;
    }
  } else {
    throw err;
  }
}
if (!imported) {
  throw new Error('[luxio-agent] Failed to import dist or src entrypoint');
}
