import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/acp/acp-agent.types.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
});
