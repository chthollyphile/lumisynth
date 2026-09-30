// 随机配色：每一次都读得清（正文 7:1、强调 4.5:1、次要 3:1），关键字颜色与图标沿用，同一个随机流结果相同。
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/app/wizard/coverTheme';
import { hueName, randomTheme } from '@/app/wizard/randomTheme';
import { createRng } from '@/core/rng';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';

const current = {
    dark: { ...DEFAULT_DARK_THEME, description: '原来的描述', wordColors: [{ word: '光', color: '#ffcc00' }], lyricsIcons: ['Sun'] },
    light: { ...DEFAULT_LIGHT_THEME, wordColors: [{ word: '光', color: '#ffcc00' }], lyricsIcons: ['Sun'] },
};

describe('randomTheme', () => {
    it('keeps every roll readable on both backgrounds', () => {
        for (let seed = 0; seed < 200; seed += 1) {
            const dual = randomTheme(current, createRng(seed));
            for (const theme of [dual.dark, dual.light]) {
                expect(contrastRatio(theme.primaryColor, theme.backgroundColor), `${seed} ${theme.name}`).toBeGreaterThanOrEqual(7);
                expect(contrastRatio(theme.accentColor, theme.backgroundColor), `${seed} ${theme.name}`).toBeGreaterThanOrEqual(4.5);
                expect(contrastRatio(theme.secondaryColor, theme.backgroundColor), `${seed} ${theme.name}`).toBeGreaterThanOrEqual(3);
                expect(theme.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    it('keeps the lyric-derived keywords and icons, drops the old description, and is reproducible', () => {
        const dual = randomTheme(current, createRng('x'));
        expect(dual.dark).toMatchObject({ provider: 'Random', wordColors: current.dark.wordColors, lyricsIcons: ['Sun'] });
        expect(dual.light.lyricsIcons).toEqual(['Sun']);
        expect(dual.dark.description).toBeUndefined();
        expect(dual.dark.name).toMatch(/^随机 · .+ · 深色$/);
        expect(randomTheme(current, createRng('x'))).toEqual(dual);
        expect(randomTheme(current, createRng('y'))).not.toEqual(dual);
    });

    it('names hues', () => {
        expect(hueName(0)).toBe('朱红');
        expect(hueName(220)).toBe('蓝');
        expect(hueName(359)).toBe('朱红');
    });
});
