// src/app/theme-park/themeParkDraft.ts
// 主题编辑器（移植自 folia 的 Theme Park）的纯模型：可编辑的字段、让半成品草稿也能渲染的清洗、
// 保存前的校验，以及推荐色板。
import type { DualTheme, Theme } from '@/core/types';
import { sanitizeDualTheme as sanitizeUntyped } from '@/ai/vendor/themeSanitizer.mjs';

// 清洗器是 folia 原样搬来的 .mjs（不做类型检查），推断出的回退主题类型太窄：这里给它一个真实的签名。
const sanitizeDualTheme = sanitizeUntyped as unknown as (value: unknown, fallback: DualTheme) => DualTheme;

export type EditableMode = 'light' | 'dark';
export type EditableColorKey = 'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor';
export type ThemeParkTab = 'colors' | 'details' | 'content' | 'ai';
export type WordColorEntry = { word: string; color: string };

export const THEME_NAME_MAX_LENGTH = 32;
export const THEME_DESCRIPTION_MAX_LENGTH = 120;
/** 与清洗器的上限一致：编辑器造不出会被截掉的主题。 */
export const LYRICS_ICON_LIMIT = 12;
export const WORD_COLOR_LIMIT = 40;
export const RECOMMENDED_COLOR_LIMIT = 12;

export const COLOR_FIELDS: Array<{ key: EditableColorKey; label: string; description: string }> = [
    { key: 'backgroundColor', label: '背景', description: '整个画面的底色' },
    { key: 'primaryColor', label: '主色', description: '歌词正文与主要图形' },
    { key: 'accentColor', label: '强调', description: '高亮、点亮的字与光' },
    { key: 'secondaryColor', label: '次要', description: '辅助图形、未唱到的字' },
];

export const MODE_LABELS: Record<EditableMode, string> = { dark: '深色', light: '浅色' };

const withMetadata = (theme: Theme, fallbackName: string): Theme => ({
    ...theme,
    name: theme.name?.trim() || fallbackName,
    wordColors: theme.wordColors ?? [],
    lyricsIcons: theme.lyricsIcons ?? [],
    description: theme.description ?? '',
});

/**
 * 让写到一半的草稿（空名字、没填完的色值）也能拿去渲染，同时不丢用户正在输入的内容：
 * 原始草稿照旧保存在编辑器里，只有预览和保存用这份清洗过的。
 */
export const normalizeThemeDraft = (draft: DualTheme, fallback: DualTheme = draft): DualTheme => {
    const named = (dual: DualTheme): DualTheme => ({
        light: withMetadata(dual.light, '自定义浅色'),
        dark: withMetadata(dual.dark, '自定义深色'),
    });
    return sanitizeDualTheme(named(draft), named(fallback));
};

export const isThemeNameValid = (name: string) => {
    const trimmed = name.trim();
    return trimmed.length > 0 && trimmed.length <= THEME_NAME_MAX_LENGTH;
};

export const isDualThemeNameValid = (dual: DualTheme) => isThemeNameValid(dual.light.name ?? '') && isThemeNameValid(dual.dark.name ?? '');

export const patchDualThemeMode = (dual: DualTheme, mode: EditableMode, patch: Partial<Theme>): DualTheme => ({
    ...dual,
    [mode]: { ...dual[mode], ...patch },
});

/** 关键字颜色与歌词图标描述的是歌，不是深浅底色：两边始终一样（AI 的输出契约也是如此）。 */
export const patchDualThemeShared = (dual: DualTheme, patch: Partial<Theme>): DualTheme => ({
    light: { ...dual.light, ...patch },
    dark: { ...dual.dark, ...patch },
});

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#abc` / `#AABBCC` → `#aabbcc`；不是颜色时返回 null。 */
export const normalizePaletteColor = (color: string) => {
    const trimmed = typeof color === 'string' ? color.trim() : '';
    if (!HEX_COLOR.test(trimmed)) return null;
    const hex = trimmed.slice(1).toLowerCase();
    return hex.length === 3 ? `#${[...hex].map(char => char + char).join('')}` : `#${hex}`;
};

const themeColors = (dual: DualTheme) => (['light', 'dark'] as const).flatMap(mode => COLOR_FIELDS.map(field => dual[mode][field.key]));

/** 推荐色：封面取色在前（一键就能用上封面自己的颜色），然后是主题现有的八个颜色，去重。 */
export const buildRecommendedColors = (dual: DualTheme, coverColors: string[]) => {
    const seen = new Set<string>();
    return [...coverColors, ...themeColors(dual)].flatMap(color => {
        const normalized = normalizePaletteColor(color);
        if (!normalized || seen.has(normalized)) return [];
        seen.add(normalized);
        return [normalized];
    }).slice(0, RECOMMENDED_COLOR_LIMIT);
};

/** 两份主题在编辑器能改到的字段上是否一样（判断有没有未应用的修改）。 */
export const sameEditableTheme = (a: DualTheme, b: DualTheme) => (['light', 'dark'] as const).every(mode => {
    const x = a[mode];
    const y = b[mode];
    return COLOR_FIELDS.every(field => x[field.key] === y[field.key])
        && (x.name ?? '') === (y.name ?? '')
        && (x.description ?? '') === (y.description ?? '')
        && JSON.stringify(x.wordColors ?? []) === JSON.stringify(y.wordColors ?? [])
        && JSON.stringify(x.lyricsIcons ?? []) === JSON.stringify(y.lyricsIcons ?? []);
});
