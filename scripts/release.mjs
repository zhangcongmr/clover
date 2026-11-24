// scripts/release.mjs
// Bumps versions from pending changesets (if any), then publishes the three release packages.
//
// `@julyware/clover-server` is the frozen TypeScript implementation that now
// lives in `packages/server-legacy` (same package name, so `workspace:*` links
// keep resolving). It stays published for one release cycle; the Rust server
// ships as the `clover` / `clover-app` binaries instead.
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const changesetDir = join(process.cwd(), '.changeset');
const files = readdirSync(changesetDir).filter(
  (f) => f.endsWith('.md') && f !== 'README.md',
);

if (files.length > 0) {
  console.log(`[release] Found ${files.length} changeset(s). Running changeset version...`);
  execSync('pnpm changeset version', { stdio: 'inherit' });
} else {
  console.log('[release] No pending changesets. Publishing current versions.');
}

execSync(
  'pnpm -r publish --no-git-checks --filter @julyware/clover-server --filter @julyware/clover-ui --filter @julyware/clover',
  { stdio: 'inherit' },
);