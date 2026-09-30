// scripts/dev-electron.mjs（npm run dev:electron）
// 一条命令起桌面版开发环境：先起 vite 开发服务器，再让 Electron 窗口加载它（改代码热更新）；
// 关掉窗口时 vite 一起退出。3100 端口被占用（比如另开着 npm run dev）时 vite 自动换端口，窗口跟着加载那个地址。
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const server = await createServer({ server: { strictPort: false } });
await server.listen();
server.printUrls();
const url = (server.resolvedUrls?.local[0] ?? `http://localhost:${server.config.server.port}/`).replace(/\/$/, '');

// electron 包的默认导出是可执行文件的路径。
const electronBinary = createRequire(import.meta.url)('electron');
const electron = spawn(electronBinary, ['.', '--dev'], {
    stdio: 'inherit',
    env: { ...process.env, LUMISYNTH_DEV_URL: url },
});

const shutdown = async code => {
    await server.close();
    process.exit(code ?? 0);
};
electron.on('exit', code => void shutdown(code));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => electron.kill());
