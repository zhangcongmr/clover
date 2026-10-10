import {
  cpSync, existsSync, mkdirSync, statSync, readdirSync, copyFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Resolve a package directory from the pnpm store, regardless of version
function resolveFromPnpmStore(pkgName) {
  const store = resolve(rootDir, '..', '..', 'node_modules', '.pnpm');
  if (!existsSync(store)) return null;
  const dirs = readdirSync(store)
    .filter((n) => n.startsWith(`${pkgName}@`))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const pkgDir = resolve(store, dir, 'node_modules', pkgName);
    if (existsSync(pkgDir)) return pkgDir;
  }
  return null;
}

// Clean stale artifacts (previous sourcemaps, old copies) so the output is reproducible
const distServerDir = resolve(rootDir, 'dist-server');
rmSync(distServerDir, { recursive: true, force: true });
mkdirSync(distServerDir, { recursive: true });

// esbuild is a transitive dep of tsup; resolve it from tsup's isolated node_modules,
// falling back to a version-agnostic scan of the pnpm store
let esbuild;
try {
  esbuild = createRequire(require.resolve('tsup'))('esbuild');
} catch {
  const esbuildDir = resolveFromPnpmStore('esbuild');
  if (!esbuildDir) throw new Error('esbuild not found (via tsup or in node_modules/.pnpm)');
  const mod = await import(pathToFileURL(join(esbuildDir, 'lib', 'main.js')).href);
  esbuild = mod.build ? mod : mod.default;
}
const { build } = esbuild;

await build({
  entryPoints: [resolve(rootDir, 'src/server.ts')],
  outfile: resolve(rootDir, 'dist-server/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['vite', 'node-pty'],
  define: { isProdBuild: 'true' },
  sourcemap: false,
  banner: {
    js: [
      `#!/usr/bin/env node`,
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

// node-pty is a direct dependency of this package; resolve it via Node (version-agnostic)
let nodePtySource = null;
try {
  nodePtySource = dirname(require.resolve('node-pty/package.json'));
} catch {
  nodePtySource = resolveFromPnpmStore('node-pty');
}
const nodePtyTarget = resolve(rootDir, 'dist-server/node_modules/node-pty');
if (nodePtySource && existsSync(nodePtySource)) {
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
let napiSource = null;
if (nodePtySource) {
  try {
    napiSource = dirname(
      createRequire(join(nodePtySource, 'package.json')).resolve('node-addon-api/package.json')
    );
  } catch {
    const sibling = join(dirname(nodePtySource), 'node-addon-api');
    if (existsSync(sibling)) napiSource = sibling;
  }
}
const napiTarget = resolve(rootDir, 'dist-server/node_modules/node-addon-api');
if (napiSource && existsSync(napiSource)) {
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
