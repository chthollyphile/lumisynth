import { describe, expect, it } from 'vitest';
import { cubicBezierEase, evaluateClip, evaluateMotion, MOTION_EASE, normalizeClipMotion, type ResolvedAssetClip } from '@/core/assets/clips';
import { DEFAULT_CLIP_LOOK } from '@/core/assets/clips';

const motion = (type: 'float' | 'drift' | 'push' | 'sway', amount = 1) => normalizeClipMotion({ type, amount });
const sample = (type: 'float' | 'drift' | 'push' | 'sway', t: number, length = 10, x = 0.3) => evaluateMotion(motion(type), t, length, x);

describe('cubicBezierEase', () => {
    it('matches the CSS curves', () => {
        // CSS ease = cubic-bezier(0.25, 0.1, 0.25, 1)：t = 0.5 时约 0.8024。
        expect(cubicBezierEase(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
        // linear
        expect(cubicBezierEase(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5);
        // 对称的 ease-in-out 在中点是 0.5，两端是 0 和 1。
        expect(MOTION_EASE(0.5)).toBeCloseTo(0.5, 5);
        expect(MOTION_EASE(0)).toBe(0);
        expect(MOTION_EASE(1)).toBe(1);
    });

    it('starts and ends slowly', () => {
        expect(MOTION_EASE(0.05)).toBeLessThan(0.05);
        expect(MOTION_EASE(0.95)).toBeGreaterThan(0.95);
    });
});

describe('evaluateMotion', () => {
    it('never jumps between frames', () => {
        for (const type of ['float', 'drift', 'push', 'sway'] as const) {
            let previous = sample(type, 0);
            for (let t = 1 / 60; t < 10; t += 1 / 60) {
                const current = sample(type, t);
                expect(Math.abs(current.dx - previous.dx), type).toBeLessThan(0.002);
                expect(Math.abs(current.dy - previous.dy), type).toBeLessThan(0.002);
                expect(Math.abs(current.scale - previous.scale), type).toBeLessThan(0.002);
                expect(Math.abs(current.rotation - previous.rotation), type).toBeLessThan(0.002);
                previous = current;
            }
        }
    });

    it('drift eases in and out, heads towards the centre and curves on the way', () => {
        const speed = (t: number) => Math.abs(sample('drift', t + 0.01).dx - sample('drift', t).dx);
        expect(speed(0)).toBeLessThan(speed(5) / 10);
        expect(speed(9.98)).toBeLessThan(speed(5) / 10);
        // 左边的图往右走，右边的图往左走。
        expect(sample('drift', 10, 10, 0.2).dx).toBeGreaterThan(sample('drift', 0, 10, 0.2).dx);
        expect(sample('drift', 10, 10, 0.8).dx).toBeLessThan(sample('drift', 0, 10, 0.8).dx);
        // 不是直线：中途的竖直位置偏离起点与终点的连线。
        const [a, m, b] = [0, 5 * 0.6, 10].map(t => sample('drift', t));
        const onLine = a.dy + ((m.dx - a.dx) / (b.dx - a.dx)) * (b.dy - a.dy);
        expect(Math.abs(m.dy - onLine)).toBeGreaterThan(0.001);
    });

    it('float loops every period and pauses at the turning points', () => {
        expect(sample('float', 1.2).dy).toBeCloseTo(sample('float', 6.2).dy, 9);
        const speed = (t: number) => Math.hypot(sample('float', t + 0.02).dx - sample('float', t).dx, sample('float', t + 0.02).dy - sample('float', t).dy);
        expect(speed(0)).toBeLessThan(speed(1.25) / 5);
        expect(speed(2.49)).toBeLessThan(speed(1.25) / 5);
    });

    it('push zooms in over the clip; none and amount 0 stay still', () => {
        expect(sample('push', 10).scale).toBeGreaterThan(1.1);
        expect(sample('push', 0).scale).toBe(1);
        const still = evaluateMotion(normalizeClipMotion({ type: 'float', amount: 0 }), 3, 10, 0.3);
        expect(Math.abs(still.dx) + Math.abs(still.dy)).toBe(0);
        expect(evaluateMotion(normalizeClipMotion(undefined), 3, 10, 0.3)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0 });
    });

    it('is applied on top of the enter animation in evaluateClip', () => {
        const clip: ResolvedAssetClip = { ...DEFAULT_CLIP_LOOK, id: 'c', assetId: 'a', timing: { type: 'song' }, start: 0, end: 10, enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 }, motion: motion('sway') };
        const frame = evaluateClip(clip, 1.5);
        expect(frame.rotation).toBeCloseTo(sample('sway', 1.5, 10, clip.x).rotation, 9);
    });
});
