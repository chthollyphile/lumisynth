// 「在时间轴上显示」：已经完整可见不动；放得下就居中；放不下让开头靠左；不越界。
import { describe, expect, it } from 'vitest';
import { onRevealInTimeline, revealInTimeline, revealScroll } from '@/app/timeline/reveal';

describe('revealScroll', () => {
    it('leaves a fully visible range alone', () => {
        expect(revealScroll(100, 800, 300, 500, 5000)).toBeNull();
    });

    it('centres a range that fits, and puts the start of a long one near the left', () => {
        expect(revealScroll(0, 800, 2000, 2200, 5000)).toBe(1700);
        expect(revealScroll(0, 800, 2000, 3500, 5000)).toBe(1960);
    });

    it('stays inside the content', () => {
        expect(revealScroll(3000, 800, 0, 100, 5000)).toBe(0);
        expect(revealScroll(0, 800, 4900, 4990, 5000)).toBe(4200);
    });

    it('delivers requests to listeners with an ordered range', () => {
        const seen: Array<{ start: number; end: number }> = [];
        const off = onRevealInTimeline(range => seen.push(range));
        revealInTimeline(5, 2);
        off();
        revealInTimeline(1, 2);
        expect(seen).toEqual([{ start: 2, end: 5 }]);
    });
});
