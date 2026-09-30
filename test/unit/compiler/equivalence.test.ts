// 路线 B 的验收：不给任何编排修改时，统一编译器的单包结果与 folia 的 compile*Program 逐字段相等。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { getPack } from '@/packs/registry';
import { FOLIA_COMPATIBLE_PARAMS } from '@/compiler/params';
import { compileSonnetProgram } from '@/packs/sonnet/sonnetProgram';
import { compileTemperaProgram } from '@/packs/tempera/temperaProgram';
import { foliaSongs, syntheticSong } from './fixtures';

const songs = [
    ...[1, 2, 3, 4].map(seed => ({ name: `synthetic-${seed}-word`, lines: syntheticSong(seed, true) })),
    ...[5, 6].map(seed => ({ name: `synthetic-${seed}-line`, lines: syntheticSong(seed, false) })),
    ...foliaSongs(),
];
const SEEDS = ['lumisynth', 'a', 42];

describe('unified compiler equals folia per pack', () => {
    it('has fixtures', () => {
        expect(songs.length).toBeGreaterThanOrEqual(6);
    });

    for (const song of songs) {
        for (const seed of SEEDS) {
            it(`tempera: ${song.name} / ${seed}`, () => {
                for (const wholeLine of [false, true]) {
                    const expected = compileTemperaProgram(song.lines, seed, { wholeLineLyrics: wholeLine });
                    const program = compileLumiProgram({
                        lines: song.lines,
                        seed,
                        direction: { mode: 'single', pack: 'tempera', shotMixing: false },
                        packTunings: { tempera: { wholeLineLyrics: wholeLine } },
                        params: FOLIA_COMPATIBLE_PARAMS,
                    });
                    expect(program.paragraphGapThreshold).toBe(expected.paragraphGapThreshold);
                    expect(program.paragraphs.map(p => getPack('tempera').toNativeParagraph(program, p).data)).toEqual(expected.paragraphs);
                    expect(program.invalidOps).toEqual([]);
                }
            });

            it(`sonnet: ${song.name} / ${seed}`, () => {
                const expected = compileSonnetProgram(song.lines, seed);
                const program = compileLumiProgram({
                    lines: song.lines,
                    seed,
                    direction: { mode: 'single', pack: 'sonnet', shotMixing: false },
                    params: FOLIA_COMPATIBLE_PARAMS,
                });
                expect(program.paragraphGapThreshold).toBe(expected.paragraphGapThreshold);
                expect(program.paragraphs.map(p => getPack('sonnet').toNativeParagraph(program, p).data)).toEqual(expected.paragraphs);
            });
        }
    }
});

describe('recursive paragraph split (lumisynth default)', () => {
    it('keeps every paragraph within the line cap unless one line alone exceeds it', () => {
        for (const song of songs) {
            const program = compileLumiProgram({ lines: song.lines, seed: 'split' });
            for (const paragraph of program.paragraphs) {
                expect(paragraph.lineIndices.length).toBeLessThanOrEqual(6);
            }
        }
    });
});
