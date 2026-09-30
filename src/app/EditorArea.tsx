// src/app/EditorArea.tsx
// 编辑区（VS Code 的 editor group）：标签页 = 预览 / 分镜 / 剧本 / 歌词 / 风格库 / 主题 / 设置，可以左右分栏（左边固定是预览）。
// 预览始终挂载（切到别的标签页时只是隐藏），内核不会因为切换而重建。
import type { ReactNode } from 'react';
import { Clapperboard, Columns2, FileCode2, LayoutGrid, MicVocal, MonitorPlay, Palette, Search, Settings2, X } from 'lucide-react';
import { useState } from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import { ScriptView } from './ScriptView';
import { StoryboardView } from './storyboard/StoryboardView';
import { LyricsView } from './lyrics/LyricsView';
import { ThemeParkView } from './theme-park/ThemeParkView';
import { StyleLibrary } from './library/StyleLibrary';
import { SettingsSearchContext, StylePanel } from './StylePanel';
import { Transport } from './Transport';
import { cx } from './ui';
import { closeEditorTab, setLayout, useLayout, type EditorTabId } from './workbench/layout';

const TABS: Record<EditorTabId, { title: string; icon: typeof MonitorPlay }> = {
    preview: { title: '预览', icon: MonitorPlay },
    library: { title: '风格库', icon: LayoutGrid },
    settings: { title: '设置', icon: Settings2 },
    script: { title: '剧本', icon: FileCode2 },
    lyrics: { title: '歌词', icon: MicVocal },
    theme: { title: '主题', icon: Palette },
    storyboard: { title: '分镜', icon: Clapperboard },
};

function SettingsEditor() {
    const [query, setQuery] = useState('');
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-4 py-2">
                <Search size={14} className="text-zinc-500" />
                <input
                    autoFocus
                    aria-label="搜索设置"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索设置（例如：字体、转场、后处理、颗粒）"
                    className="h-8 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none select-text"
                />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-2xl">
                    <SettingsSearchContext.Provider value={{ query }}>
                        <StylePanel />
                    </SettingsSearchContext.Provider>
                </div>
            </div>
        </div>
    );
}

function TabContent({ tab }: { tab: EditorTabId }) {
    if (tab === 'library') return <div className="min-h-0 flex-1 overflow-y-auto"><StyleLibrary wide /></div>;
    if (tab === 'settings') return <SettingsEditor />;
    if (tab === 'script') return <ScriptView />;
    if (tab === 'lyrics') return <LyricsView />;
    if (tab === 'theme') return <ThemeParkView />;
    if (tab === 'storyboard') return <StoryboardView />;
    return null;
}

export function EditorArea({ preview }: { preview: ReactNode }) {
    const tabs = useLayout(state => state.editorTabs);
    const active = useLayout(state => state.activeEditorTab);
    const split = useLayout(state => state.editorSplit);
    const showSecondary = active !== 'preview';
    const previewVisible = !showSecondary || split;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div role="tablist" aria-label="编辑区" className="flex h-8 shrink-0 items-stretch border-b border-zinc-800 bg-zinc-900">
                {tabs.map(tab => {
                    const Icon = TABS[tab].icon;
                    const selected = tab === active || (split && tab === 'preview');
                    return (
                        <div
                            key={tab}
                            role="tab"
                            aria-selected={tab === active}
                            onClick={() => setLayout({ activeEditorTab: tab })}
                            onAuxClick={event => { if (event.button === 1) closeEditorTab(tab); }}
                            className={cx(
                                'group flex cursor-pointer items-center gap-1.5 border-r border-zinc-800 px-3 text-xs',
                                tab === active ? 'bg-zinc-950 text-zinc-100' : selected ? 'bg-zinc-950/60 text-zinc-300' : 'text-zinc-500 hover:text-zinc-300',
                            )}
                        >
                            <Icon size={13} />
                            {TABS[tab].title}
                            {tab !== 'preview' && (
                                <button
                                    type="button"
                                    aria-label={`关闭${TABS[tab].title}`}
                                    onClick={event => { event.stopPropagation(); closeEditorTab(tab); }}
                                    className="rounded p-0.5 text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-800 hover:text-zinc-100"
                                >
                                    <X size={11} />
                                </button>
                            )}
                        </div>
                    );
                })}
                <div className="flex-1" />
                {tabs.length > 1 && (
                    <button
                        type="button"
                        aria-label="左右分栏"
                        aria-pressed={split}
                        title="左右分栏（左边是预览）"
                        onClick={() => setLayout({ editorSplit: !split, activeEditorTab: active === 'preview' ? tabs.find(tab => tab !== 'preview') ?? 'preview' : active })}
                        className={cx('px-2', split ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-200')}
                    >
                        <Columns2 size={14} />
                    </button>
                )}
            </div>
            <div className="flex min-h-0 flex-1">
                <div className={cx('flex min-w-0 flex-1 flex-col', !previewVisible && 'hidden')}>
                    <Breadcrumbs />
                    {preview}
                    <Transport />
                </div>
                {showSecondary && (
                    <div className={cx('flex min-w-0 flex-col bg-zinc-950', split ? 'w-1/2 border-l border-zinc-800' : 'flex-1')}>
                        <TabContent tab={active} />
                    </div>
                )}
            </div>
        </div>
    );
}
