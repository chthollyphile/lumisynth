import { describe, expect, it } from 'vitest';
import type { Theme } from '@/packs/_compat/foliaTypes';
import { parseColorChannels } from '@/engine/shared/colorMix';
import { resolveTemperaPalette, scaleChroma } from '@/packs/tempera/temperaPalette';
import { temperaPack } from '@/packs/tempera/pack';

// test/unit/visualizer/temperaPalette.test.ts
// Locks palette determinism, mono grayscale purity, and ink/paper contrast guarantees.
const theme = (overrides: Partial<Theme>): Theme => ({
    backgroundColor: '#101014',
    primaryColor: '#f2f2f0',
    accentColor: '#e1565f',
    secondaryColor: '#4f7fb8',
    ...overrides,
} as Theme);

const channelsOf = (color: string) => {
    const channels = parseColorChannels(color);
    expect(channels).not.toBeNull();
    return channels!;
};

describe('Tempera palette', () => {
    describe('colorful shot palettes', () => {
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const chroma = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return Math.max(r, g, b) - Math.min(r, g, b);
        };
        it('repeats a stable shot key and changes hues for another shot', () => {
            const tuning = { colorMode: 'colorful' as const };
            const first = resolveTemperaPalette(theme({}), tuning, [], 'program:paragraph:shot-a');
            expect(resolveTemperaPalette(theme({}), tuning, [], 'program:paragraph:shot-a')).toEqual(first);
            const second = resolveTemperaPalette(theme({}), tuning, [], 'program:paragraph:shot-b');
            expect([second.blockA, second.blockB, second.blockC, second.accent])
                .not.toEqual([first.blockA, first.blockB, first.blockC, first.accent]);
        });
        it('creates a coordinated four-stop gradient even from an entirely grey theme', () => {
            const palette = resolveTemperaPalette(theme({ backgroundColor: '#202020', primaryColor: '#ededed', accentColor: '#888888', secondaryColor: '#999999' }), { colorMode: 'colorful' });
            const colors = [palette.blockA, palette.blockB, palette.blockC, palette.accent];
            colors.forEach(color => {
                expect(chroma(color)).toBeGreaterThan(35);
                expect(chroma(color)).toBeLessThan(210);
            });
            expect(new Set(colors).size).toBe(4);
            expect(palette.gradient).toEqual(colors);
            expect(palette.textGradient).toBeNull();
            expect(palette.gradient).not.toEqual([palette.tone1, palette.tone2, palette.tone3, palette.tone4]);
        });
        it('keeps adjacent hues on a continuous short path across many shot keys', () => {
            const hueOf = (color: string) => {
                const { r, g, b } = channelsOf(color);
                const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
                return ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
            };
            for (let key = 0; key < 200; key += 1) {
                const ramp = resolveTemperaPalette(theme({}), { colorMode: 'colorful' }, [], key).gradient!;
                expect(ramp).toHaveLength(4);
                const gaps = ramp.slice(1).map((color, index) => {
                    const gap = Math.abs(hueOf(color) - hueOf(ramp[index]));
                    return Math.min(gap, 360 - gap);
                });
                gaps.forEach(gap => expect(gap).toBeLessThan(65));
                expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBeLessThan(125);
            }
        });
        it('preserves ink contrast and the tone ladder across dark/light themes and keys', () => {
            [theme({}), theme({ backgroundColor: '#fbfbf7', primaryColor: '#eeeeee' })].forEach(input => {
                for (let key = 0; key < 30; key += 1) {
                    const palette = resolveTemperaPalette(input, { colorMode: 'colorful' }, [], key);
                    expect(Math.abs(luminance(palette.ink) - luminance(palette.paper))).toBeGreaterThanOrEqual(96);
                    const steps = [palette.paper, palette.tone1, palette.tone2, palette.tone3, palette.tone4, palette.ink].map(luminance);
                    const direction = steps[5] > steps[0] ? 1 : -1;
                    steps.slice(1).forEach((value, index) => expect((value - steps[index]) * direction).toBeGreaterThan(0));
                }
            });
        });
        it('desaturates every derived hue at zero while preserving tone luminance', () => {
            const vivid = resolveTemperaPalette(theme({}), { colorMode: 'colorful' });
            const grey = resolveTemperaPalette(theme({}), { colorMode: 'colorful', colorSaturation: 0 });
            (['blockA', 'blockB', 'blockC', 'accent', 'tone1', 'tone2', 'tone3', 'tone4'] as const).forEach(key => {
                expect(chroma(grey[key])).toBe(0);
                expect(Math.abs(luminance(grey[key]) - luminance(vivid[key]))).toBeLessThan(1.5);
            });
            expect([grey.paper, grey.ink]).toEqual([vivid.paper, vivid.ink]);
            grey.gradient!.forEach((color, index) => {
                expect(chroma(color)).toBe(0);
                expect(Math.abs(luminance(color) - luminance(vivid.gradient![index]))).toBeLessThan(1.5);
            });
            expect(resolveTemperaPalette(theme({}), { colorMode: 'colorful', colorSaturation: 2.5 })).toEqual(vivid);
        });
        it('does not let shot keys change the existing modes', () => {
            (['duo', 'mono', 'gradient'] as const).forEach(colorMode => {
                expect(resolveTemperaPalette(theme({}), { colorMode }, ['#c94f6d', '#2f6f8f'], 'a'))
                    .toEqual(resolveTemperaPalette(theme({}), { colorMode }, ['#c94f6d', '#2f6f8f'], 'b'));
            });
        });
        it('defaults to colorful, preserves saved modes and rejects unknown modes', () => {
            (['duo', 'mono', 'gradient', 'colorful'] as const).forEach(colorMode => {
                expect(temperaPack.tuning.normalize({ colorMode }).colorMode).toBe(colorMode);
            });
            expect(temperaPack.tuning.normalize({}).colorMode).toBe('colorful');
            expect(temperaPack.tuning.normalize({ colorMode: 'unknown' }).colorMode).toBe('colorful');
        });
    });
    it('is deterministic for the same theme and color mode', () => {
        const input = theme({});
        expect(resolveTemperaPalette(input, { colorMode: 'duo' }))
            .toEqual(resolveTemperaPalette(input, { colorMode: 'duo' }));
        expect(resolveTemperaPalette(input, { colorMode: 'mono' }))
            .toEqual(resolveTemperaPalette(input, { colorMode: 'mono' }));
    });

    it('derives duo blocks from theme hues rather than grayscale', () => {
        const palette = resolveTemperaPalette(theme({}), { colorMode: 'duo' });
        const blockA = channelsOf(palette.blockA);
        const blockB = channelsOf(palette.blockB);
        // Hue-carrying mixes must not collapse to r === g === b.
        expect(new Set([blockA.r, blockA.g, blockA.b]).size).toBeGreaterThan(1);
        expect(new Set([blockB.r, blockB.g, blockB.b]).size).toBeGreaterThan(1);
        expect(palette.accent).toBe('#e1565f');
    });

    it('collapses every mono step to a true grayscale ladder', () => {
        const palette = resolveTemperaPalette(theme({ accentColor: '#ff2200' }), { colorMode: 'mono' });
        [palette.paper, palette.ink, palette.blockA, palette.blockB, palette.blockC, palette.accent]
            .forEach(color => {
                const { r, g, b } = channelsOf(color);
                expect(r).toBe(g);
                expect(g).toBe(b);
            });
        // The ladder stays ordered from paper toward ink.
        const paperL = channelsOf(palette.paper).r;
        const inkL = channelsOf(palette.ink).r;
        const steps = [palette.blockA, palette.blockB, palette.blockC].map(color => channelsOf(color).r);
        steps.forEach(step => {
            expect(step).toBeGreaterThanOrEqual(Math.min(paperL, inkL));
            expect(step).toBeLessThanOrEqual(Math.max(paperL, inkL));
        });
    });

    it('forces legible mono contrast when the themed ink is a mid-tone color', () => {
        const palette = resolveTemperaPalette(theme({
            backgroundColor: '#202020',
            primaryColor: '#7a7a7a',
        }), { colorMode: 'mono' });
        const paperL = channelsOf(palette.paper).r;
        const inkL = channelsOf(palette.ink).r;
        expect(Math.abs(inkL - paperL)).toBeGreaterThanOrEqual(96);
    });

    it('builds a tone ladder that steps monotonically from paper toward ink', () => {
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        // Both a dark-on-light and a light-on-dark theme must keep the ladder ordered.
        ([
            theme({}),
            theme({ backgroundColor: '#fbfbf7', primaryColor: '#151515' }),
        ] as const).forEach(input => {
            (['duo', 'mono'] as const).forEach(colorMode => {
                const palette = resolveTemperaPalette(input, { colorMode });
                const steps = [palette.paper, palette.tone1, palette.tone2, palette.tone3, palette.tone4, palette.ink]
                    .map(luminance);
                const rising = luminance(palette.ink) > luminance(palette.paper);
                for (let index = 1; index < steps.length; index += 1) {
                    if (rising) expect(steps[index]).toBeGreaterThan(steps[index - 1]);
                    else expect(steps[index]).toBeLessThan(steps[index - 1]);
                }
            });
        });
    });

    it('keeps mono tones grayscale while duo tones carry theme hue', () => {
        const mono = resolveTemperaPalette(theme({}), { colorMode: 'mono' });
        [mono.tone1, mono.tone2, mono.tone3, mono.tone4].forEach(color => {
            const { r, g, b } = channelsOf(color);
            expect(r).toBe(g);
            expect(g).toBe(b);
        });

        const duo = resolveTemperaPalette(theme({}), { colorMode: 'duo' });
        [duo.tone1, duo.tone2, duo.tone3].forEach(color => {
            const { r, g, b } = channelsOf(color);
            expect(new Set([r, g, b]).size).toBeGreaterThan(1);
        });
    });

    it('forces duo ink to contrast when the theme pairs a pale primary with pale paper', () => {
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        // The exact failure from the screenshot: near-white paper, pale mint primary.
        const palette = resolveTemperaPalette(theme({
            backgroundColor: '#efe8ec',
            primaryColor: '#dcf2ea',
        }), { colorMode: 'duo' });

        expect(palette.ink).not.toBe('#dcf2ea');
        expect(Math.abs(luminance(palette.ink) - luminance(palette.paper))).toBeGreaterThanOrEqual(96);
        // The whole ladder rides on the corrected ink, so the graphics gain contrast too.
        expect(Math.abs(luminance(palette.tone4) - luminance(palette.paper))).toBeGreaterThan(40);
    });

    it('leaves a theme that already contrasts untouched', () => {
        const palette = resolveTemperaPalette(theme({
            backgroundColor: '#fbfbf7',
            primaryColor: '#151515',
        }), { colorMode: 'duo' });
        expect(palette.ink).toBe('#151515');
    });

    it('builds a four-colour cover ramp in gradient mode, ordered paper -> ink', () => {
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const cover = ['#c94f6d', '#2f6f8f', '#e8c46a', '#3d3a52', '#8fbf7a'];
        const palette = resolveTemperaPalette(theme({}), { colorMode: 'gradient' }, cover);

        expect(palette.gradient).toHaveLength(4);
        expect(palette.gradient).toEqual([palette.tone1, palette.tone2, palette.tone3, palette.tone4]);
        // The ramp still has to climb from paper toward ink, or the composition loses its
        // tonal structure and the inversion filter loses its reference.
        const steps = palette.gradient!.map(luminance);
        const rising = luminance(palette.ink) > luminance(palette.paper);
        for (let index = 1; index < steps.length; index += 1) {
            if (rising) expect(steps[index]).toBeGreaterThan(steps[index - 1]);
            else expect(steps[index]).toBeLessThan(steps[index - 1]);
        }
        // Cover hue actually lands: the ramp must not collapse to grey.
        expect(palette.gradient!.some(color => {
            const { r, g, b } = channelsOf(color);
            return new Set([r, g, b]).size > 1;
        })).toBe(true);
    });

    it('falls back to theme hues when there is no cover art yet', () => {
        const withoutCover = resolveTemperaPalette(theme({}), { colorMode: 'gradient' });
        expect(withoutCover.gradient).toHaveLength(4);
        expect(withoutCover).toEqual(resolveTemperaPalette(theme({}), { colorMode: 'gradient' }, []));
        // A single extracted colour is not enough to build a ramp from; theme hues win.
        expect(resolveTemperaPalette(theme({}), { colorMode: 'gradient' }, ['#ff0000']))
            .toEqual(withoutCover);
    });

    it('leaves the flat colour modes without a gradient ramp', () => {
        (['duo', 'mono'] as const).forEach(colorMode => {
            const palette = resolveTemperaPalette(theme({}), { colorMode });
            expect(palette.gradient).toBeNull();
            expect(palette.textGradient).toBeNull();
        });
    });

    it('mixes the theme into the cover ramp instead of replacing it', () => {
        const cover = ['#c94f6d', '#2f6f8f', '#e8c46a', '#3d3a52'];
        const warm = resolveTemperaPalette(theme({ accentColor: '#ff8800' }), { colorMode: 'gradient' }, cover);
        const cool = resolveTemperaPalette(theme({ accentColor: '#0088ff' }), { colorMode: 'gradient' }, cover);
        // Same artwork, different theme: the ramp has to move, or the mode is ignoring the
        // user's palette exactly when it is most visible.
        expect(warm.gradient).not.toEqual(cool.gradient);
        expect(warm.textGradient).not.toEqual(cool.textGradient);

        // ...but the cover still dominates: the ramp is nowhere near the raw theme hue.
        const channels = channelsOf(warm.textGradient![0]);
        const accent = channelsOf('#ff8800');
        const distance = Math.abs(channels.r - accent.r) + Math.abs(channels.g - accent.g) + Math.abs(channels.b - accent.b);
        expect(distance).toBeGreaterThan(60);
    });

    it('keeps the text ramp vivid while the background ramp stays on the tone ladder', () => {
        const chroma = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return Math.max(r, g, b) - Math.min(r, g, b);
        };
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const cover = ['#c94f6d', '#2f6f8f', '#e8c46a', '#3d3a52'];
        const palette = resolveTemperaPalette(theme({}), { colorMode: 'gradient' }, cover);

        expect(palette.textGradient).toHaveLength(4);
        // The type is what carries the cover's colour, so it must not be flattened onto the
        // paper -> ink ladder the way the background ramp is.
        const textChroma = palette.textGradient!.map(chroma);
        const blockChroma = palette.gradient!.map(chroma);
        expect(Math.max(...textChroma)).toBeGreaterThan(Math.max(...blockChroma));
        // ...but every text colour still has to clear the paper.
        palette.textGradient!.forEach(color => {
            expect(Math.abs(luminance(color) - luminance(palette.paper))).toBeGreaterThanOrEqual(88);
        });
    });

    it('keeps duo anchored to the themed paper and ink', () => {
        const palette = resolveTemperaPalette(theme({}), { colorMode: 'duo' });
        expect(palette.paper).toBe('#101014');
        expect(palette.ink).toBe('#f2f2f0');
    });

    describe('colour saturation (lumisynth)', () => {
        const luminance = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return r * 0.2126 + g * 0.7152 + b * 0.0722;
        };
        const chroma = (color: string) => {
            const { r, g, b } = channelsOf(color);
            return Math.max(r, g, b) - Math.min(r, g, b);
        };

        it('leaves the palette untouched at ×1', () => {
            (['duo', 'gradient'] as const).forEach(colorMode => {
                expect(resolveTemperaPalette(theme({}), { colorMode, colorSaturation: 1 }))
                    .toEqual(resolveTemperaPalette(theme({}), { colorMode }));
            });
        });

        it('raises chroma without moving luminance, so the tone ladder keeps its order', () => {
            const plain = resolveTemperaPalette(theme({}), { colorMode: 'duo' });
            const vivid = resolveTemperaPalette(theme({}), { colorMode: 'duo', colorSaturation: 2.5 });
            (['blockA', 'blockB', 'tone1', 'tone2', 'tone3'] as const).forEach(key => {
                expect(Math.abs(luminance(vivid[key]) - luminance(plain[key])), key).toBeLessThan(1.5);
                expect(chroma(vivid[key]), key).toBeGreaterThan(chroma(plain[key]));
            });
            const tones = [vivid.paper, vivid.tone1, vivid.tone2, vivid.tone3, vivid.tone4, vivid.ink].map(luminance);
            tones.slice(1).forEach((value, index) => expect(value).toBeGreaterThanOrEqual(tones[index] - 1.5));
            // 主题自己的颜色不动。
            expect([vivid.paper, vivid.ink, vivid.accent]).toEqual([plain.paper, plain.ink, plain.accent]);
        });

        it('goes grey at ×0 and never clips a channel', () => {
            const grey = resolveTemperaPalette(theme({}), { colorMode: 'duo', colorSaturation: 0 });
            [grey.blockA, grey.blockB, grey.tone2].forEach(color => expect(chroma(color)).toBeLessThanOrEqual(1));
            const bright = scaleChroma('#ffd21e', 3);
            const { r, g, b } = channelsOf(bright);
            [r, g, b].forEach(value => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(255); });
            expect(Math.abs(luminance(bright) - luminance('#ffd21e'))).toBeLessThan(1.5);
        });
    });
});
