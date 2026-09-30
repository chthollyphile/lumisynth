// 路线 E：构图 × 排版 × 点缀。排版与点缀可以逐镜头替换，不影响风格与其他镜头。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import type { EditOp, LumiProgram } from '@/compiler/types';
import { borrowableTypographies, getPack } from '@/packs/registry';
import type { SonnetShot } from '@/packs/sonnet/types';
import type { TemperaShot } from '@/packs/tempera/types';
import { syntheticSong } from './fixtures';

const lines = syntheticSong(71, true);
const base = { lines, seed: 'components' };
const reference = compileLumiProgram(base);
const target = reference.paragraphs[2].shots.find(shot => !shot.isBridge)!;
const op = (slot: string, value: string, anchor = target.anchor): EditOp => ({ id: `${slot}-${value}`, type: 'shot-component', anchor, slot, value });
const findShot = (program: LumiProgram) => program.paragraphs.flatMap(p => p.shots).find(shot => shot.id === target.id)!;

describe('shot components', () => {
    it('declares typography and accent slots for both packs and reports defaults', () => {
        expect(getPack('tempera').componentSlots?.map(slot => slot.id)).toEqual(['typography', 'accent']);
        expect(getPack('sonnet').componentSlots?.map(slot => slot.id)).toEqual(['typography', 'accent']);
        expect(target.components.typography).toBe('collage');
        expect(target.lockedComponents).toEqual([]);
        expect(getPack('tempera').textRegion?.('duo-split')).toMatchObject({ cx: 0.5, w: expect.any(Number) });
    });

    it('replaces typography and accent on one shot only', () => {
        const program = compileLumiProgram({ ...base, overrides: [op('typography', 'stack'), op('accent', 'none')] });
        const shot = findShot(program);
        const native = shot.native.shot as TemperaShot;
        expect(native.typography).toBe('stack');
        expect(native.decor.hidden).toBe(true);
        expect(shot.components).toEqual({ typography: 'stack', accent: 'none' });
        expect(shot.lockedComponents.sort()).toEqual(['accent', 'typography']);
        expect(shot.style).toBe(target.style);
        expect(program.invalidOps).toEqual([]);
        const others = program.paragraphs.flatMap(p => p.shots).filter(s => s.id !== target.id);
        expect(others.every(s => (s.native.shot as TemperaShot).typography === undefined)).toBe(true);
    });

    it('keeps the default representation when set back to collage', () => {
        const program = compileLumiProgram({ ...base, overrides: [op('typography', 'collage'), op('accent', 'doodle')] });
        const native = findShot(program).native.shot as TemperaShot;
        expect('typography' in native).toBe(false);
        expect(native.decor.motif).toBe('doodle');
    });

    it('replaces sonnet typography and accent without touching the composition', () => {
        const sonnetBase = { ...base, direction: { mode: 'single' as const, pack: 'sonnet', shotMixing: false } };
        const plain = compileLumiProgram(sonnetBase);
        const shot = plain.paragraphs[1].shots[0];
        const nativeKind = (shot.native.shot as SonnetShot).kind;
        expect(shot.components).toEqual({ typography: nativeKind, accent: 'standard' });
        expect(getPack('sonnet').textRegion?.(nativeKind)).toMatchObject({ cx: 0.5 });
        const other = nativeKind === 'poster-blocks' ? 'quiet-tableau' : 'poster-blocks';
        const program = compileLumiProgram({
            ...sonnetBase,
            overrides: [
                { id: 't', type: 'shot-component', anchor: shot.anchor, slot: 'typography', value: other },
                { id: 'a', type: 'shot-component', anchor: shot.anchor, slot: 'accent', value: 'none' },
            ],
        });
        const changed = program.paragraphs[1].shots[0];
        const native = changed.native.shot as SonnetShot;
        expect(native).toMatchObject({ kind: nativeKind, typography: other, accent: 'none' });
        expect(changed.components).toEqual({ typography: other, accent: 'none' });
        expect(program.invalidOps).toEqual([]);
        // 设回默认值时原生结构与没设置过相同。
        const reset = compileLumiProgram({
            ...sonnetBase,
            overrides: [
                { id: 't', type: 'shot-component', anchor: shot.anchor, slot: 'typography', value: nativeKind },
                { id: 'a', type: 'shot-component', anchor: shot.anchor, slot: 'accent', value: 'standard' },
            ],
        });
        expect(reset.paragraphs[1].shots[0].native.shot).toEqual(shot.native.shot);
    });

    it('lists unknown slots, unknown values and stale anchors', () => {
        const sonnetProgram = compileLumiProgram({ ...base, direction: { mode: 'single', pack: 'sonnet', shotMixing: false } });
        const sonnetShot = sonnetProgram.paragraphs[0].shots[0];
        const program = compileLumiProgram({
            ...base,
            direction: { mode: 'single', pack: 'sonnet', shotMixing: false },
            overrides: [
                op('typography', 'stack', sonnetShot.anchor),
                op('typography', 'nope', { ...target.anchor, line: { ...target.anchor.line, hash: 'deadbeef' } }),
            ],
        });
        expect(program.invalidOps.map(item => item.reason).sort()).toEqual(['anchor-missing', 'component-unknown']);
        const tempera = compileLumiProgram({ ...base, overrides: [op('typography', 'nope'), op('glow', 'x')] });
        expect(tempera.invalidOps.map(item => item.reason)).toEqual(['component-unknown', 'component-unknown']);
    });

    it("borrows another pack's typography into the host text region", () => {
        const program = compileLumiProgram({ ...base, overrides: [op('typography', 'sonnet/poster-blocks'), op('accent', 'none')] });
        const shot = findShot(program);
        const host = shot.native.shot as TemperaShot;
        expect(host.textHidden).toBe(true);
        expect(host.decor.hidden).toBe(true);
        expect(shot.style).toBe(target.style);
        expect(shot.components.typography).toBe('sonnet/poster-blocks');
        expect(shot.borrowedText).toMatchObject({ pack: 'sonnet', typography: 'poster-blocks' });
        const guest = shot.borrowedText!.native.shot as SonnetShot;
        expect(guest.kind).toBe('poster-blocks');
        // 宿主的段首镜头可能被转场预卷提前；客镜头按歌词的 span。
        expect(guest.startTime).toBeGreaterThanOrEqual(shot.startTime - 1e-6);
        expect(guest.startTime).toBeLessThan(shot.endTime);
        expect(shot.borrowedText!.hostRegion).toEqual(getPack('tempera').textRegion!(target.style.split('/')[1]));
        expect(program.invalidOps).toEqual([]);
        // 宿主包其余镜头不受影响（客镜头用独立的 chain）。
        const others = (p: LumiProgram) => p.paragraphs.flatMap(item => item.shots).filter(s => s.id !== target.id).map(s => s.native);
        expect(others(program)).toEqual(others(reference));
    });

    it("offers only other packs' exported typographies and rejects invalid borrowing", () => {
        const options = borrowableTypographies('tempera', target.style.split('/')[1]).map(item => item.value);
        expect(options).toContain('sonnet/poster-blocks');
        expect(options.some(value => value.startsWith('tempera/'))).toBe(false);
        expect(borrowableTypographies('sonnet', 'poster-blocks').map(item => item.value)).toContain('tempera/stack');
        // 同包的「借用」、不存在的包都不成立。
        for (const value of ['tempera/stack', 'nope/x', 'sonnet/nope']) {
            const program = compileLumiProgram({ ...base, overrides: [op('typography', value)] });
            expect(program.invalidOps.map(item => item.reason)).toEqual(['component-unknown']);
            expect(findShot(program).borrowedText).toBeUndefined();
        }
    });
});


describe('hanabi borrowed typography', () => {
    it('lends its typographies to other packs and borrows theirs as a host', () => {
        const hanabi = getPack('hanabi');
        expect(hanabi.typographyExports?.length).toBe(14);
        hanabi.typographyExports!.forEach(item => expect(hanabi.textRegion!(item.kind)).not.toBeNull());
        expect(borrowableTypographies('tempera', target.style.split('/')[1]).map(item => item.value)).toContain('hanabi/botan-band');
        const hosted = borrowableTypographies('hanabi', 'botan-band').map(item => item.value);
        expect(hosted).toContain('sonnet/poster-blocks');
        expect(hosted.some(value => value.startsWith('hanabi/'))).toBe(false);
    });

    it('builds a hanabi guest shot inside a tempera host', () => {
        const program = compileLumiProgram({ ...base, overrides: [op('typography', 'hanabi/obi-marker')] });
        const shot = findShot(program);
        expect((shot.native.shot as TemperaShot).textHidden).toBe(true);
        expect(shot.borrowedText).toMatchObject({ pack: 'hanabi', typography: 'obi-marker', guestRegion: getPack('hanabi').textRegion!('obi-marker') });
        expect((shot.borrowedText!.native.shot as { kind: string }).kind).toBe('obi-marker');
        expect(program.invalidOps).toEqual([]);
    });
});

describe('hanabi typography slot', () => {
    const pack = getPack('hanabi');
    const shot = { id: 'x', kind: 'kiku-center', slices: [], startTime: 0, endTime: 1, lyricEndTime: 1, isBridge: false };

    it("swaps in another preset's text treatment and keeps block / enter defaults following it", () => {
        const borrowed = pack.applyComponents!(shot, { typography: 'obi-marker' });
        expect(borrowed).toMatchObject({ typography: 'obi-marker' });
        expect(pack.describeShot(borrowed, []).components).toMatchObject({ typography: 'obi-marker', block: 'marker', enter: 'type' });
        // 与排版默认相同的色块不写进去；换回自己的排版就清掉。
        expect(pack.applyComponents!(borrowed, { block: 'marker' })).not.toHaveProperty('block');
        expect(pack.applyComponents!(borrowed, { typography: 'kiku-center' })).not.toHaveProperty('typography');
    });

    it('offers typographies of other packs to hanabi hosts', () => {
        expect(pack.componentSlots!.find(slot => slot.id === 'typography')!.options).toHaveLength(50);
        expect(borrowableTypographies('hanabi', 'kiku-center').map(item => item.value)).toContain('lumiere/crossed');
    });
});
