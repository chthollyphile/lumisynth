import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { getPack } from '@/packs/registry';
import type { SonnetCompiledLine, SonnetParagraph, SonnetSemanticSegment, SonnetShot } from '@/packs/sonnet/types';
import type { TemperaShot } from '@/packs/tempera/types';
import type { EditOp, LumiProgram, StyleId } from '@/compiler/types';
import { buildUnits } from '@/kernel/units';
import { syntheticSong } from './fixtures';

const lines = syntheticSong(31, true);
const base = { lines, seed: 'mixing' };
const lockOp = (program: LumiProgram, paragraph: number, shot: number, style: StyleId): EditOp => ({
    id: `${paragraph}-${shot}`,
    type: 'shot-style',
    anchor: program.paragraphs[paragraph].shots[shot].anchor,
    style,
});

describe('shot mixing', () => {
    const reference = compileLumiProgram(base);
    const target = reference.paragraphs[1];
    const lyricShotIndex = target.shots.findIndex(shot => !shot.isBridge && shot.lineIndices.length > 0);

    it('reports cross-pack locks as pack-mismatch while mixing is off', () => {
        const program = compileLumiProgram({ ...base, overrides: [lockOp(reference, 1, lyricShotIndex, 'sonnet/type-impact')] });
        expect(program.invalidOps.map(item => item.reason)).toEqual(['pack-mismatch']);
        expect(program.paragraphs[1].shots[lyricShotIndex].pack).toBe('tempera');
    });

    it('renders a tempera half-phrase slice as a sonnet shot over only that slice', () => {
        const program = compileLumiProgram({
            ...base,
            direction: { mode: 'single', pack: 'tempera', shotMixing: true },
            overrides: [lockOp(reference, 1, lyricShotIndex, 'sonnet/type-impact')],
        });
        expect(program.invalidOps).toEqual([]);
        const original = reference.paragraphs[1].shots[lyricShotIndex];
        const converted = program.paragraphs[1].shots[lyricShotIndex];
        expect(converted).toMatchObject({ pack: 'sonnet', style: 'sonnet/type-impact', locked: true, id: original.id });
        // 段首的 tempera 镜头会被预卷提前；换成 sonnet 后不再预卷，所以只比终点。
        expect(converted.endTime).toBe(original.endTime);
        expect([converted.native.pack, original.native.pack]).toEqual(['sonnet', 'tempera']);
        const slice = (original.native.shot as TemperaShot).slices[0];
        const expectedText = (program.lines[slice.lineIndex].segments.sonnet as SonnetSemanticSegment[])
            .slice(slice.segmentStart, slice.segmentEnd).map(segment => segment.text).join('');
        const pseudo = (converted.native.extra as { lines: SonnetCompiledLine[] }).lines;
        expect(pseudo[0].sourceIndex).toBeLessThan(0);
        expect(pseudo[0].segments.map(segment => segment.text).join('')).toBe(expectedText);
        expect((converted.native.shot as SonnetShot).lineIndices).toEqual(pseudo.map(line => line.sourceIndex));
        // 其余镜头不受影响。
        program.paragraphs[1].shots.forEach((shot, index) => {
            if (index !== lyricShotIndex) expect(shot.style).toBe(reference.paragraphs[1].shots[index].style);
        });
    });

    it('renders a sonnet group as a tempera shot with whole-line slices', () => {
        const sonnetRef = compileLumiProgram({ ...base, direction: { mode: 'single', pack: 'sonnet', shotMixing: true } });
        const program = compileLumiProgram({
            ...base,
            direction: { mode: 'single', pack: 'sonnet', shotMixing: true },
            overrides: [lockOp(sonnetRef, 2, 0, 'tempera/chasm')],
        });
        const shot = program.paragraphs[2].shots[0];
        expect(shot).toMatchObject({ pack: 'tempera', style: 'tempera/chasm' });
        const native = shot.native.shot as TemperaShot;
        expect(native.slices.map(slice => slice.lineIndex)).toEqual(sonnetRef.paragraphs[2].shots[0].lineIndices);
        expect(Number.isFinite(native.flowAngle)).toBe(true);
    });

    it('splits a mixed paragraph into same-pack units with short boundary transitions', () => {
        const program = compileLumiProgram({
            ...base,
            direction: { mode: 'single', pack: 'tempera', shotMixing: true },
            overrides: [lockOp(reference, 1, lyricShotIndex, 'sonnet/type-impact')],
        });
        const units = buildUnits(program);
        const plain = buildUnits(reference);
        const extra = lyricShotIndex === 0 || lyricShotIndex === target.shots.length - 1 ? 1 : 2;
        expect(units.length).toBe(plain.length + extra);
        const mine = units.filter(unit => unit.paragraph.id === target.id);
        expect(mine.map(unit => unit.pack)).toContain('sonnet');
        for (let i = 0; i < mine.length - 1; i += 1) {
            expect(mine[i].endTime).toBe(mine[i + 1].startTime);
            expect(mine[i].transitionOut?.endTime).toBe(mine[i + 1].startTime);
            expect(mine[i].transitionOut?.id).toBe(mine[i + 1].pack === 'tempera' ? 'tempera/shape-carry' : 'sonnet/fast-blur');
        }
        expect(mine.at(-1)!.transitionOut).toEqual(target.transitionOut);
        const sonnetUnit = mine.find(unit => unit.pack === 'sonnet')!;
        const sonnetParagraph = sonnetUnit.native.paragraph as SonnetParagraph;
        const shotLines = sonnetParagraph.shots[0].lineIndices;
        for (const index of shotLines) {
            expect(sonnetParagraph.lines.some(line => line.sourceIndex === index)).toBe(true);
        }
        expect(new Set(units.map(unit => unit.key)).size).toBe(units.length);
        // 整段转 sonnet 原生结构时只取 sonnet 镜头（伪行随之带上）。
        expect(getPack('sonnet').toNativeParagraph(program, program.paragraphs[1]).data.shots.length).toBe(1);
    });
});
