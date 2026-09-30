// 逐字时间的编辑规则：计时单元、改字保留时间、整理、伸缩；改字后的分词修复。
import { describe, expect, it } from 'vitest';
import type { Line } from '@/core/types';
import { MIN_UNIT, normalizeUnits, retimeForText, scaleUnits, timingUnitTexts, unitsMatchText } from '@/core/lyrics/wordTiming';
import { repairWordSegmentation } from '@/core/lyrics/wordSegmentation';

const line = (text: string, units: Array<[string, number, number]>, start = units[0][1], end = units.at(-1)![2]): Pick<Line, 'fullText' | 'words' | 'startTime' | 'endTime'> => ({
    fullText: text,
    startTime: start,
    endTime: end,
    words: units.map(([word, startTime, endTime]) => ({ text: word, startTime, endTime })),
});

const valid = (units: Array<{ startTime: number; endTime: number }>, start: number, end: number) => {
    units.forEach((unit, index) => {
        expect(unit.endTime - unit.startTime).toBeGreaterThanOrEqual(MIN_UNIT - 1e-9);
        expect(unit.startTime).toBeGreaterThanOrEqual(index > 0 ? units[index - 1].endTime - 1e-9 : start - 1e-9);
        expect(unit.endTime).toBeLessThanOrEqual(end + 1e-9);
    });
};

describe('timing units', () => {
    it('splits CJK per character and other text per word, ignoring spaces', () => {
        expect(timingUnitTexts('君の声を hello world')).toEqual(['君', 'の', '声', 'を', 'hello', 'world']);
        expect(unitsMatchText('hello world', [{ text: 'hello' }, { text: 'world' }])).toBe(true);
        expect(unitsMatchText('hello world', [{ text: 'hello' }])).toBe(false);
    });
});

describe('retimeForText', () => {
    const source = line('君の声を探して', [['君', 1, 1.2], ['の', 1.2, 1.4], ['声', 1.4, 1.8], ['を', 1.8, 2], ['探', 2, 2.3], ['し', 2.3, 2.6], ['て', 2.6, 3]]);

    it('keeps the time of every unchanged character', () => {
        const units = retimeForText(source, '君の歌を探して');
        expect(units.map(unit => unit.text).join('')).toBe('君の歌を探して');
        expect(units.map(unit => [unit.startTime, unit.endTime])).toEqual([[1, 1.2], [1.2, 1.4], [1.4, 1.8], [1.8, 2], [2, 2.3], [2.3, 2.6], [2.6, 3]]);
    });

    it('spreads inserted characters over the gap they fill', () => {
        const units = retimeForText(source, '君の声をずっと探して');
        valid(units, 1, 3);
        expect(units[0]).toMatchObject({ startTime: 1, endTime: 1.2 });
        expect(units.at(-1)).toMatchObject({ startTime: 2.6, endTime: 3 });
        const inserted = units.slice(4, 7);
        expect(inserted.map(unit => unit.text)).toEqual(['ず', 'っ', 'と']);
        // 插在「を」与「探」之间，那里没有空隙：从两边挤出最短的时间。
        inserted.forEach(unit => expect(unit.endTime - unit.startTime).toBeGreaterThanOrEqual(MIN_UNIT - 1e-9));
    });

    it('fills a replaced span and the line edges', () => {
        const replaced = retimeForText(source, '君の夢を見て');
        valid(replaced, 1, 3);
        expect(replaced[2]).toMatchObject({ text: '夢', startTime: 1.4, endTime: 1.8 });
        // 「探し」换成「見」：拿到原来「探し」的那一段。
        expect(replaced[4].text).toBe('見');
        expect(replaced[4].startTime).toBeCloseTo(2);
        expect(replaced[4].endTime).toBeCloseTo(2.6);
        const appended = retimeForText(line('hello', [['hello', 4, 5]], 4, 6), 'hello world');
        expect(appended.map(unit => [unit.text, unit.startTime, unit.endTime])).toEqual([['hello', 4, 5], ['world', 5, 6]]);
    });
});

describe('normalize and scale', () => {
    it('makes units ordered, non-overlapping, long enough and inside the line; leaves valid units alone', () => {
        const messy = normalizeUnits([
            { text: 'a', startTime: 0.5, endTime: 2.5 },
            { text: 'b', startTime: 2, endTime: 2 },
            { text: 'c', startTime: 4, endTime: 9 },
        ], 1, 5);
        valid(messy, 1, 5);
        expect(messy[0].startTime).toBe(1);
        expect(messy[2].endTime).toBe(5);
        const clean = [{ text: 'a', startTime: 1, endTime: 2 }, { text: 'b', startTime: 2.5, endTime: 3 }];
        expect(normalizeUnits(clean, 1, 3)).toEqual(clean);
        const crowded = normalizeUnits([{ text: 'a', startTime: 1, endTime: 1 }, { text: 'b', startTime: 1, endTime: 1 }], 1, 1.02);
        expect(crowded.map(unit => unit.startTime)).toEqual([1, 1.01]);
    });

    it('scales units with the line', () => {
        const scaled = scaleUnits([{ text: 'a', startTime: 1, endTime: 2 }, { text: 'b', startTime: 2, endTime: 3 }], { start: 1, end: 3 }, { start: 2, end: 6 });
        expect(scaled.map(unit => [unit.startTime, unit.endTime])).toEqual([[2, 4], [4, 6]]);
    });
});

describe('repairWordSegmentation', () => {
    it('keeps manual cuts outside the change and re-segments only the changed span', () => {
        const parts = ['君の', '声を', '探して', 'いる'];
        const repaired = repairWordSegmentation(parts, '君の歌声を探している');
        expect(repaired.join('')).toBe('君の歌声を探している');
        expect(repaired[0]).toBe('君の');
        expect(repaired.slice(-2)).toEqual(['探して', 'いる']);
    });

    it('always spells the new text', () => {
        const parts = ['hello ', 'big ', 'world'];
        for (const text of ['hello world', 'hello big wide world', 'goodbye', 'hello big world!', '新しい hello big world']) {
            const repaired = repairWordSegmentation(parts, text);
            expect(repaired.join(''), text).toBe(text);
            expect(repaired.every(part => part.length > 0)).toBe(true);
        }
        expect(repairWordSegmentation(parts, 'hello big world')).toEqual(parts);
        expect(repairWordSegmentation(parts, 'hello big world!').slice(0, 2)).toEqual(['hello ', 'big ']);
    });
});
