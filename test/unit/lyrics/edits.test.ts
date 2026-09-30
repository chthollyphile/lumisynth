import { describe, expect, it } from 'vitest';
import type { LyricData } from '@/core/types';
import { compileLumiProgram } from '@/compiler/compile';
import { anchorOfLine, applyLyricEdits, EMPTY_LYRIC_EDITS, hashText, type LyricEdits } from '@/core/lyrics/edits';
import { loadLyricFile } from '@/core/lyrics/load';
import { createProject } from '@/project/defaults';
import { segmentationRepairFor, withLineBounds, withLineSegments, withLineText, withLineWords, withRepairedSegmentation, withoutLineText, withoutLineTiming } from '@/project/lyrics';
import type { LumiProject } from '@/project/types';
import { syntheticSong } from '../compiler/fixtures';

const lyrics: LyricData = {
    lines: [
        { startTime: 1, endTime: 3, fullText: '青い空', words: [{ text: '青い空', startTime: 1, endTime: 3 }] },
        { startTime: 4, endTime: 6, fullText: 'hello world', words: [
            { text: 'hello', startTime: 4, endTime: 5 },
            { text: 'world', startTime: 5, endTime: 6 },
        ] },
    ],
};

const edits = (patch: Partial<LyricEdits>): LyricEdits => ({ ...EMPTY_LYRIC_EDITS, ...patch });

describe('applyLyricEdits', () => {
    it('shifts everything by the global offset', () => {
        const { data, invalid } = applyLyricEdits(lyrics, edits({ offset: 0.5 }));
        expect(invalid).toEqual([]);
        expect(data.lines.map(line => [line.startTime, line.endTime])).toEqual([[1.5, 3.5], [4.5, 6.5]]);
        expect(data.lines[1].words[1]).toMatchObject({ startTime: 5.5, endTime: 6.5 });
        expect(lyrics.lines[0].startTime).toBe(1);
    });

    it('retimes a dragged line proportionally', () => {
        const { data } = applyLyricEdits(lyrics, edits({ lines: [{ anchor: anchorOfLine(lyrics.lines[1], 1), startTime: 4, endTime: 8 }] }));
        expect(data.lines[1].words.map(word => [word.startTime, word.endTime])).toEqual([[4, 6], [6, 8]]);
    });

    it('edits text keeping the timing of unchanged characters, and anchors stay on the source text', () => {
        const { data, invalid } = applyLyricEdits(lyrics, edits({ lines: [{ anchor: anchorOfLine(lyrics.lines[1], 1), text: 'hello there world' }] }));
        expect(invalid).toEqual([]);
        const line = data.lines[1];
        expect(line.fullText).toBe('hello there world');
        expect(line.words.map(word => word.text)).toEqual(['hello', 'there', 'world']);
        expect(line.words[0]).toMatchObject({ startTime: 4, endTime: 5 });
        expect(line.words[2].endTime).toBe(6);
        // 新词挤进紧挨着的 hello 与 world 之间：至少占 MIN_UNIT（world 往后让出这一点），前后不重叠。
        expect(line.words[2].startTime).toBeCloseTo(5.03);
        expect(line.words[1].startTime).toBeGreaterThanOrEqual(line.words[0].endTime);
        expect(line.words[1].endTime).toBeLessThanOrEqual(line.words[2].startTime);
        expect(anchorOfLine(line, 1)).toEqual(anchorOfLine(lyrics.lines[1], 1));
        expect(line.sourceHash).toBe(hashText('hello world'));
    });

    it('applies explicit word timing, normalized into the line', () => {
        const anchor = anchorOfLine(lyrics.lines[1], 1);
        const { data } = applyLyricEdits(lyrics, edits({ lines: [{
            anchor, startTime: 4, endTime: 7,
            words: [{ text: 'hello', startTime: 3, endTime: 5.5 }, { text: 'world', startTime: 5.2, endTime: 9 }],
        }] }));
        expect(data.lines[1]).toMatchObject({ startTime: 4, endTime: 7 });
        expect(data.lines[1].words.map(word => [word.startTime, word.endTime])).toEqual([[4, 5.5], [5.5, 7]]);
        // 对不上文字的逐字时间不用，退回按比例。
        const mismatched = applyLyricEdits(lyrics, edits({ lines: [{ anchor, words: [{ text: 'nope', startTime: 4, endTime: 6 }] }] }));
        expect(mismatched.data.lines[1].words.map(word => word.text)).toEqual(['hello', 'world']);
    });

    it('applies manual segmentation against the edited text and reports stale or invalid edits', () => {
        const { data, invalid } = applyLyricEdits(lyrics, edits({
            lines: [{ anchor: anchorOfLine(lyrics.lines[1], 1), text: 'hello big world' }],
            segments: [
                { anchor: anchorOfLine(lyrics.lines[0], 0), parts: ['青い', '空'] },
                { anchor: { index: 0, hash: hashText('changed') }, parts: ['青い空'] },
                { anchor: anchorOfLine(lyrics.lines[1], 1), parts: ['hello', ' world'] },
                { anchor: { index: 9, hash: 'x' }, parts: [] },
            ],
        }));
        expect(data.lines[0].wordSegments).toEqual(['青い', '空']);
        expect(data.lines[1].wordSegments).toBeUndefined();
        expect(invalid.map(edit => [edit.kind, edit.reason])).toEqual([
            ['segments', 'text-changed'], ['segments', 'invalid-segmentation'], ['segments', 'line-missing'],
        ]);
    });
});

describe('lyric edit actions', () => {
    const song = syntheticSong(33, true);
    const source: LyricData = { lines: song };
    const project0 = (): LumiProject => ({ ...createProject(), seed: 'lyrics', lyricEdits: { ...EMPTY_LYRIC_EDITS, offset: 0.25 } });
    const effective = (project: LumiProject) => applyLyricEdits(source, project.lyricEdits).data.lines;
    const compile = (project: LumiProject) => compileLumiProgram({
        lines: effective(project),
        seed: project.seed,
        paragraphDirections: project.paragraphDirections,
        overrides: project.overrides,
        structureEdits: project.structureEdits,
    });

    it('editing text does not invalidate anything anchored on the line', () => {
        const paragraph = compile(project0()).paragraphs[2];
        let project: LumiProject = {
            ...project0(),
            paragraphDirections: [{ anchor: paragraph.anchor, pack: 'sonnet', source: 'user' }],
            structureEdits: [{ id: 'k', type: 'kind', anchor: paragraph.anchor.line, kind: 'chorus' }],
        };
        const shot = compile(project).paragraphs[2].shots[0];
        project = { ...project, overrides: [{ id: 's', type: 'shot-style', anchor: shot.anchor, style: shot.style }] };
        const index = paragraph.lineIndices[0];
        const line = effective(project)[index];
        project = withLineText(project, paragraph.anchor.line, line, `${line.fullText}！`);
        const after = compile(project);
        expect(after.lines[index].line.fullText).toBe(`${line.fullText}！`);
        expect(after.invalidDirections).toEqual([]);
        expect(after.invalidOps).toEqual([]);
        expect(after.invalidStructureEdits).toEqual([]);
        expect(after.paragraphs[2]).toMatchObject({ kind: 'chorus', direction: { pack: 'sonnet' } });
        expect(after.paragraphs[2].shots[0].locked).toBe(true);
    });

    it('stores file times, keeps the edit minimal and resets text and timing separately', () => {
        let project = project0();
        const index = 4;
        const anchor = anchorOfLine(song[index], index);
        const line = () => effective(project)[index];
        project = withLineText(project, anchor, line(), `${line().fullText}X`);
        const edit = project.lyricEdits.lines[0];
        // 存的是偏移前的时间。
        expect(edit.startTime).toBeCloseTo(song[index].startTime);
        expect(edit.words![0].startTime).toBeCloseTo(song[index].words[0].startTime);
        expect(line().startTime).toBeCloseTo(song[index].startTime + 0.25);
        // 行拖长：明确的逐字时间按比例伸缩。
        const before = line();
        project = withLineBounds(project, anchor, before, { endTime: before.endTime + 1 });
        expect(line().endTime).toBeCloseTo(before.endTime + 1);
        expect(line().words.at(-1)!.endTime).toBeLessThanOrEqual(line().endTime + 1e-9);
        expect(line().words.at(-1)!.endTime).toBeGreaterThan(before.words.at(-1)!.endTime);
        // 恢复原始时间：字还在，逐字时间从原来的行重新推出来。
        project = withoutLineTiming(project, anchor);
        expect(line().fullText.endsWith('X')).toBe(true);
        expect(line().endTime).toBeCloseTo(song[index].endTime + 0.25);
        project = withoutLineText(project, anchor);
        expect(project.lyricEdits.lines).toEqual([]);
        expect(line().fullText).toBe(song[index].fullText);
    });

    it('sets explicit words only when they spell the line', () => {
        const project = project0();
        const index = 2;
        const anchor = anchorOfLine(song[index], index);
        const line = effective(project)[index];
        const shifted = line.words.map(word => ({ text: word.text, startTime: word.startTime + 0.01, endTime: word.endTime + 0.01 }));
        const next = withLineWords(project, anchor, line, shifted)!;
        expect(effective(next)[index].words[0].startTime).toBeCloseTo(line.words[0].startTime + 0.01);
        expect(withLineWords(project, anchor, line, [{ text: '別の歌詞', startTime: line.startTime, endTime: line.endTime }])).toBeNull();
    });

    it('offers a segmentation repair after a text edit and applies it', () => {
        let project = project0();
        const index = song.findIndex(item => /[぀-鿿]/.test(item.fullText) && item.fullText.length > 6);
        const anchor = anchorOfLine(song[index], index);
        const text = song[index].fullText;
        const parts = [text.slice(0, 2), text.slice(2, 4), text.slice(4)];
        project = withLineSegments(project, anchor, parts);
        expect(segmentationRepairFor(project, anchor, effective(project)[index])).toBeNull();
        project = withLineText(project, anchor, effective(project)[index], `${text.slice(0, 5)}新しい${text.slice(5)}`);
        const repair = segmentationRepairFor(project, anchor, effective(project)[index])!;
        expect(repair.join('')).toBe(effective(project)[index].fullText);
        expect(repair.slice(0, 1)).toEqual([parts[0]]);
        project = withRepairedSegmentation(project, anchor, effective(project)[index]);
        expect(applyLyricEdits(source, project.lyricEdits).invalid).toEqual([]);
        expect(effective(project)[index].wordSegments).toEqual(repair);
    });
});

describe('loadLyricFile', () => {
    it('routes by extension and content', () => {
        expect(loadLyricFile({ fileName: 'a.srt', content: '1\n00:00:01,000 --> 00:00:02,000\nhi\n' }).format).toBe('srt');
        expect(loadLyricFile({ fileName: 'a.lrc', content: '[00:01.00]hi\n[00:02.00]there' }).format).toBe('lrc');
        const loaded = loadLyricFile({ fileName: 'a.lrc', content: '[00:01.00]hi\n[00:01.00]你好\n[00:02.00]there' });
        expect(loaded.data.lines.find(line => line.fullText === 'hi')?.translation).toBe('你好');
    });
});
