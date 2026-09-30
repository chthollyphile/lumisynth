// 素材片段：挂载点解析（改编排后跟着走）与入场 / 退场动画。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { DEFAULT_CLIP_LOOK, evaluateClip, resolveAssetClips, type AssetClip, type ResolvedAssetClip } from '@/core/assets/clips';
import { syntheticSong } from '../compiler/fixtures';

const lines = syntheticSong(71, true);
const program = compileLumiProgram({ lines, seed: 'clips' });
const clip = (timing: AssetClip['timing'], patch: Partial<AssetClip> = {}): AssetClip => ({ id: 'c', assetId: 'a', timing, ...DEFAULT_CLIP_LOOK, ...patch });

describe('asset clips', () => {
    it('resolves absolute, line, paragraph and shot timings', () => {
        const paragraph = program.paragraphs[2];
        const shot = paragraph.shots[1];
        const { resolved, invalid } = resolveAssetClips([
            clip({ type: 'absolute', start: 3, end: 5 }),
            clip({ type: 'lines', from: program.lines[4].anchor, to: program.lines[6].anchor }),
            clip({ type: 'paragraph', anchor: paragraph.anchor }, { lead: 0.5, tail: 1 }),
            clip({ type: 'shot', anchor: shot.anchor }),
        ], program, new Set(['a']));
        expect(invalid).toEqual([]);
        expect(resolved.map(item => [item.start, item.end])).toEqual([
            [3, 5],
            [program.lines[4].line.startTime, program.lines[6].renderEndTime],
            [paragraph.startTime - 0.5, paragraph.endTime + 1],
            [shot.startTime, shot.endTime],
        ]);
    });

    it('follows the arrangement when the seed changes and reports stale anchors and missing assets', () => {
        const shot = program.paragraphs[1].shots[0];
        const other = compileLumiProgram({ lines, seed: 'another' });
        const moved = other.paragraphs.flatMap(p => p.shots).find(s => s.anchor.line.index === shot.anchor.line.index && s.anchor.slot === shot.anchor.slot);
        const { resolved, invalid } = resolveAssetClips([
            clip({ type: 'shot', anchor: shot.anchor }),
            clip({ type: 'paragraph', anchor: { line: { index: 1, hash: 'nope' } } }),
            { ...clip({ type: 'absolute', start: 0, end: 1 }), assetId: 'gone' },
        ], other, new Set(['a']));
        if (moved) expect(resolved[0].start).toBe(moved.startTime);
        expect(invalid.map(item => item.reason)).toEqual(['anchor-missing', 'asset-missing']);
    });

    it('animates entry and exit deterministically, compressing them on short clips', () => {
        const resolved: ResolvedAssetClip = { ...clip({ type: 'absolute', start: 10, end: 12 }, { enter: { type: 'slide-up', duration: 0.5 }, exit: { type: 'zoom', duration: 0.5 } }), start: 10, end: 12 };
        expect(evaluateClip(resolved, 9.99).visible).toBe(false);
        expect(evaluateClip(resolved, 12).visible).toBe(false);
        const entering = evaluateClip(resolved, 10.1);
        expect(entering.alpha).toBeGreaterThan(0);
        expect(entering.alpha).toBeLessThan(1);
        expect(entering.dy).toBeGreaterThan(0);
        expect(evaluateClip(resolved, 11)).toEqual({ visible: true, alpha: 1, dx: 0, dy: 0, scale: 1, rotation: 0 });
        expect(evaluateClip(resolved, 11.9).scale).toBeLessThan(1);
        const short: ResolvedAssetClip = { ...resolved, start: 0, end: 0.4 };
        expect(evaluateClip(short, 0.2).alpha).toBeCloseTo(1, 5);
    });

    it('rush comes in from off-frame, overshoots and settles; pop springs up past full size', () => {
        const rush: ResolvedAssetClip = { ...clip({ type: 'absolute', start: 0, end: 4 }, { enter: { type: 'rush-left', duration: 0.5 } }), start: 0, end: 4 };
        const first = evaluateClip(rush, 0.01);
        expect(first.dx).toBeGreaterThan(0.4);
        expect(first.rotation).toBeGreaterThan(0);
        // 已经完全不透明、还在路上。
        expect(evaluateClip(rush, 0.2).alpha).toBeCloseTo(1, 5);
        // 冲过头：从右边进来，途中越过原位到左边一点。
        const samples = Array.from({ length: 50 }, (_, i) => evaluateClip(rush, (i / 50) * 0.5).dx);
        expect(Math.min(...samples)).toBeLessThan(-0.01);
        expect(evaluateClip(rush, 1)).toMatchObject({ dx: 0, rotation: 0, scale: 1 });
        const fromLeft = evaluateClip({ ...rush, enter: { type: 'rush-right', duration: 0.5 } }, 0.01);
        expect(fromLeft.dx).toBeLessThan(-0.4);

        const pop: ResolvedAssetClip = { ...rush, enter: { type: 'pop', duration: 0.5 } };
        expect(evaluateClip(pop, 0.01).scale).toBeLessThan(0.7);
        const scales = Array.from({ length: 50 }, (_, i) => evaluateClip(pop, (i / 50) * 0.5).scale);
        expect(Math.max(...scales)).toBeGreaterThan(1.02);
        expect(evaluateClip(pop, 1).scale).toBe(1);
    });
});
