// electron/main.cjs
// 桌面版的主进程：只是把构建好的 dist/ 装进一个窗口。页面不需要 Node 能力，所以没有 preload，
// 渲染进程保持 sandbox + contextIsolation。
//
// 页面通过自定义协议 app://lumisynth/ 加载，而不是 file://：
// - dist 里的资源路径是 /assets/… 这样的绝对路径，file:// 下会指到磁盘根目录；
// - IndexedDB（工程都存在这里）、WebCodecs、剪贴板要求安全上下文；
// - 工程数据跟着这个来源保存，所以协议名与主机名以后不能改，改了用户就看不到原来的工程了。
//
// 开发：`npm run dev:electron`（scripts/dev-electron.mjs 起 vite 开发服务器，窗口加载它，改代码热更新）。
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, net, protocol, session, shell } = require('electron');
const { checkForUpdates, setupUpdates } = require('./updates.cjs');

const SCHEME = 'app';
const HOST = 'lumisynth';
const APP_ORIGIN = `${SCHEME}://${HOST}`;
const DEV = process.argv.includes('--dev');
const DEV_URL = process.env.LUMISYNTH_DEV_URL || 'http://localhost:3100';
const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
// 与页面菜单栏一致：h-9（36px）、bg-zinc-900、按钮用 zinc-300。
const TITLEBAR_HEIGHT = 36;
const TITLEBAR_COLOR = '#18181b';
const TITLEBAR_SYMBOL_COLOR = '#d4d4d8';

protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// 同一份 IndexedDB 只能被一个进程打开：第二次启动时把已有的窗口叫到前面。
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.focus();
    });
    app.whenReady().then(start);
}

/** app://lumisynth/<路径> → dist/<路径>；找不到的路径回退到 index.html（与静态托管的 SPA 回退一致）。 */
const serveDist = () => protocol.handle(SCHEME, request => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.join(DIST, relative);
    if (path.relative(DIST, file).startsWith('..')) return new Response('Forbidden', { status: 403 });
    if (!relative || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
});

const isAppUrl = url => url.startsWith(`${APP_ORIGIN}/`) || (DEV && url.startsWith(DEV_URL));

/** 页面只来自本应用；权限（本机字体、剪贴板、全屏……）只给本应用的页面。 */
const setupPermissions = () => {
    session.defaultSession.setPermissionRequestHandler((webContents, _permission, callback, details) => {
        callback(isAppUrl(details.requestingUrl || webContents.getURL()));
    });
    session.defaultSession.setPermissionCheckHandler((_webContents, _permission, requestingOrigin) => (
        isAppUrl(`${requestingOrigin.replace(/\/$/, '')}/`)
    ));
};

const openExternal = url => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
};

const createWindow = () => {
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false,
        title: 'lumisynth',
        backgroundColor: '#09090b',
        // Windows 打包后用 exe 自带的图标；开发时（node_modules 里的 electron.exe）靠这里显示 lumisynth 的图标。
        icon: process.platform === 'darwin' ? undefined : ICON,
        autoHideMenuBar: true,
        // 不要系统标题栏：页面的菜单栏兼做标题栏（src/index.css 的 .titlebar）。系统窗口按钮叠在菜单栏上——
        // Windows / Linux 的最小化、最大化、关闭画在右端，颜色与菜单栏一致；macOS 的红黄绿嵌在左端。
        // titleBarOverlay 同时让页面拿到 env(titlebar-area-*)，菜单栏据此给按钮让位。
        titleBarStyle: 'hidden',
        titleBarOverlay: process.platform === 'darwin' ? true : { color: TITLEBAR_COLOR, symbolColor: TITLEBAR_SYMBOL_COLOR, height: TITLEBAR_HEIGHT },
        trafficLightPosition: { x: 14, y: 11 },
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
        },
    });
    window.once('ready-to-show', () => window.show());

    // 外链交给系统浏览器；窗口本身不离开应用页面。
    window.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
        if (isAppUrl(url)) return;
        event.preventDefault();
        openExternal(url);
    });

    // Windows / Linux 没有菜单栏：F12 打开开发者工具，排查问题用。
    window.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
            window.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    void window.loadURL(DEV ? DEV_URL : `${APP_ORIGIN}/`);
    return window;
};

/**
 * 应用有自己的菜单栏（页面里），系统菜单只在 macOS 上保留最少的一份：没有它 Cmd+C / Cmd+V / Cmd+Q 不工作。
 * Windows / Linux 去掉默认菜单，免得 Ctrl+R、Ctrl+W 之类的快捷键被它截走。
 */
const setupMenu = () => {
    if (process.platform !== 'darwin') {
        Menu.setApplicationMenu(null);
        return;
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            role: 'appMenu',
            submenu: [
                { role: 'about', label: '关于 lumisynth' },
                { label: '检查更新…', click: () => void checkForUpdates({ manual: true }) },
                { type: 'separator' },
                { role: 'hide', label: '隐藏 lumisynth' },
                { role: 'hideOthers', label: '隐藏其他' },
                { role: 'unhide', label: '全部显示' },
                { type: 'separator' },
                { role: 'quit', label: '退出 lumisynth' },
            ],
        },
        { role: 'editMenu', label: '编辑' },
        {
            label: '显示',
            submenu: [
                { role: 'togglefullscreen', label: '全屏' },
                { role: 'toggleDevTools', label: '开发者工具' },
            ],
        },
        { role: 'windowMenu', label: '窗口' },
    ]));
};

function start() {
    serveDist();
    setupPermissions();
    setupMenu();
    createWindow();
    if (app.isPackaged) setupUpdates();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
