// src/app/appCommands.ts
// 应用级命令。菜单、命令面板、快捷键都用这里的 id。
import { removeAssetClip } from '@/project/assets';
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import {
    exportProjectFile,
    flushAutosave,
    importAudioFile,
    importCoverFile,
    importLyricsFile,
    importProjectFile,
    newProject,
} from '@/project/actions';
import { newId } from '@/project/defaults';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { listPacks, onPacksChanged } from '@/packs/registry';
import { currentSelection, pickParagraphPack, pickParagraphTransition, pickShotComponent, pickShotStyle } from './arrangeActions';
import { downloadBlob, pickFile } from './download';
import { openExportDialog } from './export/ExportDialog';
import { log } from './output';
import { clock, pause, seek, togglePlay, togglePreviewMute, usePlayback } from './playback';
import { togglePreviewFullscreen } from './previewFullscreen';
import { openWizard } from './wizard/wizardStore';
import { requestScriptImport } from './script/scriptImport';
import { scriptEnv } from '@/script/env';
import { printScript } from '@/script/print';
import { registerCommands, type Command } from './workbench/commands';
import {
    openCommandPalette,
    openEditorTab,
    setLayout,
    showPanelView,
    toggleSideView,
    useLayout,
} from './workbench/layout';
import type { MenuDefinition } from './workbench/MenuBar';

const nudge = (delta: number) => seek(Math.min(usePlayback.getState().duration, clock.get() + delta));

export const APP_COMMANDS: Command[] = [
    // 文件
    { id: 'project.wizard', category: '工程', title: '快速制作向导…', run: () => openWizard({ fresh: true }) },
    { id: 'project.new', category: '工程', title: '新建空白工程', keybinding: 'Ctrl+Alt+N', global: true, run: () => newProject() },
    { id: 'project.open', category: '工程', title: '打开工程…', keybinding: 'Ctrl+O', global: true, run: () => openCommandPalette('') },
    {
        id: 'project.save', category: '工程', title: '保存到本机', keybinding: 'Ctrl+S', global: true,
        run: async () => {
            await flushAutosave();
            log('工程已保存到本机');
        },
    },
    {
        id: 'project.import', category: '工程', title: '打开工程文件（.lumi）…',
        run: async () => {
            const file = await pickFile('.lumi,application/zip');
            if (file) await importProjectFile(file);
        },
    },
    {
        id: 'project.export', category: '工程', title: '导出工程文件（.lumi）…', keybinding: 'Ctrl+Shift+S', global: true,
        run: async () => {
            const { blob, fileName } = await exportProjectFile();
            downloadBlob(blob, fileName);
        },
    },
    { id: 'export.video', category: '文件', title: '导出视频…', keybinding: 'Ctrl+E', global: true, run: () => openExportDialog() },
    {
        id: 'input.audio', category: '歌曲', title: '导入音频…',
        run: async () => {
            const file = await pickFile('audio/*');
            if (file) await importAudioFile(file);
        },
    },
    {
        id: 'input.lyrics', category: '歌曲', title: '导入歌词文件…',
        run: async () => {
            const file = await pickFile(LYRIC_FILE_ACCEPT);
            if (file) await importLyricsFile(file);
        },
    },
    {
        id: 'input.translation', category: '歌曲', title: '导入译文文件…',
        run: async () => {
            const file = await pickFile(LYRIC_FILE_ACCEPT);
            if (file) await importLyricsFile(file, 'translation');
        },
    },
    {
        id: 'input.cover', category: '歌曲', title: '导入封面图…',
        run: async () => {
            const file = await pickFile('image/*');
            if (file) await importCoverFile(file);
        },
    },

    {
        id: 'script.import', category: '剧本', title: '导入剧本或设置（.lumiscript / .json）…',
        run: async () => {
            const file = await pickFile('.lumiscript,.txt,.json,text/plain,application/json');
            if (!file) return;
            openEditorTab('script', true);
            requestScriptImport(file);
        },
    },
    {
        id: 'script.export', category: '剧本', title: '导出剧本（.lumiscript）…',
        run: () => {
            const project = useProjectStore.getState().project;
            const text = printScript(scriptEnv(project, useSession.getState().audioBuffer?.duration ?? null)).text;
            const name = (project.meta.title || project.name).replace(/[\\/:*?"<>|]+/g, '_') || 'lumisynth';
            downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}.lumiscript`);
        },
    },

    // 编辑
    {
        id: 'edit.undo', category: '编辑', title: '撤销', keybinding: 'Ctrl+Z',
        enabled: () => useProjectStore.getState().past.length > 0,
        run: () => useProjectStore.getState().undo(),
    },
    {
        id: 'edit.redo', category: '编辑', title: '重做', keybinding: 'Ctrl+Shift+Z',
        enabled: () => useProjectStore.getState().future.length > 0,
        run: () => useProjectStore.getState().redo(),
    },
    {
        id: 'edit.redoAlt', category: '编辑', title: '重做（Ctrl+Y）', keybinding: 'Ctrl+Y',
        enabled: () => useProjectStore.getState().future.length > 0,
        run: () => useProjectStore.getState().redo(),
    },
    {
        id: 'arrange.reseed', category: '编排', title: '重新随机编排（换 seed）',
        run: () => updateProject(p => ({ ...p, seed: newId().slice(0, 8) })),
    },
    {
        id: 'arrange.mix', category: '编排', title: '全曲按段落性质混用风格包',
        run: () => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'mix' } })),
    },
    {
        // 对话框、右键菜单、命令面板开着时 Esc 只关掉它们（它们自己处理），不顺带清掉选择。
        id: 'selection.clear', category: '编辑', title: '取消选择', keybinding: 'Escape',
        enabled: () => useSession.getState().selection.type !== 'none' && !document.querySelector('[role="dialog"], [role="menu"]'),
        run: () => useSession.setState({ selection: { type: 'none' } }),
    },
    {
        id: 'clip.delete', category: '编辑', title: '删除选中的素材片段', keybinding: 'Delete',
        enabled: () => useSession.getState().selection.type === 'clip',
        run: () => {
            const selection = useSession.getState().selection;
            if (selection.type !== 'clip') return;
            removeAssetClip(selection.clipId);
            useSession.setState({ selection: { type: 'none' } });
        },
    },
    {
        id: 'arrange.shotStyle', category: '编排', title: '选中的镜头：换风格…', keybinding: 'Alt+S',
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotStyle(shot); },
    },
    {
        id: 'arrange.shotTypography', category: '编排', title: '选中的镜头：换排版…', keybinding: 'Alt+T',
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotComponent(shot, 'typography'); },
    },
    {
        id: 'arrange.shotAccent', category: '编排', title: '选中的镜头：换点缀…',
        enabled: () => useSession.getState().selection.type === 'shot',
        run: () => { const { shot } = currentSelection(); if (shot) void pickShotComponent(shot, 'accent'); },
    },
    {
        id: 'arrange.paragraphPack', category: '编排', title: '选中的段落：换风格包…', keybinding: 'Alt+P',
        enabled: () => ['shot', 'paragraph'].includes(useSession.getState().selection.type),
        run: () => { const { paragraph } = currentSelection(); if (paragraph) void pickParagraphPack(paragraph); },
    },
    {
        id: 'arrange.paragraphTransition', category: '编排', title: '选中的段落：换出场转场…',
        enabled: () => ['shot', 'paragraph'].includes(useSession.getState().selection.type),
        run: () => { const { paragraph } = currentSelection(); if (paragraph) void pickParagraphTransition(paragraph); },
    },
    {
        id: 'look.toggleVariant', category: '画面', title: '切换深色 / 浅色配色',
        run: () => updateProject(p => ({ ...p, theme: { ...p.theme, variant: p.theme.variant === 'dark' ? 'light' : 'dark' } })),
    },

    // 视图
    { id: 'workbench.commandPalette', category: '视图', title: '命令面板（搜索所有命令）…', keybinding: 'Ctrl+Shift+P', global: true, run: () => openCommandPalette('>') },
    { id: 'workbench.commandPaletteF1', category: '视图', title: '命令面板（F1）', keybinding: 'F1', global: true, run: () => openCommandPalette('>') },
    {
        id: 'workbench.toggleSideBar', category: '视图', title: '显示 / 隐藏左侧栏', keybinding: 'Ctrl+B', global: true,
        run: () => setLayout({ sideBarVisible: !useLayout.getState().sideBarVisible }),
    },
    {
        id: 'workbench.togglePanel', category: '视图', title: '显示 / 隐藏底部面板', keybinding: 'Ctrl+J', global: true,
        run: () => setLayout({ panelVisible: !useLayout.getState().panelVisible }),
    },
    {
        id: 'workbench.toggleAuxBar', category: '视图', title: '显示 / 隐藏右侧检查器', keybinding: 'Ctrl+Alt+B', global: true,
        run: () => setLayout({ auxBarVisible: !useLayout.getState().auxBarVisible }),
    },
    { id: 'view.assets', category: '视图', title: '歌曲：音频、歌词、封面', keybinding: 'Ctrl+Shift+E', global: true, run: () => toggleSideView('assets') },
    { id: 'view.look', category: '视图', title: '画面与编排设置', keybinding: 'Ctrl+Shift+L', global: true, run: () => toggleSideView('look') },
    { id: 'view.assetLibrary', category: '视图', title: '素材库：图片与视频', run: () => toggleSideView('assetLibrary') },
    { id: 'view.library', category: '视图', title: '风格库', keybinding: 'Ctrl+Shift+G', global: true, run: () => toggleSideView('library') },
    { id: 'view.ai', category: '视图', title: 'AI 助手', keybinding: 'Ctrl+Shift+A', global: true, run: () => toggleSideView('ai') },
    { id: 'view.libraryEditor', category: '视图', title: '风格库（大图）', run: () => openEditorTab('library') },
    { id: 'view.libraryEditorSplit', category: '视图', title: '风格库与预览并排', run: () => openEditorTab('library', true) },
    { id: 'view.script', category: '视图', title: '剧本：用文字改编排', keybinding: 'Ctrl+Shift+K', global: true, run: () => openEditorTab('script', true) },
    { id: 'view.lyrics', category: '视图', title: '歌词：改字、逐字时间', keybinding: 'Ctrl+Shift+Y', global: true, run: () => openEditorTab('lyrics', true) },
    { id: 'view.themePark', category: '视图', title: '主题编辑器：配色、关键字、图标', keybinding: 'Ctrl+Shift+H', global: true, run: () => openEditorTab('theme', true) },
    { id: 'view.settings', category: '视图', title: '设置…', keybinding: 'Ctrl+,', global: true, run: () => openEditorTab('settings') },
    { id: 'view.storyboard', category: '视图', title: '分镜：直接改分段、性质与风格包', keybinding: 'Ctrl+Alt+O', global: true, run: () => openEditorTab('storyboard', false) },
    { id: 'view.outline', category: '视图', title: '大纲：段落与镜头', keybinding: 'Ctrl+Shift+O', global: true, run: () => toggleSideView('outline') },
    { id: 'view.agent', category: '视图', title: '连接 Agent（MCP）', run: () => toggleSideView('agent') },
    { id: 'view.layoutMobile', category: '视图', title: '切换到手机布局', run: () => setLayout({ uiMode: 'mobile' }) },
    { id: 'view.layoutDesktop', category: '视图', title: '切换到桌面布局', run: () => setLayout({ uiMode: 'desktop' }) },
    { id: 'view.layoutAuto', category: '视图', title: '布局跟随设备', run: () => setLayout({ uiMode: 'auto' }) },
    { id: 'view.timeline', category: '视图', title: '时间轴', run: () => showPanelView('timeline') },
    { id: 'view.problems', category: '视图', title: '问题', keybinding: 'Ctrl+Shift+M', global: true, run: () => showPanelView('problems') },
    { id: 'view.output', category: '视图', title: '输出', keybinding: 'Ctrl+Shift+U', global: true, run: () => showPanelView('output') },

    // 播放
    { id: 'playback.toggle', category: '播放', title: '播放 / 暂停', keybinding: 'Space', run: togglePlay },
    { id: 'playback.start', category: '播放', title: '回到开头', keybinding: 'Home', run: () => { pause(); seek(0); } },
    { id: 'playback.back', category: '播放', title: '后退 5 秒', keybinding: 'ArrowLeft', run: () => nudge(-5) },
    { id: 'playback.forward', category: '播放', title: '前进 5 秒', keybinding: 'ArrowRight', run: () => nudge(5) },
    { id: 'playback.backFine', category: '播放', title: '后退 1 帧', keybinding: 'Shift+ArrowLeft', run: () => nudge(-1 / 30) },
    { id: 'playback.forwardFine', category: '播放', title: '前进 1 帧', keybinding: 'Shift+ArrowRight', run: () => nudge(1 / 30) },
    { id: 'view.previewFullscreen', category: '视图', title: '预览全屏', keybinding: 'F', run: togglePreviewFullscreen },
    { id: 'playback.toggleMute', category: '播放', title: '预览静音 / 取消静音', keybinding: 'M', run: togglePreviewMute },
];

export const APP_MENUS: MenuDefinition[] = [
    {
        label: '文件',
        items: [
            'project.wizard', 'project.new', 'project.open', '-',
            '#歌曲', 'input.audio', 'input.lyrics', 'input.translation', 'input.cover', '-',
            '#剧本', 'script.import', 'script.export', '-',
            '#工程', 'project.save', 'project.import', 'project.export', '-',
            'export.video',
        ],
    },
    {
        label: '编辑',
        items: ['edit.undo', 'edit.redo', '-', 'clip.delete', '-', 'view.settings'],
    },
    {
        label: '编排',
        items: [
            'arrange.shotStyle', 'arrange.shotTypography', 'arrange.shotAccent', '-',
            'arrange.paragraphPack', 'arrange.paragraphTransition', '-',
            '#全曲', 'arrange.packs', 'arrange.mix', 'arrange.reseed', '-',
            '#画面', 'look.toggleVariant', 'view.themePark', '-',
            'view.storyboard', 'view.script', 'view.outline',
        ],
    },
    {
        label: '视图',
        items: [
            'workbench.commandPalette', '-',
            '#左侧栏', 'view.assets', 'view.outline', 'view.look', 'view.library', 'view.assetLibrary', 'view.ai', 'view.agent', '-',
            '#编辑区', 'view.storyboard', 'view.lyrics', 'view.script', 'view.themePark', 'view.libraryEditor', 'view.libraryEditorSplit', 'view.settings', '-',
            '#底部面板', 'view.timeline', 'view.problems', 'view.output', '-',
            '#布局', 'workbench.toggleSideBar', 'workbench.togglePanel', 'workbench.toggleAuxBar', 'view.previewFullscreen', 'view.layoutMobile', 'view.layoutAuto',
        ],
    },
    { label: '播放', items: ['playback.toggle', 'playback.start', '-', 'playback.back', 'playback.forward', 'playback.backFine', 'playback.forwardFine', '-', 'playback.toggleMute'] },
];

/** 每个风格包一条「全曲使用 xx」命令；以后注册的包也会补上。 */
const packCommands = (): Command[] => listPacks().map(pack => ({
    id: `arrange.pack.${pack.id}`,
    category: '编排',
    title: `全曲使用${pack.label}`,
    run: () => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'single', pack: pack.id } })),
}));

let registered = false;
export const registerAppCommands = () => {
    if (registered) return;
    registered = true;
    registerCommands(APP_COMMANDS);
    let unregisterPacks = registerCommands(packCommands());
    onPacksChanged(() => {
        unregisterPacks();
        unregisterPacks = registerCommands(packCommands());
    });
};

/** 菜单里的占位项 `arrange.packs` 展开成每个包一条。 */
export const expandMenuItems = (items: string[]) => items.flatMap(item => (
    item === 'arrange.packs' ? listPacks().map(pack => `arrange.pack.${pack.id}`) : [item]
));
