// src/kernel/layers.ts
// 内核自己画的层：背景、唯一的后处理链、译文字幕、擦除色块。
import type { Line, Theme } from '@/core/types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '@/engine/shared/fontStacks';
import { destroyPixiDisplayTree } from '@/engine/shared/pixiDisplayResources';
import { createSonnetLensFilter } from '@/packs/sonnet/sonnetLensFilter';
import { createSonnetPrintFilters } from '@/packs/sonnet/sonnetPrintFilters';
import type { KernelTuning } from './tuning';

type PixiModule = typeof import('pixi.js');
type Container = import('pixi.js').Container;
type Filter = import('pixi.js').Filter;

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

// ---------------------------------------------------------------------------------------------
// 背景：必须画在 Pixi 里——tempera 的镂空构图要透出它，文字反色要读到它，导出也要包含它。

export interface BackgroundLayer {
    container: Container;
    destroy: () => void;
}

export const buildBackground = (
    pixi: PixiModule,
    width: number,
    height: number,
    theme: Theme,
    tuning: KernelTuning['background'],
    cover: import('pixi.js').Texture | null,
    renderResolution: number,
): BackgroundLayer => {
    const container = new pixi.Container();
    const filters: Filter[] = [];
    container.addChild(new pixi.Graphics().rect(0, 0, width, height).fill({ color: colorNumber(pixi, theme.backgroundColor) }));
    if (tuning.mode === 'cover' && cover) {
        const sprite = new pixi.Sprite(cover);
        const scale = Math.max(width / cover.width, height / cover.height) * 1.08;
        sprite.anchor.set(0.5);
        sprite.scale.set(scale);
        sprite.position.set(width / 2, height / 2);
        if (tuning.coverBlur > 0) {
            const blur = new pixi.BlurFilter({ strength: tuning.coverBlur, quality: 3, resolution: renderResolution * 0.5 });
            blur.repeatEdgePixels = true;
            sprite.filters = [blur];
            filters.push(blur);
        }
        container.addChild(sprite);
        container.addChild(new pixi.Graphics().rect(0, 0, width, height)
            .fill({ color: colorNumber(pixi, theme.backgroundColor), alpha: Math.min(1, Math.max(0, tuning.coverDim)) }));
    }
    return {
        container,
        destroy: () => {
            container.children.forEach(child => {
                child.filters = null;
            });
            filters.forEach(filter => filter.destroy());
            // 底色 / 压暗是自建 context 的 Graphics，逐节点销毁才会连 context 一起放掉。
            destroyPixiDisplayTree(container);
        },
    };
};

// ---------------------------------------------------------------------------------------------
// 后处理：整个 world 只有这一条链。每个 pass 都用 'inherit' 分辨率（pixi 对同一数组取最小值，
// 默认的硬编码 1 会把画面糊掉；tempera 文字反色也依赖这一点，见 packs/tempera/temperaSceneFilters.ts）。

export const buildPostProcessChain = (
    pixi: PixiModule,
    tuning: KernelTuning['postProcess'],
    seed: number,
): Filter[] => {
    if (!tuning.enabled) return [];
    const filters: Filter[] = [];
    if (tuning.lensDistortion > 0 || tuning.lensDispersion > 0) {
        filters.push(createSonnetLensFilter(pixi, { distortion: tuning.lensDistortion, dispersion: tuning.lensDispersion }));
    }
    if (tuning.grain > 0) {
        filters.push(new pixi.NoiseFilter({ noise: tuning.grain * 0.35, seed: (seed % 10_000) / 10_000, antialias: 'on' }));
    }
    if (tuning.contrast > 0) {
        const matrix = new pixi.ColorMatrixFilter();
        matrix.contrast(tuning.contrast * 0.5, false);
        matrix.antialias = 'on';
        filters.push(matrix);
    }
    filters.push(...createSonnetPrintFilters(pixi, {
        rgbShift: tuning.rgbShift,
        halftone: tuning.halftone,
        vignette: tuning.vignette,
    }));
    filters.forEach(filter => {
        filter.resolution = 'inherit';
    });
    return filters;
};

// ---------------------------------------------------------------------------------------------
// 译文字幕

const readable = (text: string | undefined | null) => Boolean(text && text.trim() && text.trim() !== '......');

export const resolveSubtitleText = (line: Line | null, mode: KernelTuning['subtitles']['mode']) => {
    if (!line || mode === 'none') return null;
    const text = mode === 'translation' ? line.translation : line.romanization;
    return readable(text) ? text!.trim() : null;
};

/** 当前行（或刚唱完、下一行还没开始的行）。唱完 3 秒后不再显示。 */
export const findSubtitleLine = (lines: Line[], time: number): { line: Line; index: number } | null => {
    let index = -1;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i].startTime <= time) {
            index = i;
            break;
        }
    }
    if (index < 0) return null;
    const line = lines[index];
    if (time > line.endTime + 3) return null;
    return { line, index };
};

export interface SubtitleLayer {
    container: Container;
    update: (time: number) => void;
    destroy: () => void;
}

export const buildSubtitleLayer = (
    pixi: PixiModule,
    width: number,
    height: number,
    theme: Theme,
    tuning: KernelTuning['subtitles'],
    lines: Line[],
): SubtitleLayer => {
    const container = new pixi.Container();
    const glow = new pixi.Graphics();
    const glowBlur = new pixi.BlurFilter({ strength: 24, quality: 3 });
    glow.filters = [glowBlur];
    const fontSize = Math.round(Math.min(width, height) * 0.036 * tuning.scale);
    const text = new pixi.Text({
        text: '',
        style: new pixi.TextStyle({
            fontFamily: resolveThemeFontStack(theme),
            fontWeight: String(resolveThemeFontWeight(theme, 500)) as import('pixi.js').TextStyleFontWeight,
            fontSize,
            fill: theme.secondaryColor,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: width * 0.8,
            breakWords: true,
        }),
    });
    text.anchor.set(0.5, 1);
    container.addChild(glow, text);
    const baseY = height - Math.max(28, height * 0.075);
    let shownIndex = -2;
    const bg = colorNumber(pixi, theme.backgroundColor);

    const update = (time: number) => {
        const current = findSubtitleLine(lines, time);
        const content = current ? resolveSubtitleText(current.line, tuning.mode) : null;
        if (!current || !content) {
            container.visible = false;
            shownIndex = -2;
            return;
        }
        if (current.index !== shownIndex) {
            shownIndex = current.index;
            text.text = content;
            glow.clear();
            const w = text.width + fontSize * 3;
            const h = text.height + fontSize * 1.6;
            glow.ellipse(width / 2, baseY - text.height / 2, w / 2, h / 2).fill({ color: bg, alpha: 0.8 });
        }
        // 与 folia 的 DOM 字幕一样：换行时 0.24s 淡入并上移 10px。
        const enter = Math.min(1, Math.max(0, (time - current.line.startTime) / 0.24));
        const eased = 1 - Math.pow(1 - enter, 3);
        container.visible = true;
        container.alpha = tuning.opacity * eased;
        text.position.set(width / 2, baseY + (1 - eased) * 10);
    };

    return {
        container,
        update,
        destroy: () => {
            glow.filters = null;
            glowBlur.destroy();
            destroyPixiDisplayTree(container);
        },
    };
};

// ---------------------------------------------------------------------------------------------
// tempera 的擦除色块：travel 0..2，1 为满覆盖（场景在此刻切换）。

export const drawWipe = (
    pixi: PixiModule,
    wipe: import('pixi.js').Graphics,
    travel: number,
    angle: number,
    width: number,
    height: number,
    color: string,
) => {
    if (travel <= 0.001 || travel >= 1.999) {
        if (wipe.visible) {
            wipe.clear();
            wipe.visible = false;
        }
        return;
    }
    const span = Math.hypot(width, height);
    const notch = span * 0.08;
    const length = span + notch * 2;
    const start = -span / 2 - notch + (travel - 1) * length;
    const end = start + length;
    const half = span / 2;
    wipe.clear();
    wipe.poly([start, -half, end, -half, end + notch, 0, end, half, start, half, start + notch, 0])
        .fill({ color: colorNumber(pixi, color) });
    wipe.pivot.set(0, 0);
    wipe.position.set(width / 2, height / 2);
    wipe.rotation = angle;
    wipe.scale.set(1, 1);
    wipe.visible = true;
};
