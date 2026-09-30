// src/app/wizard/randomTheme.ts
// 随机配色（骰子）：随机取一个色相与一种配色关系（邻近 / 互补 / 分裂互补 / 三色），
// 按深 / 浅两种底色定明度与饱和度，再核对对比度——正文对背景至少 7:1，强调色至少 4.5:1，次要色至少 3:1，
// 不够就把明度往远离背景的方向推。关键字颜色、歌词图标来自歌词，沿用传进来的主题。
import type { DualTheme, Theme } from '@/core/types';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@/project/defaults';
import { contrastRatio, hslToHex } from './coverTheme';

type Random = () => number;

const HARMONIES = [
    { name: '邻近', offsets: [30, -30] },
    { name: '互补', offsets: [180, 180] },
    { name: '分裂互补', offsets: [150, 210] },
    { name: '三色', offsets: [120, 240] },
] as const;

const HUE_NAMES: Array<[number, string]> = [
    [15, '朱红'], [40, '橙'], [55, '琥珀'], [70, '金'], [95, '青柠'], [140, '绿'], [170, '翠'],
    [195, '青'], [215, '天蓝'], [245, '蓝'], [270, '靛'], [295, '紫'], [325, '品红'], [350, '玫红'], [360, '朱红'],
];

export const hueName = (hue: number) => HUE_NAMES.find(([limit]) => ((hue % 360) + 360) % 360 < limit)?.[1] ?? '朱红';

const between = (random: Random, min: number, max: number) => min + random() * (max - min);
const wrap = (hue: number) => ((hue % 360) + 360) % 360;

/** 明度往远离背景的方向推，直到对比度够（最多推到头）。 */
const readable = (h: number, s: number, l: number, background: string, ratio: number, dark: boolean) => {
    let lightness = l;
    for (let i = 0; i < 40; i += 1) {
        const color = hslToHex({ h, s, l: lightness });
        if (contrastRatio(color, background) >= ratio) return color;
        lightness = dark ? Math.min(0.98, lightness + 0.02) : Math.max(0.02, lightness - 0.02);
    }
    return hslToHex({ h, s, l: lightness });
};

export const randomTheme = (current: DualTheme = { dark: DEFAULT_DARK_THEME, light: DEFAULT_LIGHT_THEME }, random: Random = Math.random): DualTheme => {
    const hue = random() * 360;
    const harmony = HARMONIES[Math.floor(random() * HARMONIES.length)];
    const accentHue = wrap(hue + harmony.offsets[0] * (random() < 0.5 ? 0.5 : 1));
    const secondHue = wrap(hue + harmony.offsets[1]);
    const vivid = between(random, 0.55, 0.9);
    const tint = between(random, 0.1, 0.35);
    const label = `随机 · ${hueName(hue)}${harmony.name}`;
    const shared = { wordColors: current.dark.wordColors, lyricsIcons: current.dark.lyricsIcons };

    const darkBackground = hslToHex({ h: hue, s: tint, l: between(random, 0.05, 0.1) });
    const dark: Theme = {
        ...current.dark,
        ...shared,
        name: `${label} · 深色`,
        backgroundColor: darkBackground,
        primaryColor: readable(hue, between(random, 0.05, 0.25), 0.92, darkBackground, 7, true),
        accentColor: readable(accentHue, vivid, between(random, 0.58, 0.7), darkBackground, 4.5, true),
        secondaryColor: readable(secondHue, between(random, 0.2, 0.45), 0.55, darkBackground, 3, true),
        provider: 'Random',
    };
    const lightBackground = hslToHex({ h: hue, s: tint, l: between(random, 0.93, 0.97) });
    const light: Theme = {
        ...current.light,
        ...shared,
        name: `${label} · 浅色`,
        backgroundColor: lightBackground,
        primaryColor: readable(hue, between(random, 0.15, 0.35), 0.13, lightBackground, 7, false),
        accentColor: readable(accentHue, vivid, between(random, 0.36, 0.45), lightBackground, 4.5, false),
        secondaryColor: readable(secondHue, between(random, 0.15, 0.35), 0.38, lightBackground, 3, false),
        provider: 'Random',
    };
    // 描述是写给原来那套配色的，随机出来的不带。
    delete dark.description;
    delete light.description;
    return { dark, light };
};
