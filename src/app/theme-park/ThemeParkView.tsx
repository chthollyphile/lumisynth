// src/app/theme-park/ThemeParkView.tsx
// 编辑区「主题」标签页：移植自 folia 的 Theme Park。左边（分栏）是实时预览——预览画的是草稿，
// 右边是分页的编辑器：颜色 / 详情 / 内容 / AI。点「应用」才写进工程（一步撤销）。
import { useEffect, useMemo } from 'react';
import { Check, Dices, Palette, RotateCcw, Undo2 } from 'lucide-react';
import { useProjectStore } from '@/project/store';
import { useSession } from '@/project/session';
import { log } from '../output';
import { Button, cx } from '../ui';
import { ThemeParkAiPanel } from './ThemeParkAiPanel';
import { ThemeParkColorPanel } from './ThemeParkColorPanel';
import { ThemeParkContentPanel } from './ThemeParkContentPanel';
import { ThemeParkDetailsPanel } from './ThemeParkDetailsPanel';
import { randomTheme } from '../wizard/randomTheme';
import { buildRecommendedColors, isDualThemeNameValid, MODE_LABELS, type ThemeParkTab } from './themeParkDraft';
import {
    applyThemeDraft,
    isThemeDraftDirty,
    openThemeDraft,
    patchThemeMode,
    patchThemeShared,
    replaceThemeDraft,
    resetThemeDraftColors,
    resolvedThemeDraft,
    revertThemeDraft,
    setThemeColor,
    setThemeParkColorKey,
    setThemeParkMode,
    setThemeParkTab,
    useThemePark,
} from './themeParkStore';

const TABS: Array<{ id: ThemeParkTab; label: string }> = [
    { id: 'colors', label: '颜色' },
    { id: 'details', label: '详情' },
    { id: 'content', label: '内容' },
    { id: 'ai', label: 'AI' },
];

const SOURCE_LABELS = { preset: '预设', ai: 'AI 生成', custom: '自定义' } as const;

export function ThemeParkView() {
    useEffect(() => openThemeDraft(), []);
    const { draft, base, mode, colorKey, tab } = useThemePark();
    const project = useProjectStore(state => state.project.theme);
    const coverColors = useSession(state => state.coverColors);

    const safeDraft = useMemo(() => (draft ? resolvedThemeDraft(draft) : null), [draft]);
    const recommended = useMemo(() => (base ? buildRecommendedColors(base, coverColors) : []), [base, coverColors]);
    if (!draft || !safeDraft) return null;

    const dirty = isThemeDraftDirty({ draft, base });
    const nameValid = isDualThemeNameValid(draft);
    const apply = () => {
        if (applyThemeDraft()) log(`已应用主题：${safeDraft.dark.name} / ${safeDraft.light.name}`);
    };

    return (
        <div data-testid="theme-park" className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
                <Palette size={16} className="text-amber-400" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100">主题编辑器</div>
                    <div className="truncate text-[11px] text-zinc-500">
                        {dirty
                            ? `有未应用的修改 · 预览显示的是草稿（${MODE_LABELS[mode]}）`
                            : `工程主题：${project.dual[project.variant].name}（${SOURCE_LABELS[project.source]}，${MODE_LABELS[project.variant]}）`}
                    </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => replaceThemeDraft(randomTheme(safeDraft))} title="随机抽一组配色（深色、浅色一起换，名字跟着换；关键字与图标保留）。点「应用」才写进工程">
                    <Dices size={13} /> 随机配色
                </Button>
                <Button size="sm" variant="ghost" onClick={resetThemeDraftColors} title="四个颜色换回默认主题的（名字、描述、关键字与图标保留）">
                    <RotateCcw size={13} /> 默认配色
                </Button>
                <Button size="sm" variant="ghost" onClick={revertThemeDraft} disabled={!dirty}>
                    <Undo2 size={13} /> 放弃修改
                </Button>
                <Button size="sm" variant="primary" onClick={apply} disabled={!dirty || !nameValid} title={nameValid ? '写进工程（可以撤销）' : '深色、浅色主题都需要名字'}>
                    <Check size={13} /> 应用
                </Button>
            </header>

            <div role="tablist" aria-label="主题编辑器" className="flex shrink-0 gap-1 border-b border-zinc-800 px-3">
                {TABS.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.id}
                        onClick={() => setThemeParkTab(item.id)}
                        className={cx('border-b-2 px-3 py-2 text-xs', tab === item.id ? 'border-amber-400 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300')}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-md px-4 py-4">
                    {tab === 'colors' && (
                        <ThemeParkColorPanel
                            mode={mode}
                            colorKey={colorKey}
                            draft={draft}
                            safeDraft={safeDraft}
                            recommended={recommended}
                            onModeChange={setThemeParkMode}
                            onColorKeyChange={setThemeParkColorKey}
                            onColor={setThemeColor}
                            onHexInput={value => patchThemeMode({ [colorKey]: value })}
                        />
                    )}
                    {tab === 'details' && <ThemeParkDetailsPanel draft={draft} onChange={(target, patch) => patchThemeMode(patch, target)} />}
                    {tab === 'content' && (
                        <ThemeParkContentPanel
                            wordColors={draft.dark.wordColors ?? []}
                            lyricsIcons={draft.dark.lyricsIcons ?? []}
                            accentColor={safeDraft[mode].accentColor}
                            onWordColorsChange={wordColors => patchThemeShared({ wordColors })}
                            onLyricsIconsChange={lyricsIcons => patchThemeShared({ lyricsIcons })}
                        />
                    )}
                    {tab === 'ai' && <ThemeParkAiPanel buildTheme={() => resolvedThemeDraft(draft)} onImport={replaceThemeDraft} />}
                </div>
            </div>
        </div>
    );
}
