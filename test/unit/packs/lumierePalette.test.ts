// test/unit/packs/lumierePalette.test.ts
// 绘光调色盘的主题色占比：0 与原来的香槟金光一致，越高越跟随主题（光色 ← 强调色，点亮字 ← 主色，未唱字 ← 次色），
// 主题色先按最亮通道拉满再混，所以深色的主题色也不会画成暗块。与 folia 的同名测试一致。
import { describe, expect, it } from 'vitest';
import { resolveLumierePalette } from '@/packs/lumiere/scene';

type ThemeArg = Parameters<typeof resolveLumierePalette>[0];

const full = {
    backgroundColor: '#0b0d12', accentColor: '#3050c0', primaryColor: '#e05080', secondaryColor: '#205040',
} as ThemeArg;
const hue = (rgb: readonly number[]) => {
    const peak = Math.max(...rgb);
    return rgb.map(channel => channel / peak);
};

describe('绘光的主题色占比', () => {
    it('占比 0 与原来的香槟金光一致（强调色只掺 18%）', () => {
        const palette = resolveLumierePalette(full, 0);
        expect(palette).toEqual(resolveLumierePalette(full));
        expect(palette.light[0]).toBeCloseTo(1);
        expect(palette.light[2]).toBeLessThan(palette.light[0]);
    });

    it('占比 1：光色是强调色的色相，点亮字跟主色，未唱字跟次色，而且都拉到发光的亮度', () => {
        const palette = resolveLumierePalette(full, 1);
        const accent = hue([0x30, 0x50, 0xc0]);
        palette.light.forEach((channel, index) => expect(channel).toBeCloseTo(accent[index]!, 5));
        expect(palette.lit[0]).toBeGreaterThan(palette.lit[1]!);
        expect(palette.lit[0]).toBeGreaterThan(palette.lit[2]!);
        expect(Math.max(...palette.lit)).toBeCloseTo(1);
        expect(palette.unlit[1]).toBeGreaterThan(palette.unlit[0]!);
    });

    it('占比越高越接近主题色，随占比连续变化；越界钳到 0..1', () => {
        const at = (mix: number) => resolveLumierePalette(full, mix).light;
        const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
        const target = at(1);
        expect(distance(at(0.3), target)).toBeLessThan(distance(at(0), target));
        expect(distance(at(0.7), target)).toBeLessThan(distance(at(0.3), target));
        expect(distance(at(0.5), at(0.51))).toBeLessThan(0.02);
        expect(resolveLumierePalette(full, 2)).toEqual(resolveLumierePalette(full, 1));
        expect(resolveLumierePalette(full, -1)).toEqual(resolveLumierePalette(full, 0));
    });

    it('没有次色时未唱字跟主色；近黑的主题色退回原来的暖色，不画成暗块', () => {
        const primaryOnly = resolveLumierePalette({ ...full, secondaryColor: '' }, 1);
        expect(primaryOnly.unlit[0]).toBeGreaterThan(primaryOnly.unlit[1]!);
        const black = resolveLumierePalette({ ...full, primaryColor: '#000000' }, 1);
        expect(Math.max(...black.lit)).toBeGreaterThan(0.9);
    });

    it('暗场底不受占比影响（只由背景色决定）', () => {
        const bright = { ...full, backgroundColor: '#f4efe6' };
        expect(resolveLumierePalette(bright, 1).dark).toEqual(resolveLumierePalette(bright, 0).dark);
    });
});
