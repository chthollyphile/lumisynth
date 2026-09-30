// 素材跟随运镜：变换的组合 / 求逆 / 分解，以及 scene / motion 两种方式和跟随程度。
import { describe, expect, it } from 'vitest';
import {
    apply,
    cameraBetween,
    compose,
    decompose,
    fromParams,
    IDENTITY,
    invert,
    multiply,
    resolveFollow,
    type Affine,
    type CameraSample,
    type TransformParams,
} from '@/kernel/cameraFollow';

const W = 1280;
const H = 720;
const close = (m: Affine, n: Affine) => {
    (['a', 'b', 'c', 'd', 'tx', 'ty'] as const).forEach(key => expect(m[key]).toBeCloseTo(n[key], 6));
};

const rest: TransformParams = { x: 640, y: 360, pivotX: 640, pivotY: 360, scale: 1, rotation: 0 };
const moved = (t: number): TransformParams => ({ ...rest, x: 640 + 40 * t, y: 360 - 10 * t, scale: 1 + 0.2 * t, rotation: 0.1 * t });

/** 两个镜头：[0, 2) 与 [2, 4)，各自从自己的起点开始推近。 */
const cameraAt = (time: number): CameraSample => {
    const shot = time < 2 ? { id: 'a', start: 0, offset: 0 } : { id: 'b', start: 2, offset: 0.5 };
    return { matrix: cameraBetween(rest, moved(time - shot.start + shot.offset)), shotId: shot.id, shotStart: shot.start };
};

describe('affine helpers', () => {
    it('composes, inverts and decomposes similarities', () => {
        const m = fromParams({ x: 100, y: 50, pivotX: 20, pivotY: 10, scale: 1.5, rotation: 0.3 });
        close(multiply(m, invert(m)), IDENTITY);
        const p = apply(m, 20, 10);
        expect(p.x).toBeCloseTo(100);
        expect(p.y).toBeCloseTo(50);
        const parts = decompose(m, W / 2, H / 2);
        expect(parts.scale).toBeCloseTo(1.5);
        expect(parts.rotation).toBeCloseTo(0.3);
        close(compose(parts, W / 2, H / 2), m);
    });

    it('camera between the rest and the current transform maps rest positions onto the moved scene', () => {
        const current = moved(1);
        const camera = cameraBetween(rest, current);
        // 场景里某个点：没有运镜时在 rest 下的位置，套上运镜后应该等于当前容器变换下的位置。
        const local = { x: 900, y: 200 };
        const before = apply(fromParams(rest), local.x, local.y);
        const after = apply(fromParams(current), local.x, local.y);
        const mapped = apply(camera, before.x, before.y);
        expect(mapped.x).toBeCloseTo(after.x);
        expect(mapped.y).toBeCloseTo(after.y);
        close(cameraBetween(rest, rest), IDENTITY);
    });
});

describe('resolveFollow', () => {
    it('off, missing camera and amount 0 leave the asset alone', () => {
        close(resolveFollow('off', 1, 1, cameraAt, W, H), IDENTITY);
        close(resolveFollow(undefined, 1, 1, cameraAt, W, H), IDENTITY);
        close(resolveFollow('scene', 0, 1, cameraAt, W, H), IDENTITY);
        close(resolveFollow('scene', 1, 1, () => null, W, H), IDENTITY);
    });

    it('scene follows the shot camera and jumps at a cut; motion restarts from rest at each shot', () => {
        close(resolveFollow('scene', 1, 1.5, cameraAt, W, H), cameraAt(1.5).matrix);
        // 第二个镜头一开始就有 0.5 的运镜：scene 跟着跳，motion 从原位开始。
        close(resolveFollow('scene', 1, 2, cameraAt, W, H), cameraAt(2).matrix);
        close(resolveFollow('motion', 1, 2, cameraAt, W, H), IDENTITY);
        const motion = resolveFollow('motion', 1, 3, cameraAt, W, H);
        close(motion, multiply(cameraAt(3).matrix, invert(cameraAt(2).matrix)));
        expect(decompose(motion, W / 2, H / 2).scale).toBeGreaterThan(1);
    });

    it('amount scales zoom, rotation and centre travel about the frame centre', () => {
        const full = decompose(resolveFollow('scene', 1, 1, cameraAt, W, H), W / 2, H / 2);
        const half = decompose(resolveFollow('scene', 0.5, 1, cameraAt, W, H), W / 2, H / 2);
        expect(half.scale - 1).toBeCloseTo((full.scale - 1) / 2);
        expect(half.rotation).toBeCloseTo(full.rotation / 2);
        expect(half.dx).toBeCloseTo(full.dx / 2);
        expect(half.dy).toBeCloseTo(full.dy / 2);
    });
});
