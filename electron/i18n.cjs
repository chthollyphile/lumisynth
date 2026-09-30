// electron/i18n.cjs
// 主进程自己的几句话（macOS 菜单、检查更新的对话框）。界面语言是页面的设置（存在页面的 localStorage 里），
// 主进程读页面 <html lang> 跟着它；页面还没加载好或读不到时用系统语言。
const { app } = require('electron');
const MESSAGES = require('./locales.json');

const SUPPORTED = Object.keys(MESSAGES);
let pageLanguage = null;

const pick = tags => {
    for (const tag of tags) {
        const base = String(tag ?? '').toLowerCase().split('-')[0];
        if (SUPPORTED.includes(base)) return base;
    }
    return null;
};

const systemLanguage = () => pick(app.getPreferredSystemLanguages?.() ?? [app.getLocale()]) ?? 'en';

const language = () => pageLanguage ?? systemLanguage();

/** 从页面读界面语言（读不到时保持原样）。返回现在用的语言。 */
const syncLanguageFromPage = async webContents => {
    if (webContents && !webContents.isDestroyed()) {
        try {
            pageLanguage = pick([await webContents.executeJavaScript('document.documentElement.lang', true)]) ?? pageLanguage;
        } catch {
            // 页面还没准备好：沿用上一次的。
        }
    }
    return language();
};

/** tr('updates.released', { version }) */
const tr = (key, values = {}) => {
    const text = key.split('.').reduce((node, part) => node?.[part], MESSAGES[language()])
        ?? key.split('.').reduce((node, part) => node?.[part], MESSAGES.en)
        ?? key;
    return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? ''));
};

module.exports = { tr, syncLanguageFromPage };
