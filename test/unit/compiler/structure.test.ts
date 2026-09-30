import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { DEFAULT_ENGINE_PARAMS, FOLIA_COMPATIBLE_PARAMS, normalizeEngineParams } from '@/compiler/params';
import { classifyParagraph, classifyParagraphs, type ParagraphDraft } from '@/compiler/structure';
import { loadLyricFile } from '@/core/lyrics/load';
import type { Line } from '@/core/types';

const chorus = ['We carry the light', 'We sing through the night', 'The world is awake', 'And home is in sight'];
const verse = ['I walked along the river', 'The streets were quiet and cold'];
const otherVerse = ['Your letter came in winter', 'I read it by the window'];
const outro = ['The morning comes at last', 'We leave the past behind'];

const makeDrafts = (texts: string[][]): ParagraphDraft[] => {
    let sourceIndex = 0;
    return texts.map((paragraph, index) => ({
        boundary: index === 0 ? 'song-start' : 'time-gap',
        lines: paragraph.map((fullText, slot) => {
            const startTime = index * 80 + slot * 4.2;
            const endTime = startTime + 4;
            const line: Line = { fullText, startTime, endTime, words: [{ text: fullText, startTime, endTime }] };
            return { line, sourceIndex: sourceIndex++, renderEndTime: endTime };
        }),
    }));
};

const linesOf = (drafts: ParagraphDraft[]) => drafts.flatMap(draft => draft.lines.map(item => item.line));
const inferred = (texts: string[][]) => classifyParagraphs(makeDrafts(texts));

describe('whole-song lyric structure', () => {
    it('recognizes separated repeated choruses, including the final paragraph', () => {
        expect(inferred([verse, chorus, otherVerse, chorus])).toEqual(['lift', 'chorus', 'lift', 'chorus']);
    });

    it('normalizes case, punctuation, spacing and full-width text in Chinese, Japanese and English', () => {
        const refrain = ['照亮，心中的光！', '君の声を 思い出す…', 'ＷＥ carry the LIGHT!', 'And home is in sight'];
        const repeat = ['照亮心中的光', '君の声を思い出す', 'we CARRY the light', 'and   home is in sight.'];
        expect(inferred([refrain, verse, repeat])).toEqual(['chorus', 'lift', 'chorus']);
    });

    it('allows a minority of lines to change or be added', () => {
        const changed = [...chorus.slice(0, 3), 'A new ending for tonight'];
        const extended = [...chorus, 'We keep on singing'];
        expect(inferred([chorus, verse, changed, outro])).toEqual(['chorus', 'lift', 'chorus', 'outro']);
        expect(inferred([chorus, verse, extended, outro])).toEqual(['chorus', 'lift', 'chorus', 'outro']);
    });

    it('selects the group that returns at the most separated positions', () => {
        const kinds = inferred([verse, chorus, verse, chorus, otherVerse, chorus, outro]);
        expect(kinds.filter(kind => kind === 'chorus')).toHaveLength(3);
        expect(kinds[0]).toBe('verse');
        expect(kinds[2]).toBe('verse');
        expect(kinds[4]).toBe('lift');
    });

    it('uses lyric length and then first occurrence to break frequency ties deterministically', () => {
        expect(inferred([verse, chorus, verse, chorus, outro]).filter(kind => kind === 'chorus')).toHaveLength(2);
        expect(inferred([verse, chorus, verse, chorus, outro])[1]).toBe('chorus');
        const equalA = ['First line', 'Second one'];
        const equalB = ['Other line', 'Fourth one'];
        expect(inferred([equalA, equalB, equalA, equalB, outro]))
            .toEqual(['chorus', 'verse', 'chorus', 'verse', 'outro']);
    });

    it('does not treat adjacent repeats, single-line hooks or music symbols as choruses', () => {
        for (const texts of [
            [chorus, chorus, outro],
            [['Sing along tonight'], verse, ['Sing along tonight']],
            [['♪', '......'], verse, ['♪', '......']],
        ]) {
            expect(inferred(texts)).not.toContain('chorus');
        }
    });

    it('requires two distinct shared lines, rather than a repeated chant or one shared phrase', () => {
        const chantA = [...Array<string>(6).fill('Oh sing along'), 'The sun is rising'];
        const chantB = [...Array<string>(6).fill('Oh sing along'), 'The rain is falling'];
        expect(inferred([chantA, verse, chantB])).not.toContain('chorus');
        expect(inferred([chorus, verse, ['We carry the light', ...otherVerse, 'A different conclusion']])).not.toContain('chorus');
    });

    it('respects line order and prevents similarity chains from joining unrelated sections', () => {
        expect(inferred([chorus, verse, [...chorus].reverse()])).not.toContain('chorus');
        const [a, b, c, d] = chorus;
        const kinds = inferred([[a, b, c, d], verse, [a, b, c, 'Alternate ending'], otherVerse, [a, b, 'Alternate ending', 'Another line']]);
        expect(kinds[0]).toBe('chorus');
        expect(kinds[2]).toBe('chorus');
        expect(kinds[4]).not.toBe('chorus');
    });

    it('preserves existing rules when there is no reliable repetition', () => {
        const drafts = makeDrafts([verse, otherVerse, outro]);
        expect(classifyParagraphs(drafts)).toEqual(drafts.map((draft, index) => classifyParagraph(draft.lines, index, drafts.length)));
        expect(classifyParagraphs([])).toEqual([]);
    });

    it('does not promote short breath paragraphs before a chorus', () => {
        const drafts = makeDrafts([['Take a breath'], chorus, verse, chorus]);
        drafts[0].lines[0].renderEndTime = drafts[0].lines[0].line.startTime + 2;
        expect(classifyParagraphs(drafts)).toEqual(['breath', 'chorus', 'lift', 'chorus']);
    });

    it('keeps repeated pre-chorus sections from gaining a lift label', () => {
        const kinds = inferred([verse, chorus, verse, chorus, otherVerse, chorus]);
        expect(kinds[0]).toBe('verse');
        expect(kinds[2]).toBe('verse');
    });

    it('uses annotated choruses as references without promoting unrelated repeated verses', () => {
        const drafts = makeDrafts([chorus, verse, chorus, verse]);
        drafts[0].lines[0].line.songPart = 'Chorus';
        expect(classifyParagraphs(drafts)).toEqual(['chorus', 'verse', 'chorus', 'outro']);
    });

    it('protects songPart and isChorus markers from lyric inference', () => {
        const drafts = makeDrafts([chorus, verse, chorus, otherVerse, chorus, outro]);
        drafts[0].lines.forEach(({ line }) => { line.songPart = 'Verse'; });
        drafts[1].lines[0].line.songPart = 'Bridge';
        drafts[3].lines[0].line.isChorus = true;
        const kinds = classifyParagraphs(drafts);
        expect(kinds[0]).toBe('verse');
        expect(kinds[1]).toBe('break');
        expect(kinds[3]).toBe('chorus');
        // 显式副歌歌词不同，其他重复段不能抢占副歌性质。
        expect(kinds[2]).not.toBe('chorus');
        expect(kinds[4]).not.toBe('chorus');
    });

    it('compares full sections across different automatic size-cap splits', () => {
        const longChorus = [...chorus, ...outro, 'Our voices rise together', 'The song goes on forever'];
        const drafts = makeDrafts([longChorus, verse, longChorus]);
        const split = (draft: ParagraphDraft, cut: number): ParagraphDraft[] => [
            { lines: draft.lines.slice(0, cut), boundary: draft.boundary },
            { lines: draft.lines.slice(cut), boundary: 'duration-cap' },
        ];
        expect(classifyParagraphs([...split(drafts[0], 3), drafts[1], ...split(drafts[2], 5)]))
            .toEqual(['chorus', 'chorus', 'lift', 'chorus', 'chorus']);
        // 手动切分不能被当作时长上限重新合回原段。
        const manuallySplit = [...split(drafts[0], 3), drafts[1], ...split(drafts[2], 5)];
        manuallySplit[1].boundary = 'manual';
        expect(classifyParagraphs(manuallySplit)).not.toContain('chorus');
    });
});

describe('structure inference through the compiler', () => {
    const drafts = makeDrafts([verse, chorus, otherVerse, chorus]);
    const lines = linesOf(drafts);

    it('assigns repeated unannotated lyrics to the chorus pack in mix mode', () => {
        const program = compileLumiProgram({ lines, seed: 'repetition', direction: { mode: 'mix', pack: 'sonnet', shotMixing: false } });
        expect(program.paragraphs.map(paragraph => paragraph.kind)).toEqual(['lift', 'chorus', 'lift', 'chorus']);
        expect(program.paragraphs.map(paragraph => paragraph.direction.pack)).toEqual(['lumiere', 'tempera', 'lumiere', 'tempera']);
        for (const paragraph of program.paragraphs.filter(paragraph => paragraph.kind === 'chorus')) {
            expect(paragraph.shots.every(shot => shot.pack === 'tempera')).toBe(true);
        }
    });

    it('recognizes imported LRC through generated interlude placeholders and size caps', () => {
        const content = [
            ...chorus.map((text, index) => `[00:${String(2 + index * 4).padStart(2, '0')}.00]${text}`),
            '[00:40.00]I walked along the river',
            '[00:44.00]The streets were quiet and cold',
            ...chorus.map((text, index) => `[01:${String(20 + index * 4).padStart(2, '0')}.00]${text}`),
        ].join('\n');
        const loaded = loadLyricFile({ fileName: 'refrain.lrc', content });
        expect(loaded.data.lines.every(line => !line.songPart && !line.isChorus)).toBe(true);
        expect(loaded.data.lines.some(line => line.fullText === '......')).toBe(true);
        const program = compileLumiProgram({ lines: loaded.data.lines, seed: 'lrc', direction: { mode: 'mix', pack: 'sonnet', shotMixing: false } });
        const refrainLines = program.lines.filter(item => chorus.includes(item.line.fullText));
        expect(refrainLines).toHaveLength(8);
        for (const line of refrainLines) {
            const paragraph = program.paragraphs.find(item => item.lineIndices.includes(line.sourceIndex))!;
            expect(paragraph.kind).toBe('chorus');
            expect(paragraph.direction.pack).toBe('tempera');
        }
        expect(program.paragraphs.some(paragraph => paragraph.boundary === 'lyric-gap')).toBe(true);
        expect(program.paragraphs.every(paragraph => paragraph.lineIndices.length <= 6)).toBe(true);
    });

    it('preserves manual kinds and uses them before inferring adjacent lifts', () => {
        const reference = compileLumiProgram({ lines, seed: 'manual' });
        const program = compileLumiProgram({
            lines, seed: 'manual',
            structureEdits: [{ id: 'manual-break', type: 'kind', anchor: reference.paragraphs[1].anchor.line, kind: 'break' }],
        });
        expect(program.paragraphs[1]).toMatchObject({ kind: 'break', kindManual: true });
        expect(program.paragraphs[0].kind).toBe('verse');
        expect(program.invalidStructureEdits).toEqual([]);
        const uniqueLines = linesOf(makeDrafts([verse, otherVerse, outro]));
        const unique = compileLumiProgram({ lines: uniqueLines, seed: 'manual-chorus' });
        const manualChorus = compileLumiProgram({
            lines: uniqueLines, seed: 'manual-chorus',
            structureEdits: [{ id: 'manual-chorus', type: 'kind', anchor: unique.paragraphs[1].anchor.line, kind: 'chorus' }],
        });
        expect(manualChorus.paragraphs[0].kind).toBe('lift');
        expect(manualChorus.paragraphs[1]).toMatchObject({ kind: 'chorus', kindManual: true });
    });

    it('enables inference for older parameters and preserves the upstream compatibility mode', () => {
        expect(normalizeEngineParams({ paragraph: { recursiveSplit: false } }).paragraph.inferRepeatedLyrics).toBe(true);
        const { inferRepeatedLyrics, ...legacyParagraphParams } = DEFAULT_ENGINE_PARAMS.paragraph;
        const legacy = compileLumiProgram({ lines, seed: 'legacy', params: { paragraph: legacyParagraphParams, packs: {} } });
        expect(legacy.paragraphs.filter(paragraph => paragraph.kind === 'chorus')).toHaveLength(2);
        const compatible = compileLumiProgram({ lines, seed: 'compatible', params: FOLIA_COMPATIBLE_PARAMS });
        expect(compatible.paragraphs.map(paragraph => paragraph.kind)).toEqual(['verse', 'verse', 'verse', 'outro']);
    });
});
