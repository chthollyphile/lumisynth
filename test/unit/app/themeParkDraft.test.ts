import { describe, expect, it } from 'vitest';
import type { DualTheme } from '@/core/types';
import { parseAiThemeJsonInput } from '@/ai/themePrompt';
import {
    buildRecommendedColors,
    isDualThemeNameValid,
    normalizePaletteColor,
    normalizeThemeDraft,
    patchDualThemeMode,
    patchDualThemeShared,
    sameEditableTheme,
} from '@/app/theme-park/themeParkDraft';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';

const base: DualTheme = { light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME };

describe('theme park draft', () => {
    it('keeps a half-typed draft renderable: bad hex falls back, empty name gets a placeholder', () => {
        const draft = patchDualThemeMode(base, 'dark', { accentColor: '#12', name: '  ' });
        const safe = normalizeThemeDraft(draft, base);
        expect(safe.dark.accentColor).toBe(base.dark.accentColor);
        expect(safe.dark.name).toBe('自定义深色');
        expect(safe.light).toMatchObject({ backgroundColor: base.light.backgroundColor });
        // 原始草稿不被改动（输入框里仍是用户输入的内容）。
        expect(draft.dark.accentColor).toBe('#12');
    });

    it('requires both names, within the length limit', () => {
        expect(isDualThemeNameValid(base)).toBe(true);
        expect(isDualThemeNameValid(patchDualThemeMode(base, 'light', { name: ' ' }))).toBe(false);
        expect(isDualThemeNameValid(patchDualThemeMode(base, 'light', { name: 'x'.repeat(33) }))).toBe(false);
    });

    it('writes word colours and icons to both sides; the sanitizer drops empty keywords', () => {
        const shared = patchDualThemeShared(base, { wordColors: [{ word: '雨', color: '#3366ff' }, { word: '', color: '#ff0000' }], lyricsIcons: ['Moon'] });
        expect(shared.light.lyricsIcons).toEqual(['Moon']);
        expect(shared.dark.wordColors).toHaveLength(2);
        expect(normalizeThemeDraft(shared).dark.wordColors).toEqual([{ word: '雨', color: '#3366ff' }]);
    });

    it('recommends cover colours first, normalised and deduplicated, then the theme colours', () => {
        const colors = buildRecommendedColors(base, ['#ABC', '#aabbcc', 'not-a-color', base.dark.backgroundColor]);
        expect(colors[0]).toBe('#aabbcc');
        expect(colors.filter(color => color === '#aabbcc')).toHaveLength(1);
        expect(colors).toContain(base.light.accentColor.toLowerCase());
        expect(colors.length).toBeLessThanOrEqual(12);
        expect(normalizePaletteColor('#F0a')).toBe('#ff00aa');
    });

    it('compares only the fields the editor can change', () => {
        expect(sameEditableTheme(base, { light: { ...base.light }, dark: { ...base.dark } })).toBe(true);
        expect(sameEditableTheme(base, patchDualThemeMode(base, 'light', { description: 'x' }))).toBe(false);
        expect(sameEditableTheme(base, patchDualThemeShared(base, { lyricsIcons: ['Sun'] }))).toBe(false);
    });
});

describe('parseAiThemeJsonInput', () => {
    const json = JSON.stringify({ light: { name: 'a' }, dark: { name: 'b' } });

    it('accepts raw JSON, fenced JSON and JSON wrapped in prose', () => {
        expect(parseAiThemeJsonInput(json).dark).toEqual({ name: 'b' });
        expect(parseAiThemeJsonInput(`好的：\n\`\`\`json\n${json}\n\`\`\``).light).toEqual({ name: 'a' });
        expect(parseAiThemeJsonInput(`结果如下 ${json} 希望喜欢`).light).toEqual({ name: 'a' });
    });

    it('skips braces inside strings when looking for the object', () => {
        const tricky = JSON.stringify({ light: { name: 'a}b' }, dark: { name: '{c' } });
        expect(parseAiThemeJsonInput(`前言 ${tricky} 后记`).light).toEqual({ name: 'a}b' });
    });

    it('rejects objects without both sides', () => {
        expect(() => parseAiThemeJsonInput('{"light": {}}')).toThrow();
        expect(() => parseAiThemeJsonInput('not json')).toThrow();
    });
});
