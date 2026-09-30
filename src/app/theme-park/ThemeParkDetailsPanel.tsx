// src/app/theme-park/ThemeParkDetailsPanel.tsx
// 「详情」页：深色、浅色各自的名字与氛围描述。
import type { DualTheme } from '@/core/types';
import { cx, inputClass } from '../ui';
import { isThemeNameValid, MODE_LABELS, THEME_DESCRIPTION_MAX_LENGTH, THEME_NAME_MAX_LENGTH, type EditableMode } from './themeParkDraft';

export function ThemeParkDetailsPanel({
    draft,
    onChange,
}: {
    draft: DualTheme;
    onChange: (mode: EditableMode, patch: { name?: string; description?: string }) => void;
}) {
    return (
        <div className="space-y-4">
            {(['dark', 'light'] as const).map(mode => {
                const name = draft[mode].name ?? '';
                const description = draft[mode].description ?? '';
                const invalid = !isThemeNameValid(name);
                return (
                    <div key={mode} className="space-y-2.5 rounded-md border border-zinc-800 p-3">
                        <div className="text-sm text-zinc-100">{MODE_LABELS[mode]}</div>
                        <label className="block space-y-1">
                            <span className="flex justify-between text-[11px] text-zinc-500">
                                <span>名字</span>
                                <span className={cx('font-mono', invalid && 'text-red-400')}>{name.trim().length}/{THEME_NAME_MAX_LENGTH}</span>
                            </span>
                            <input
                                aria-label={`${MODE_LABELS[mode]}主题名字`}
                                value={name}
                                maxLength={THEME_NAME_MAX_LENGTH}
                                onChange={event => onChange(mode, { name: event.target.value })}
                                spellCheck={false}
                                className={cx(inputClass, 'select-text', invalid && 'border-red-500/60')}
                            />
                        </label>
                        <label className="block space-y-1">
                            <span className="flex justify-between text-[11px] text-zinc-500">
                                <span>氛围描述</span>
                                <span className="font-mono">{description.length}/{THEME_DESCRIPTION_MAX_LENGTH}</span>
                            </span>
                            <textarea
                                aria-label={`${MODE_LABELS[mode]}主题描述`}
                                value={description}
                                maxLength={THEME_DESCRIPTION_MAX_LENGTH}
                                rows={3}
                                placeholder="一句话描述这首歌给人的感觉"
                                onChange={event => onChange(mode, { description: event.target.value })}
                                className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none select-text focus:border-amber-400/70"
                            />
                        </label>
                    </div>
                );
            })}
            <div className="text-[11px] leading-relaxed text-zinc-500">名字会显示在侧栏的主题分组里；两边的名字都不能为空才能应用。</div>
        </div>
    );
}
