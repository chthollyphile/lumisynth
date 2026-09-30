import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from '@playwright/test';

// playwright.config.ts
// 两套渲染基线：
//   upstream.spec：内核（lumisynth 项目）对照 folia 原版 runtime（upstream 项目，?engine=legacy + LUMI_UPSTREAM）。
//     npm run baseline:update     # 从 folia 原版生成
//   kernel.spec：内核自己的回归基线（全功能：后处理、反色、译文、转场、片尾、mix），外加确定性检查。
//     npm run baseline:kernel     # 从当前内核生成（有意改变画面后重跑）
//   npm run test:render           # 两套都对照

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FOLIA_ROOT = path.resolve(process.env.FOLIA_ROOT ?? path.join(__dirname, '../folia-major'));

const LUMI_PORT = 3110;
const UPSTREAM_PORT = 3111;

export default defineConfig({
  testDir: './test/render',
  snapshotPathTemplate: '{testDir}/__baselines__/{testFileName}/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' },
  },
  projects: [
    // folia 原版，只用来生成 upstream.spec 的基线。
    { name: 'upstream', testMatch: 'upstream.spec.ts', use: { baseURL: `http://localhost:${UPSTREAM_PORT}` } },
    { name: 'lumisynth', use: { baseURL: `http://localhost:${LUMI_PORT}` } },
  ],
  webServer: [
    {
      command: `npx vite --port ${LUMI_PORT} --strictPort`,
      port: LUMI_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${UPSTREAM_PORT} --strictPort`,
      port: UPSTREAM_PORT,
      reuseExistingServer: false,
      env: { LUMI_UPSTREAM: FOLIA_ROOT },
    },
  ],
});
