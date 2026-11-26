// scripts/guard-publish.mjs
// Blocks npm/pnpm publish on non-publishing branches to prevent accidental releases.
import { execSync } from 'node:child_process';

const ALLOWED_BRANCHES = ['main'];
const SEP = /^[\r\n]+/;

function run(command) {
  try {
    return execSync(command, { encoding: 'utf8' }).replace(SEP, '').trim();
  } catch {
    return '';
  }
}

function getBranch() {
  return run('git branch --show-current');
}

// CI publishes from a tag checkout, where there is no current branch. A
// detached HEAD is only accepted when it sits exactly on a tag, so a stray
// detached checkout elsewhere still cannot publish.
function getTag() {
  return run('git describe --exact-match --tags HEAD');
}

const branch = getBranch();

if (!branch) {
  const tag = getTag();
  if (tag) {
    console.log(`[guard-publish] Detached HEAD on tag "${tag}" is allowed to publish.`);
    process.exit(0);
  }
  console.error('[guard-publish] Not on a branch or release tag (detached HEAD). Refusing to publish.');
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