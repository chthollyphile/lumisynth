import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIP_EFFECT, ECHO_LAYERS, echoLayers, normalizeClipEffect } from '@/core/assets/clips';

describe('clip effects', () => {
    it('treats a missing or broken effect as none and clamps values', () => {
        expect(normalizeClipEffect(undefined).type).toBe('none');
        const effect = normalizeClipEffect({ type: 'weird' as never, color: 'red', size: 3, opacity: -1, period: 0 });
        expect(effect).toMatchObject({ type: 'none', color: DEFAULT_CLIP_EFFECT.color, size: 1, opacity: 0, period: DEFAULT_CLIP_EFFECT.period });
        expect(normalizeClipEffect({ type: 'echo', color: '#AABBCC' }).color).toBe('#aabbcc');
    });

    it('echo layers are staggered, grow outward and fade, and loop every period', () => {
        const effect = normalizeClipEffect({ type: 'echo', size: 0.5, opacity: 0.8, period: 2 });
        const layers = echoLayers(effect, 0.5);
        expect(layers).toHaveLength(ECHO_LAYERS);
        // 错开：三层的放大程度各不相同，且都不小于原图。
        expect(new Set(layers.map(layer => layer.scale.toFixed(4))).size).toBe(ECHO_LAYERS);
        layers.forEach(layer => {
            expect(layer.scale).toBeGreaterThanOrEqual(1);
            expect(layer.alpha).toBeLessThanOrEqual(0.8);
        });
        // 放得越大越淡。
        const sorted = [...layers].sort((a, b) => a.scale - b.scale);
        expect(sorted[0].alpha).toBeGreaterThan(sorted[ECHO_LAYERS - 1].alpha);
        // 只由时间决定、按周期循环。
        expect(echoLayers(effect, 0.5 + 2)).toEqual(layers.map(layer => ({ scale: expect.closeTo(layer.scale, 9), alpha: expect.closeTo(layer.alpha, 9) })));
    });

    it('a bigger size spreads the echo further', () => {
        const small = Math.max(...echoLayers(normalizeClipEffect({ type: 'echo', size: 0 }), 1.5).map(layer => layer.scale));
        const large = Math.max(...echoLayers(normalizeClipEffect({ type: 'echo', size: 1 }), 1.5).map(layer => layer.scale));
        expect(large).toBeGreaterThan(small);
    });
});
