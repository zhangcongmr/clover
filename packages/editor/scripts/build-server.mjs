import {
  cpSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// esbuild is a transitive dep of tsup, resolve it from the pnpm store
const esbuildFile = resolve(
  rootDir, '../..', 'node_modules', '.pnpm',
  'esbuild@0.27.4', 'node_modules', 'esbuild', 'lib', 'main.js'
);

const { build } = await import(pathToFileURL(esbuildFile).href);

await build({
  entryPoints: [resolve(rootDir, 'src/server/server.ts')],
  outfile: resolve(rootDir, 'dist-server/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['vite', 'node-pty'],
  define: { isProdBuild: 'true' },
  sourcemap: true,
  banner: {
    js: [
      `import { createRequire as __cr } from 'node:module';`,
      `import { fileURLToPath as __ftp } from 'node:url';`,
      `var require = __cr(__ftp(import.meta.url));`,
    ].join('\n'),
  },
});

const serverSize = statSync(resolve(rootDir, 'dist-server/server.js')).size;
console.log(`[build-server] dist-server/server.js (${(serverSize / 1024).toFixed(1)} KB)`);

// Copy frontend assets into dist-server so the entire deploy is one directory
const distFrom = resolve(rootDir, 'dist');
const distTo = resolve(rootDir, 'dist-server/dist');
if (existsSync(distFrom)) {
  cpSync(distFrom, distTo, { recursive: true, force: true });
  console.log(`[build-server] assets copied: ${distFrom} -> ${distTo}`);
} else {
  console.warn(`[build-server] assets not found: ${distFrom} - skipping copy`);
}

// Copy node-pty (native addon) into dist-server/node_modules
function copyDir(src, dest, filter) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (filter && !filter(entry.name)) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    entry.isDirectory() ? copyDir(s, d, filter) : copyFileSync(s, d);
  }
}

const nodePtySource = resolve(
  rootDir, '..', '..', 'node_modules', '.pnpm',
  'node-pty@1.2.0-beta.14', 'node_modules', 'node-pty'
);
const nodePtyTarget = resolve(rootDir, 'dist-server/node_modules/node-pty');
if (existsSync(nodePtySource)) {
  rmSync(nodePtyTarget, { recursive: true, force: true });
  copyDir(nodePtySource, nodePtyTarget, (name) => name !== 'prebuilds');
  // Copy only the current platform's prebuild
  const platform = process.platform;
  const arch = process.arch;
  const prebuildsSrc = join(nodePtySource, 'prebuilds');
  const prebuildsDest = join(nodePtyTarget, 'prebuilds');
  if (existsSync(prebuildsSrc)) {
    mkdirSync(prebuildsDest, { recursive: true });
    for (const entry of readdirSync(prebuildsSrc, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(platform) && entry.name.includes(arch)) {
        copyDir(join(prebuildsSrc, entry.name), join(prebuildsDest, entry.name));
      }
    }
  }
  console.log(`[build-server] node-pty copied to ${nodePtyTarget}`);
} else {
  console.warn(`[build-server] node-pty source not found: ${nodePtySource}`);
}

// Copy node-addon-api (node-pty dependency)
const napiSource = resolve(
  rootDir, '..', '..', 'node_modules', '.pnpm',
  'node-addon-api@7.1.1', 'node_modules', 'node-addon-api'
);
const napiTarget = resolve(rootDir, 'dist-server/node_modules/node-addon-api');
if (existsSync(napiSource)) {
  rmSync(napiTarget, { recursive: true, force: true });
  copyDir(napiSource, napiTarget);
  console.log(`[build-server] node-addon-api copied to ${napiTarget}`);
}

// Generate dist-server/package.json for proper ESM module resolution
const pkgJson = {
  name: 'editor-server',
  private: true,
  type: 'module',
};
const pkgPath = resolve(rootDir, 'dist-server/package.json');
writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');
console.log(`[build-server] package.json generated at ${pkgPath}`);
