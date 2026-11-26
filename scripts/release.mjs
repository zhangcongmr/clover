// scripts/release.mjs
// Bumps versions from pending changesets (if any), then publishes the three JS
// packages with pnpm.
//
// `@julyware/clover-server` is the frozen TypeScript implementation that now
// lives in `packages/server-legacy` (same package name, so `workspace:*` links
// keep resolving). It stays published for one release cycle; the Rust server
// ships as the `clover` / `Clover64` binaries instead.
//
// `@julyware/clover-cli` (the Rust CLI) is a normal workspace member, so
// changesets bumps its version with the rest of `@julyware/*`. Its platform
// binary packages only exist after a build, so they are injected into the
// manifest at publish time and the CLI itself is published from CI (it needs
// binaries for five platforms). Tagging is the last step of a release; see the
// printed instructions or packages/server-rust/README.md.
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'packages/server-rust/package.json'), 'utf8'),
);

console.log(
  `[release] The Rust CLI is published from CI (five platform builds). After committing ` +
    `the version bump:\n` +
    `  git tag clover-cli-v${version} && git push origin clover-cli-v${version}`,
);