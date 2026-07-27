import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from '@luxio/agent';

declare const isProdBuild: boolean | undefined;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isCompiled = isProdBuild === true;
const rootDir = isCompiled ? resolve(__dirname, '..') : resolve(__dirname, '../..');
const distDir = isCompiled ? join(__dirname, 'dist') : join(rootDir, 'dist');
const isDev = !existsSync(join(distDir, 'index.html'));

const app = express();

if (!isProdBuild && isDev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

createServer({
  portEnvKey: 'PORT',
  defaultPort: 5178,
  tokenSecretEnvKey: 'EDITOR_TOKEN_SECRET',
  corsPorts: [5178, 5179, 5173, 4200, 4000],
  rootDir,
  logPrefix: '[Editor Server]',
  staticDir: isDev ? undefined : distDir,
  app,
});

if (!isDev) {
  app.use((_req, res) => {
    res.sendFile(join(distDir, 'index.html'));
  });
}
