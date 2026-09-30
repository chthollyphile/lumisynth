// 背景轨：解析、淡入淡出、推近、视频时间（偏移与循环）。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { DEFAULT_BACKGROUND_LOOK, evaluateBackground, resolveBackgroundClips, type BackgroundClip, type ResolvedBackgroundClip } from '@/core/assets/background';
import { syntheticSong } from '../compiler/fixtures';

const program = compileLumiProgram({ lines: syntheticSong(71, true), seed: 'bg' });
const clip = (patch: Partial<BackgroundClip>): BackgroundClip => ({ id: 'b', source: { type: 'theme' }, timing: { type: 'song' }, ...DEFAULT_BACKGROUND_LOOK, ...patch });

describe('background clips', () => {
    it('resolves timings and reports missing assets', () => {
        const paragraph = program.paragraphs[1];
        const { resolved, invalid } = resolveBackgroundClips([
            clip({ timing: { type: 'paragraph', anchor: paragraph.anchor } }),
            clip({ source: { type: 'image', assetId: 'gone' } }),
            clip({ timing: { type: 'song' } }),
        ], program, new Set());
        expect(resolved[0]).toMatchObject({ start: paragraph.startTime, end: paragraph.endTime });
        expect(resolved[1].start).toBe(0);
        expect(invalid.map(item => item.reason)).toEqual(['asset-missing']);
    });

    it('fades in and out and slowly zooms', () => {
        const resolved: ResolvedBackgroundClip = { ...clip({ fadeIn: 1, fadeOut: 1, kenBurns: 0.1 }), start: 10, end: 20 };
        expect(evaluateBackground(resolved, 9.9).visible).toBe(false);
        expect(evaluateBackground(resolved, 10.5).alpha).toBeCloseTo(0.5, 5);
        expect(evaluateBackground(resolved, 15).alpha).toBe(1);
        expect(evaluateBackground(resolved, 19.5).alpha).toBeCloseTo(0.5, 5);
        expect(evaluateBackground(resolved, 10.5).zoom).toBeLessThan(evaluateBackground(resolved, 19).zoom);
        expect(evaluateBackground(resolved, 19.99).zoom).toBeLessThanOrEqual(1.1);
    });

    it('maps song time to video time with offset and looping', () => {
        const looping: ResolvedBackgroundClip = { ...clip({ source: { type: 'video', assetId: 'v', offset: 2, loop: true } }), start: 5, end: 50 };
        expect(evaluateBackground(looping, 5, 10).videoTime).toBe(2);
        expect(evaluateBackground(looping, 14, 10).videoTime).toBeCloseTo(1, 5);
        const once: ResolvedBackgroundClip = { ...looping, source: { type: 'video', assetId: 'v', offset: 0, loop: false } };
        expect(evaluateBackground(once, 40, 10).videoTime).toBeCloseTo(9.999, 3);
        expect(evaluateBackground({ ...looping, source: { type: 'image', assetId: 'i' } }, 6).videoTime).toBeNull();
    });
});
