import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // CLI 测试是纯 Node 侧的：不需要浏览器环境。
    environment: 'node',
    include: ['src/cli/**/*.test.ts'],
    setupFiles: ['src/cli/test/setup.ts'],
  },
});
