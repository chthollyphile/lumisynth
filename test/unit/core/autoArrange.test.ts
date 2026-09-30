import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { resolveAssetClips } from '@/core/assets/clips';
import { AUTO_CLIP_PREFIX, DEFAULT_ARRANGE_OPTIONS, isAutoClip, planAutoArrangement } from '@/core/assets/autoArrange';
import { syntheticSong } from '../compiler/fixtures';

const program = compileLumiProgram({ lines: syntheticSong(5, true), seed: 'arrange' });
const portrait = { id: 'girl', width: 600, height: 1200 };
const wide = { id: 'city', width: 1600, height: 900 };
let counter = 0;
const makeId = () => `id${counter++}`;

describe('planAutoArrangement', () => {
    const everyShot = { ...DEFAULT_ARRANGE_OPTIONS, probability: 1 };

    it('defaults: one clip per shot, above the scene and below the lyrics, stuck to the scene', () => {
        const clips = planAutoArrangement([portrait], program, 16 / 9, everyShot, makeId);
        const shots = program.paragraphs.flatMap(p => p.shots).filter(shot => shot.endTime - shot.startTime >= 1.5);
        expect(clips).toHaveLength(shots.length);
        // 片段的时间就是镜头的时间。
        const resolved = resolveAssetClips(clips, program, new Set(['girl'])).resolved;
        resolved.forEach((clip, index) => expect([clip.start, clip.end]).toEqual([shots[index].startTime, shots[index].endTime]));
        clips.forEach(clip => {
            expect(isAutoClip(clip)).toBe(true);
            expect(clip.id.startsWith(AUTO_CLIP_PREFIX)).toBe(true);
            expect(clip).toMatchObject({ slot: 'mid', follow: 'scene', assetId: 'girl' });
            expect(clip.timing.type).toBe('shot');
            expect(clip.effect).toBeUndefined();
            expect(clip.motion).toMatchObject({ type: 'float' });
        });
        // 所有片段在当前编排里都能解析出时间。
        expect(resolveAssetClips(clips, program, new Set(['girl'])).invalid).toEqual([]);
    });

    const fixed = { ...everyShot, variety: 0 };

    it('without variety: alternates portraits between the sides, each sliding in from its own side', () => {
        const clips = planAutoArrangement([portrait], program, 16 / 9, fixed, makeId);
        expect(clips[0].x).toBeGreaterThan(0.5);
        expect(clips[1].x).toBeLessThan(0.5);
        expect(clips[0].enter.type).toBe('rush-left');
        expect(clips[1].enter.type).toBe('rush-right');
        // 默认就是大图，并朝画面中间倾一点（右边的逆时针、左边的顺时针）。
        expect(clips[0].scale).toBeGreaterThan(1);
        expect(clips[0].rotation).toBeLessThan(0);
        expect(clips[1].rotation).toBeGreaterThan(0);
    });

    it('without variety: centres wide images and everything on a vertical frame', () => {
        const [first] = planAutoArrangement([wide], program, 16 / 9, fixed, makeId);
        expect(first.x).toBe(0.5);
        expect(first.enter.type).toBe('pop');
        planAutoArrangement([portrait, wide], program, 9 / 16, fixed, makeId).forEach(clip => expect(clip.x).toBe(0.5));
    });

    it('variety mixes compositions deterministically and keeps images on the frame', () => {
        const varied = { ...everyShot, variety: 1 };
        const clips = planAutoArrangement([portrait, wide], program, 16 / 9, varied, makeId);
        const again = planAutoArrangement([portrait, wide], program, 16 / 9, varied, makeId);
        const look = (clip: (typeof clips)[number]) => [clip.x, clip.y, clip.scale, clip.rotation, clip.enter.type];
        expect(clips.map(look)).toEqual(again.map(look));
        const portraits = clips.filter(clip => clip.assetId === 'girl');
        // 不再只有两个固定位置、一种大小。
        expect(new Set(portraits.map(clip => clip.x.toFixed(3))).size).toBeGreaterThan(2);
        expect(new Set(portraits.map(clip => clip.scale.toFixed(3))).size).toBeGreaterThan(2);
        expect(clips.some(clip => clip.assetId === 'city' && clip.x !== 0.5)).toBe(true);
        clips.forEach(clip => {
            expect(clip.x).toBeGreaterThanOrEqual(0.08);
            expect(clip.x).toBeLessThanOrEqual(0.92);
            expect(Math.abs(clip.rotation)).toBeLessThan(0.1);
            expect(Math.abs(clip.rotation)).toBeGreaterThan(0);
        });
        // 同一侧最多连两次。
        const sides = clips.map(clip => (Math.abs(clip.x - 0.5) > 0.06 ? Math.sign(clip.x - 0.5) : 0)).filter(Boolean);
        sides.forEach((side, index) => { if (index >= 2) expect(side === sides[index - 1] && side === sides[index - 2]).toBe(false); });
    });

    it('rotates through the images and honours coverage and effect options', () => {
        const clips = planAutoArrangement([portrait, wide], program, 16 / 9, everyShot, makeId);
        expect(clips.slice(0, 4).map(clip => clip.assetId)).toEqual(['girl', 'city', 'girl', 'city']);
        const highlights = planAutoArrangement([portrait], program, 16 / 9, { ...everyShot, coverage: 'highlights', effect: 'echo', effectColor: '#ff66aa' }, makeId);
        expect(highlights.length).toBeLessThan(clips.length);
        highlights.forEach(clip => expect(clip.effect).toMatchObject({ type: 'echo', color: '#ff66aa' }));
    });

    it('probability thins the shots deterministically, lower probability keeps a subset', () => {
        const all = planAutoArrangement([portrait], program, 16 / 9, everyShot, makeId);
        const half = planAutoArrangement([portrait], program, 16 / 9, { ...everyShot, probability: 0.5 }, makeId);
        const again = planAutoArrangement([portrait], program, 16 / 9, { ...everyShot, probability: 0.5 }, makeId);
        const quarter = planAutoArrangement([portrait], program, 16 / 9, { ...everyShot, probability: 0.25 }, makeId);
        const key = (clip: (typeof all)[number]) => JSON.stringify(clip.timing);
        expect(half.length).toBeGreaterThan(0);
        expect(half.length).toBeLessThan(all.length);
        expect(half.map(key)).toEqual(again.map(key));
        // 调低概率只会去掉一些镜头，留下的都在原来那一批里。
        expect(quarter.every(clip => half.some(other => key(other) === key(clip)))).toBe(true);
        expect(planAutoArrangement([portrait], program, 16 / 9, { ...everyShot, probability: 0 }, makeId)).toEqual([]);
    });

    it('returns nothing without images', () => {
        expect(planAutoArrangement([], program, 16 / 9, DEFAULT_ARRANGE_OPTIONS, makeId)).toEqual([]);
    });
});
