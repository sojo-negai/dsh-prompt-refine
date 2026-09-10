// client 半构建:IIFE,给浏览器作为副作用脚本加载
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { client: 'src/client.ts' },
  format: ['iife'],
  outDir: 'lib',
  clean: false,
  dts: false,
  external: [
    /^@deepseek-ai\//,
    /^react(\/|-|$)/,
    /^react-dom/,
  ],
})