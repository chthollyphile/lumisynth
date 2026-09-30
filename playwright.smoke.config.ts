import { defineConfig } from '@playwright/test';

// playwright.smoke.config.ts
// 部署前的冒烟测试：跑的是生产构建（vite build + vite preview），不是开发服务器。
//   npm run test:smoke
const PORT = 3112;

export default defineConfig({
  testDir: './test/smoke',
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    // 测试按中文界面的文字找元素；英文界面另有专门的测试（workbench.spec）。
    locale: 'zh-CN',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
  },
});
