import { describe, expect, it } from 'vitest';
import * as pixi from 'pixi.js';
import type { Theme } from '@/core/types';
import { buildBackground, buildSubtitleLayer } from '@/kernel/layers';
import { DEFAULT_KERNEL_TUNING } from '@/kernel/tuning';

// test/unit/kernel/kernelGpuRelease.test.ts
// 内核自己画的层（背景底色 / 压暗、译文字幕的光晕）换 look 时重建，旧层里 Graphics 自建的 context 要当场销毁，
// 不能靠 destroy({ children: true })——它不销毁 Graphics 自建的 context，GPU 批数据要等 Pixi 的 GC 空闲 60 秒才收。

const theme = { backgroundColor: '#102030', secondaryColor: '#e0e0e0' } as Theme;

const graphicsIn = (container: pixi.Container): pixi.Graphics[] => container.children
    .flatMap(child => (child instanceof pixi.Graphics ? [child] : graphicsIn(child)));

describe('内核图层销毁时放掉 Graphics 的 context', () => {
    it('背景：底色与封面压暗层的 context 随图层销毁，封面纹理不动', () => {
        const cover = new pixi.Texture();
        const layer = buildBackground(pixi, 1600, 900, theme, { mode: 'cover', coverBlur: 0, coverDim: 0.5 }, cover, 1);
        const contexts = graphicsIn(layer.container).map(graphics => graphics.context);
        expect(contexts).toHaveLength(2);
        layer.destroy();
        expect(contexts.every(context => context.destroyed)).toBe(true);
        expect(cover.destroyed).toBe(false);
    });

    it('译文字幕：光晕的 context 随图层销毁', () => {
        // filter 编着色器要 WebGL 上下文，node 里没有；只替换它们，Graphics 与文字用真的 Pixi。
        class HeadlessFilter {
            destroyed = false;
            destroy() { this.destroyed = true; }
        }
        const headless = { ...pixi, BlurFilter: HeadlessFilter, Filter: HeadlessFilter, GlProgram: { from: () => null } } as unknown as typeof pixi;
        const layer = buildSubtitleLayer(headless, 1600, 900, theme, DEFAULT_KERNEL_TUNING.subtitles, []);
        const contexts = graphicsIn(layer.container).map(graphics => graphics.context);
        expect(contexts).toHaveLength(1);
        const [contrast] = layer.container.filters as unknown as HeadlessFilter[];
        layer.destroy();
        expect(contexts.every(context => context.destroyed)).toBe(true);
        expect(contrast.destroyed).toBe(true);
    });
});
