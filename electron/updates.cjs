// electron/updates.cjs
// 检查更新。安装包都没有签名，所以各平台做法不同：
// - Windows（NSIS）：electron-updater 在后台下载新版安装包，下完问是否重启安装；选「稍后」就在退出时装。
// - macOS：未签名的应用 Squirrel.Mac 装不了更新；Linux 的 tar.gz / deb / rpm 也不走自动更新。
//   这两个平台只查 GitHub 上最新的正式版，有新版本就提示去下载页。
// 启动几秒后查一次；macOS 的应用菜单里另有「检查更新…」。draft / 预发布的版本不会被当成新版本。
const { app, dialog, net, shell, BrowserWindow } = require('electron');
const { tr, syncLanguageFromPage } = require('./i18n.cjs');

// 与 package.json 里 build.publish 的 owner / repo 保持一致。
const RELEASE_REPO = 'chthollyphile/lumisynth';
const STARTUP_DELAY_MS = 5_000;

let checking = false;
let windowsUpdater = null;

const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

/** options 是函数：先按页面的界面语言对好，再取文字。 */
const showMessage = async build => {
    const parent = parentWindow();
    await syncLanguageFromPage(parent?.webContents);
    const options = build();
    return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
};

/** A.B.C 比大小；带预发布后缀的版本不参与比较。 */
const parseVersion = value => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim());
    return match ? match.slice(1).map(Number) : null;
};
const isNewer = (candidate, current) => {
    const next = parseVersion(candidate);
    const now = parseVersion(current);
    if (!next || !now) return false;
    for (let index = 0; index < 3; index += 1) {
        if (next[index] !== now[index]) return next[index] > now[index];
    }
    return false;
};

const latestRelease = async () => {
    const response = await net.fetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `lumisynth/${app.getVersion()}` },
    });
    if (response.status === 404) return null; // 还没有正式版
    if (!response.ok) throw new Error(tr('updates.githubStatus', { status: response.status }));
    const release = await response.json();
    return { version: String(release.tag_name).replace(/^v/, ''), url: release.html_url };
};

const upToDate = () => showMessage(() => ({ type: 'info', message: tr('updates.upToDate'), detail: `lumisynth ${app.getVersion()}` }));

const checkByRelease = async manual => {
    const release = await latestRelease();
    if (!release || !isNewer(release.version, app.getVersion())) {
        if (manual) await upToDate();
        return;
    }
    const { response } = await showMessage(() => ({
        type: 'info',
        buttons: [tr('updates.download'), tr('updates.later')],
        defaultId: 0,
        cancelId: 1,
        message: tr('updates.released', { version: release.version }),
        detail: tr('updates.releasedDetail', { current: app.getVersion() }),
    }));
    if (response === 0) void shell.openExternal(release.url);
};

const getWindowsUpdater = () => {
    if (windowsUpdater) return windowsUpdater;
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', async info => {
        const { response } = await showMessage(() => ({
            type: 'info',
            buttons: [tr('updates.restart'), tr('updates.later')],
            defaultId: 0,
            cancelId: 1,
            message: tr('updates.downloaded', { version: info.version }),
            detail: tr('updates.downloadedDetail'),
        }));
        if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.on('error', error => console.warn('[lumisynth] 自动更新失败', error));
    windowsUpdater = autoUpdater;
    return autoUpdater;
};

const checkOnWindows = async manual => {
    const result = await getWindowsUpdater().checkForUpdates();
    const version = result?.updateInfo?.version;
    if (manual && (!version || !isNewer(version, app.getVersion()))) await upToDate();
    else if (manual) await showMessage(() => ({ type: 'info', message: tr('updates.downloading', { version }), detail: tr('updates.downloadingDetail') }));
};

/** manual：用户手动点的，结果（包括「已是最新」与出错）都要告诉用户；启动时的自动检查出错不打扰。 */
const checkForUpdates = async ({ manual = false } = {}) => {
    if (!app.isPackaged || checking) return;
    checking = true;
    try {
        if (process.platform === 'win32') await checkOnWindows(manual);
        else await checkByRelease(manual);
    } catch (error) {
        console.warn('[lumisynth] 检查更新失败', error);
        if (manual) await showMessage(() => ({ type: 'warning', message: tr('updates.failed'), detail: error instanceof Error ? error.message : String(error) }));
    } finally {
        checking = false;
    }
};

const setupUpdates = () => {
    setTimeout(() => void checkForUpdates(), STARTUP_DELAY_MS).unref?.();
};

module.exports = { checkForUpdates, setupUpdates, isNewer };
