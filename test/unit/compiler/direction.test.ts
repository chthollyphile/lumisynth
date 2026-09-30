import { describe, expect, it } from 'vitest';
import { allTransitions, getStyle } from '@/packs/registry';
import { compileLumiProgram } from '@/compiler/compile';
import { DEFAULT_MIX_BY_KIND, mixAssignment, mixOverrides, type EditOp, type StyleId } from '@/compiler/types';
import { hashText } from '@/core/lyrics/edits';
import { syntheticSong } from './fixtures';

const lines = syntheticSong(11, true);
const base = { lines, seed: 'direction' };
const allShots = (program: ReturnType<typeof compileLumiProgram>) => program.paragraphs.flatMap(p => p.shots);

describe('Direction', () => {
    it('mix mode splits packs by paragraph kind', () => {
        const program = compileLumiProgram({ ...base, direction: { mode: 'mix', pack: 'tempera', shotMixing: false } });
        const packs = new Set(program.paragraphs.map(p => p.direction.pack));
        // 三个内置包都会用上：副歌凝彩、上扬与间奏绘光、主歌 sonnet。
        expect(packs).toEqual(new Set(['tempera', 'sonnet', 'lumiere']));
        for (const paragraph of program.paragraphs) {
            expect(paragraph.shots.every(shot => shot.pack === paragraph.direction.pack)).toBe(true);
            if (paragraph.kind === 'chorus') expect(paragraph.direction.pack).toBe('tempera');
            if (paragraph.kind === 'lift' || paragraph.kind === 'break') expect(paragraph.direction.pack).toBe('lumiere');
            if (paragraph.kind === 'verse') expect(paragraph.direction.pack).toBe('sonnet');
        }
    });

    it('mix overrides sit on top of the default assignment and only differences are stored', () => {
        const program = compileLumiProgram({ ...base, direction: { mode: 'mix', pack: 'tempera', shotMixing: false, mixByKind: { chorus: 'lumiere' } } });
        program.paragraphs.forEach(paragraph => {
            if (paragraph.kind === 'chorus') expect(paragraph.direction.pack).toBe('lumiere');
            if (paragraph.kind === 'verse') expect(paragraph.direction.pack).toBe('sonnet');
        });
        expect(mixOverrides({ ...DEFAULT_MIX_BY_KIND, chorus: 'lumiere' })).toEqual({ chorus: 'lumiere' });
        expect(mixAssignment({ mixByKind: { verse: 'tempera' } })).toEqual({ ...DEFAULT_MIX_BY_KIND, verse: 'tempera' });
    });

    it('applies paragraph overrides and reports stale ones', () => {
        const reference = compileLumiProgram(base);
        const target = reference.paragraphs[1];
        const program = compileLumiProgram({
            ...base,
            paragraphDirections: [
                { anchor: target.anchor, pack: 'sonnet', source: 'user' },
                { anchor: { line: { index: 0, hash: hashText('not this line') } }, pack: 'sonnet', source: 'ai' },
            ],
        });
        expect(program.paragraphs[1].direction).toMatchObject({ pack: 'sonnet', source: 'user' });
        expect(program.paragraphs[1].shots.every(shot => shot.pack === 'sonnet')).toBe(true);
        expect(program.paragraphs[0].direction.pack).toBe('tempera');
        expect(program.invalidDirections).toHaveLength(1);
    });

    it('restricts shots to the requested families and energy', () => {
        const reference = compileLumiProgram(base);
        const program = compileLumiProgram({
            ...base,
            paragraphDirections: reference.paragraphs.map(p => ({ anchor: p.anchor, families: ['monolith', 'terrain'], source: 'user' as const })),
        });
        for (const shot of allShots(program)) {
            expect(['monolith', 'terrain']).toContain(getStyle(shot.style)!.family);
        }
        const quiet = compileLumiProgram({
            ...base,
            paragraphDirections: reference.paragraphs.map(p => ({ anchor: p.anchor, energy: 0.1, source: 'user' as const })),
        });
        for (const shot of allShots(quiet)) expect(getStyle(shot.style)!.mood).toBe('quiet');
        const loud = compileLumiProgram({
            ...base,
            paragraphDirections: reference.paragraphs.map(p => ({ anchor: p.anchor, energy: 0.9, source: 'user' as const })),
        });
        for (const shot of allShots(loud).filter(shot => !shot.isBridge)) {
            expect(getStyle(shot.style)!.mood).not.toBe('quiet');
        }
    });
});

describe('Cast library prefs', () => {
    it('never auto-picks a blocked style', () => {
        const reference = compileLumiProgram(base);
        const used = [...new Set(allShots(reference).map(shot => shot.style))];
        const program = compileLumiProgram({ ...base, library: { favorites: [], blocked: used } });
        const now = new Set(allShots(program).map(shot => shot.style));
        for (const style of used) expect(now.has(style)).toBe(false);
    });

    it('favorites make a style more frequent', () => {
        const favorite: StyleId = 'tempera/iris-hole';
        const count = (favorites: StyleId[]) => [1, 2, 3, 4, 5, 6].reduce((sum, seed) => sum + allShots(compileLumiProgram({
            lines: syntheticSong(seed, true), seed: `f${seed}`, library: { favorites, blocked: [] },
        })).filter(shot => shot.style === favorite).length, 0);
        expect(count([favorite])).toBeGreaterThan(count([]));
    });
});

describe('Overrides', () => {
    const reference = compileLumiProgram(base);
    const shot = reference.paragraphs[2].shots[1];

    it('locks a shot style and keeps the op valid', () => {
        const op: EditOp = { id: 'op1', type: 'shot-style', anchor: shot.anchor, style: 'tempera/chasm' };
        const program = compileLumiProgram({ ...base, overrides: [op] });
        const locked = allShots(program).find(item => item.id === shot.id)!;
        expect(locked.style).toBe('tempera/chasm');
        expect(locked.locked).toBe(true);
        expect(program.invalidOps).toEqual([]);
    });

    it('lists stale, cross-pack and unknown ops instead of dropping them', () => {
        const ops: EditOp[] = [
            { id: 'stale', type: 'shot-style', anchor: { line: { ...shot.anchor.line, hash: 'deadbeef' }, slot: shot.anchor.slot }, style: 'tempera/chasm' },
            { id: 'cross', type: 'shot-style', anchor: shot.anchor, style: 'sonnet/type-impact' },
            { id: 'unknown', type: 'shot-style', anchor: shot.anchor, style: 'tempera/nope' as StyleId },
        ];
        const program = compileLumiProgram({ ...base, overrides: ops });
        const reasons = Object.fromEntries(program.invalidOps.map(item => [item.op.id, item.reason]));
        expect(reasons).toEqual({ unknown: 'style-unknown', cross: 'pack-mismatch' , stale: 'anchor-missing' });
    });

    it('overrides and removes paragraph transitions', () => {
        const [first, second] = reference.paragraphs;
        const program = compileLumiProgram({
            ...base,
            overrides: [
                { id: 't1', type: 'transition', anchor: first.anchor, transition: 'sonnet/mono-glitch' },
                { id: 't2', type: 'transition', anchor: second.anchor, transition: 'none' },
            ],
        });
        expect(program.paragraphs[0].transitionOut).toMatchObject({ id: 'sonnet/mono-glitch', source: 'user' });
        const duration = program.paragraphs[0].transitionOut!.endTime - program.paragraphs[0].transitionOut!.startTime;
        expect(duration).toBeLessThanOrEqual(0.3 + 1e-9);
        expect(program.paragraphs[1].transitionOut).toBeNull();
        expect(allTransitions()).toHaveLength(13);
    });
});
