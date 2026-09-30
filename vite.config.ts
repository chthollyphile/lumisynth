/// <reference types="vitest/config" />
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LUMI_UPSTREAM=<folia-major 根目录> 时，宿主页改为直接加载 folia 原版的两个引擎目录，
// 用来截对照基线（见 test/render）。平时指向 src/packs。
const upstreamRoot = process.env.LUMI_UPSTREAM ? path.resolve(process.env.LUMI_UPSTREAM) : null;
const packSourceRoot = upstreamRoot
  ? path.join(upstreamRoot, 'src/components/visualizer')
  : path.resolve(__dirname, './src/packs');
const UPSTREAM_SHARED_DEPS = [
  'pixi.js',
  '@chenglou/pretext',
  'lucide-react',
  'react',
  'react-dom',
  '@applemusic-like-lyrics/ttml',
  '@xmldom/xmldom',
];

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@pack-src': packSourceRoot,
      '@': path.resolve(__dirname, './src'),
    },
    // 原版引擎也用 lumisynth 装的依赖，基线差异只反映代码改动，不混入依赖版本差。
    dedupe: upstreamRoot ? UPSTREAM_SHARED_DEPS : undefined,
  },
  server: {
    port: Number(process.env.PORT) || 3100,
    fs: upstreamRoot ? { allow: [__dirname, upstreamRoot] } : undefined,
  },
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
}));
