#!/usr/bin/env node

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 当作为 npm 包安装时，从 dist/ 加载编译后的代码
const distPath = resolve(__dirname, '..', 'dist', 'index.js');
await import(distPath);
