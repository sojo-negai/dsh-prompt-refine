// host 半构建:ESM,给 node 加载
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/dsh-prompt-refine.ts' },
  format: ['esm'],
  outDir: 'lib',
  dts: false,
  external: [
    /^@deepseek-ai\//,
  ],
})