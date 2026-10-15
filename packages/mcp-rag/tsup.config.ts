import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  platform: 'node',
  target: 'node22',
  external: ['onnxruntime-node'],
});
