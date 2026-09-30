// 逐字条上的操作：拖缝、拖边、Shift 带着后面、平移、拖行边、拆 / 合、分配、打点；起音点检测。
import { describe, expect, it } from 'vitest';
import type { AudioAnalysis } from '@/core/audio/analysis';
import { detectOnsets, nearestTime } from '@/core/audio/onsets';
import { applyTaps, distribute, dragLineEdge, dragUnitEdge, editableUnits, mergeWithNext, moveUnit, splitUnit } from '@/core/lyrics/wordEditing';
import { MIN_UNIT, type TimedUnit } from '@/core/lyrics/wordTiming';

const units: TimedUnit[] = [
    { text: '君', startTime: 1, endTime: 1.5 },
    { text: 'の', startTime: 1.5, endTime: 2 },
    { text: '声', startTime: 2.4, endTime: 3 },
];
const bounds = { start: 1, end: 3.2 };
const times = (list: TimedUnit[]) => list.map(unit => [unit.text, +unit.startTime.toFixed(3), +unit.endTime.toFixed(3)]);

describe('word strip operations', () => {
    it('drags a shared seam, a free edge and clamps against neighbours', () => {
        expect(times(dragUnitEdge(units, bounds, 1, 'start', 1.3).units)).toEqual([['君', 1, 1.3], ['の', 1.3, 2], ['声', 2.4, 3]]);
        // の 与 声 之间有空隙：只动 の 的结束，不能越过 声 的开始。
        expect(times(dragUnitEdge(units, bounds, 1, 'end', 2.2).units)[2]).toEqual(['声', 2.4, 3]);
        expect(dragUnitEdge(units, bounds, 1, 'end', 9).units[1].endTime).toBe(2.4);
        // 缝不能把前一个挤得比 MIN_UNIT 短。
        expect(dragUnitEdge(units, bounds, 1, 'start', 0).units[0].endTime).toBeCloseTo(1 + MIN_UNIT);
        // 最后一个的结束可以把行拉长（受 limit 限制）。
        const longer = dragUnitEdge(units, bounds, 2, 'end', 4, { limit: { start: 0, end: 3.6 } });
        expect(longer.units[2].endTime).toBe(3.6);
        expect(longer.bounds.end).toBe(3.6);
    });

    it('ripples everything after with Shift', () => {
        const rippled = dragUnitEdge(units, bounds, 0, 'end', 1.7, { ripple: true });
        expect(times(rippled.units)).toEqual([['君', 1, 1.7], ['の', 1.7, 2.2], ['声', 2.6, 3.2]]);
        const moved = moveUnit(units, bounds, 1, 0.3, { ripple: true });
        expect(times(moved.units)).toEqual([['君', 1, 1.5], ['の', 1.8, 2.3], ['声', 2.7, 3.3]]);
        expect(moved.bounds.end).toBeCloseTo(3.3);
    });

    it('moves a unit between its neighbours', () => {
        expect(times(moveUnit(units, bounds, 1, 1).units)[1]).toEqual(['の', 1.9, 2.4]);
        expect(times(moveUnit(units, bounds, 1, -1).units)[1]).toEqual(['の', 1.5, 2]);
    });

    it('scales units with the line edges', () => {
        const scaled = dragLineEdge(units, bounds, 'end', 5.4);
        expect(scaled.bounds).toEqual({ start: 1, end: 5.4 });
        expect(scaled.units[2].endTime).toBeCloseTo(1 + (2 / 2.2) * 4.4);
    });

    it('splits, merges and distributes', () => {
        const split = splitUnit([{ text: '探して', startTime: 0, endTime: 0.9 }], { start: 0, end: 1 }, 0);
        expect(times(split.units)).toEqual([['探', 0, 0.3], ['し', 0.3, 0.6], ['て', 0.6, 0.9]]);
        expect(times(mergeWithNext(units, bounds, 0).units)[0]).toEqual(['君の', 1, 2]);
        expect(times(distribute(units, { start: 1, end: 2.5 }, 'even').units)).toEqual([['君', 1, 1.5], ['の', 1.5, 2], ['声', 2, 2.5]]);
        const byLength = distribute([{ text: 'a', startTime: 0, endTime: 1 }, { text: 'bcd', startTime: 1, endTime: 2 }], { start: 0, end: 4 }, 'length');
        expect(times(byLength.units)).toEqual([['a', 0, 1], ['bcd', 1, 4]]);
    });

    it('applies taps: starts, joins and the final end', () => {
        const all = applyTaps(units, bounds, [1.1, 1.4, 2.0, 2.9]);
        expect(times(all.units)).toEqual([['君', 1.1, 1.4], ['の', 1.4, 2], ['声', 2, 2.9]]);
        const partial = applyTaps(units, bounds, [1.2]);
        expect(times(partial.units)).toEqual([['君', 1.2, 1.5], ['の', 1.5, 2], ['声', 2.4, 3]]);
    });

    it('rebuilds editable units when parsed words do not spell the line', () => {
        const line = { fullText: '君の声、探して', startTime: 1, endTime: 3, words: [{ text: '君の声', startTime: 1, endTime: 2 }, { text: '探して', startTime: 2, endTime: 3 }] };
        const rebuilt = editableUnits(line);
        expect(rebuilt.map(unit => unit.text).join('')).toBe('君の声、探して');
        expect(editableUnits({ ...line, fullText: '君の声探して' })).toHaveLength(2);
    });
});

describe('onsets', () => {
    it('finds the frames where the mid / vocal bands jump and snaps within tolerance', () => {
        const fps = 60;
        const frames = fps * 3;
        const band = new Float32Array(frames);
        const jumps = [0.5, 1.2, 2.25];
        for (let i = 0; i < frames; i += 1) {
            const t = i / fps;
            band[i] = jumps.some(jump => t >= jump && t < jump + 0.2) ? 180 : 20;
        }
        const zero = new Float32Array(frames);
        const analysis = { fps, duration: 3, power: zero, bands: { bass: zero, lowMid: zero, mid: band, vocal: band, treble: zero }, peaks: new Float32Array(2), peaksPerSecond: 1 } as unknown as AudioAnalysis;
        const onsets = detectOnsets(analysis);
        expect(onsets).toHaveLength(3);
        onsets.forEach((onset, index) => expect(onset).toBeCloseTo(jumps[index], 1));
        expect(detectOnsets(analysis)).toBe(onsets);
        expect(nearestTime(onsets, 1.25, 0.1)).toBeCloseTo(1.2, 1);
        expect(nearestTime(onsets, 1.8, 0.1)).toBeNull();
    });
});

describe('moveLine', () => {
    it('moves the whole line and its words, clamped to the limit', async () => {
        const { moveLine } = await import('@/core/lyrics/wordEditing');
        const units: TimedUnit[] = [{ text: 'a', startTime: 1, endTime: 1.5 }, { text: 'b', startTime: 1.5, endTime: 2 }];
        const moved = moveLine(units, { start: 1, end: 2.2 }, 0.5);
        expect(moved.bounds).toEqual({ start: 1.5, end: 2.7 });
        expect(moved.units.map(unit => [unit.startTime, unit.endTime])).toEqual([[1.5, 2], [2, 2.5]]);
        const clamped = moveLine(units, { start: 1, end: 2.2 }, 5, { start: 0, end: 3 }).bounds;
        expect(clamped.start).toBeCloseTo(1.8);
        expect(clamped.end).toBeCloseTo(3);
        expect(moveLine(units, { start: 1, end: 2.2 }, -5).bounds.start).toBe(0);
    });
});
