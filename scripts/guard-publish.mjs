// scripts/guard-publish.mjs
// Blocks npm/pnpm publish on non-publishing branches to prevent accidental releases.
import { execSync } from 'node:child_process';

const ALLOWED_BRANCHES = ['main'];
const SEP = /^[\r\n]+/;

function getBranch() {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).replace(SEP, '').trim();
  } catch {
    return '';
  }
}

const branch = getBranch();

if (!branch) {
  console.error('[guard-publish] Not on a branch (detached HEAD or not a git repo). Refusing to publish.');
  process.exit(1);
}

if (!ALLOWED_BRANCHES.includes(branch)) {
  console.error(
    `[guard-publish] Refusing to publish from branch "${branch}". ` +
    `Publish is only allowed from: ${ALLOWED_BRANCHES.join(', ')}`,
  );
  process.exit(1);
}

console.log(`[guard-publish] Branch "${branch}" is allowed to publish.`);