import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToHsl, hslToHex, themeFromCover } from '@/app/wizard/coverTheme';

describe('themeFromCover', () => {
    it('round-trips hex through hsl', () => {
        for (const hex of ['#ff8800', '#123456', '#ffffff', '#000000', '#7f7f7f']) {
            expect(hslToHex(hexToHsl(hex)!)).toBe(hex);
        }
    });

    it('takes the hue of the most vivid mid-tone colour and keeps text readable on both sides', () => {
        const theme = themeFromCover(['#101010', '#e0e0e0', '#d94f2b', '#3a5a8c'])!;
        const accentHue = hexToHsl(theme.dark.accentColor)!.h;
        expect(Math.abs(accentHue - hexToHsl('#d94f2b')!.h)).toBeLessThan(4);
        for (const side of [theme.dark, theme.light]) {
            expect(contrastRatio(side.primaryColor, side.backgroundColor)).toBeGreaterThan(7);
            expect(contrastRatio(side.accentColor, side.backgroundColor)).toBeGreaterThan(3);
        }
        // 次要色取另一个色相（蓝）。
        expect(Math.abs(hexToHsl(theme.dark.secondaryColor)!.h - hexToHsl('#3a5a8c')!.h)).toBeLessThan(6);
    });

    it('stays neutral for a grey cover instead of inventing a colour', () => {
        const theme = themeFromCover(['#808080', '#303030', '#c8c8c8'])!;
        expect(hexToHsl(theme.dark.accentColor)!.s).toBeLessThan(0.1);
        expect(contrastRatio(theme.light.primaryColor, theme.light.backgroundColor)).toBeGreaterThan(7);
    });

    it('returns null without usable colours', () => {
        expect(themeFromCover([])).toBeNull();
        expect(themeFromCover(['nope'])).toBeNull();
    });
});
