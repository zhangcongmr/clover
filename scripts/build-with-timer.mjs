// scripts/build-with-timer.mjs
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

console.log('🚀 Starting monorepo build...\n');

const start = performance.now();

try {
  // 执行 pnpm -r build，并继承 stdout/stderr（实时输出）
  execSync('pnpm -r build', { stdio: 'inherit' });
} catch (error) {
  // 如果构建失败，也显示耗时
  const end = performance.now();
  const duration = (end - start) / 1000;
  console.error(`\n💥 Build failed after ${duration.toFixed(2)}s`);
  process.exit(1);
}

const end = performance.now();
const duration = (end - start) / 1000;

console.log(`\n✅ Monorepo build completed in ${duration.toFixed(2)}s`);