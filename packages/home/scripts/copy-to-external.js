// scripts/copy-to-external.js
import { cpSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const sourceDir = resolve(process.cwd(), 'dist-lib');
const targets = [
  resolve(process.cwd(), '../../luxio/src/assets/js'),
  // 可添加多个目标目录
];

// 确保源目录存在
if (!existsSync(sourceDir)) {
  console.error('❌ Source dist directory not found!');
  process.exit(1);
}

targets.forEach(target => {
  try {
    // 递归创建目标目录
    mkdirSync(target, { recursive: true });
    // 复制所有文件（同步）
    cpSync(sourceDir, target, { 
      recursive: true,
      force: true,
      // 可选：过滤某些文件
      // filter: (src) => !src.endsWith('.map') // 例如不复制 sourcemap
    });
    console.log(`✅ Copied to ${target}`);
  } catch (err) {
    console.error(`❌ Failed to copy to ${target}:`, err.message);
  }
});