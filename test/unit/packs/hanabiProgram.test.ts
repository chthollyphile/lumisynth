// 花火：编译（切块、间奏、选预设的三个钩子、族不连续）、时间安排（上升只由 t 决定）与注册。
import { describe, expect, it } from 'vitest';
import '@/packs/builtin';
import { compileLumiProgram } from '@/compiler/compile';
import { buildUnits } from '@/kernel/units';
import { getPack, listPacks } from '@/packs/registry';
import type { CastContext } from '@/packs/contract';
import type { ParagraphKind, UnifiedLine } from '@/compiler/types';
import type { Line } from '@/core/types';
import { HANABI_KINDS, HANABI_PROFILES, profileOf } from '@/packs/hanabi/catalog';
import {
    advanceChain,
    castShot,
    DEFAULT_HANABI_PARAMS,
    planShots,
    segmentHanabiLine,
    shotLine,
    sliceLine,
    splitLine,
    type HanabiChain,
    type HanabiParagraph,
    type HanabiShot,
} from '@/packs/hanabi/program';
import { buildTimeline, type TimelineShot } from '@/packs/hanabi/timeline';
import { syntheticSong } from '../compiler/fixtures';

const songLines = syntheticSong(7, true);
const compile = (seed = 'hanabi', overrides = {}) => compileLumiProgram({
    lines: songLines,
    seed,
    direction: { mode: 'single', pack: 'hanabi', shotMixing: false },
    ...overrides,
});

/** 逐字计时的一行：words 为 [文字, 秒数] 列表。 */
const timedLine = (start: number, words: Array<[string, number]>): Line => {
    let cursor = start;
    const timed = words.map(([text, duration]) => {
        const word = { text, startTime: cursor, endTime: cursor + duration };
        cursor += duration;
        return word;
    });
    return { fullText: words.map(([text]) => text).join(''), startTime: start, endTime: cursor, words: timed };
};

const unified = (index: number, line: Line): UnifiedLine => ({
    sourceIndex: index,
    line,
    renderEndTime: line.endTime,
    anchor: { index, hash: 'h' } as never,
    segments: {},
});

describe('花火的分词与切片', () => {
    const line = timedLine(10, [['夜空に', 0.6], ['光る', 0.5], ['星たち', 0.7]]);

    it('按逐字时间的词给出偏移与时间', () => {
        const segments = segmentHanabiLine(line);
        expect(segments.map(segment => [segment.startOffset, segment.endOffset])).toEqual([[0, 3], [3, 5], [5, 8]]);
        [10, 10.6, 11.1].forEach((time, index) => expect(segments[index]!.startTime).toBeCloseTo(time));
        expect(segments[2]!.endTime).toBeCloseTo(11.8);
    });

    it('切片按偏移裁词、时间按比例；整行原样返回', () => {
        expect(sliceLine(line, 0, line.fullText.length)).toBe(line);
        const tail = sliceLine(line, 4, 8);
        expect(tail.fullText).toBe('る星たち');
        expect(tail.words.map(word => word.text)).toEqual(['る', '星たち']);
        expect(tail.startTime).toBeCloseTo(10.85);
        expect(tail.endTime).toBeCloseTo(11.8);
    });

    it('跨行的切片拼成一行，中间加空格', () => {
        const other = timedLine(20, [['hold ', 0.3], ['on', 0.3]]);
        const merged = shotLine(new Map([[0, line], [1, other]]), [
            { lineIndex: 0, startOffset: 5, endOffset: 8 },
            { lineIndex: 1, startOffset: 0, endOffset: other.fullText.length },
        ])!;
        expect(merged.fullText).toBe('星たち hold on');
        expect(merged.startTime).toBeCloseTo(11.1);
        expect(merged.endTime).toBeCloseTo(20.6);
        expect(shotLine(new Map(), [])).toBeNull();
    });
});

describe('花火的切块', () => {
    it('长行（超过 18 个字）在最接近等分处的词边界切开，切片首尾相接', () => {
        const words: Array<[string, number]> = ['春の風が', '吹いて', '君の声を', '思い出す', '夜空に', '光る星たち', '遠い街で'].map(text => [text, 0.5]);
        const line = timedLine(0, words);
        expect(Array.from(line.fullText).length).toBeGreaterThan(18);
        const pieces = splitLine(unified(3, line), DEFAULT_HANABI_PARAMS);
        expect(pieces.length).toBe(2);
        expect(pieces[0]!.slice.startOffset).toBe(0);
        expect(pieces[0]!.slice.endOffset).toBe(pieces[1]!.slice.startOffset);
        expect(pieces[1]!.slice.endOffset).toBe(line.fullText.length);
        // 切口落在词边界上。
        const boundaries = segmentHanabiLine(line).map(segment => segment.startOffset);
        expect(boundaries).toContain(pieces[1]!.slice.startOffset);
        expect(pieces[1]!.startTime).toBeGreaterThan(pieces[0]!.startTime);
        expect(pieces.every(piece => piece.slice.lineIndex === 3)).toBe(true);
    });

    it('长于 6 秒的行也切开；短行不切', () => {
        const slow = timedLine(0, [['ゆっくり', 2.5], ['歌う', 2.5], ['夜', 2.5]]);
        expect(splitLine(unified(0, slow), DEFAULT_HANABI_PARAMS).length).toBe(2);
        const short = timedLine(0, [['短い', 1], ['歌', 1]]);
        expect(splitLine(unified(0, short), DEFAULT_HANABI_PARAMS)).toHaveLength(1);
    });

    it('一行一个镜头，首尾相接；行后空隙 ≥ 3 秒出间奏镜头', () => {
        const lines = [
            unified(0, timedLine(0, [['一', 1], ['二', 1]])),
            unified(1, timedLine(2.2, [['三', 1], ['四', 1]])),
            unified(2, timedLine(8, [['五', 1], ['六', 1]])),
        ];
        const shots = planShots(lines, 0, 10, DEFAULT_HANABI_PARAMS);
        expect(shots.map(shot => shot.isBridge)).toEqual([false, false, true, false]);
        expect(shots.map(shot => shot.slot)).toEqual(['s0', 's0', null, 's0']);
        expect(shots[1]!.endTime).toBeCloseTo(4.8);
        expect(shots[2]).toMatchObject({ startTime: shots[1]!.endTime, endTime: 8, slices: [] });
        shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime));
        expect(shots.at(-1)!.endTime).toBe(10);
    });
});

describe('花火的选预设', () => {
    const baseCast: CastContext = { filterCandidates: null, energy: null, forceKind: null };
    const pick = (cast: Partial<CastContext>, kind: ParagraphKind = 'verse', shotIndex = 0, chain: HanabiChain = { recent: [], family: null }, isBridge = false) => castShot({
        seed: 's', paragraphIndex: 0, shotIndex, kind, isBridge,
        slot: { lineIndex: isBridge ? null : 0, slot: isBridge ? 'b0' : 's0' }, cast: { ...baseCast, ...cast }, chain,
    });

    it('锁定的预设直接用，未知的忽略', () => {
        expect(pick({ forceKind: () => 'yanagi-ame' })).toBe('yanagi-ame');
        expect(HANABI_KINDS).toContain(pick({ forceKind: () => 'nope' }));
    });

    it('候选过滤生效', () => {
        const allowed = HANABI_PROFILES.filter(profile => profile.family === 'obi').map(profile => profile.kind);
        for (let i = 0; i < 20; i += 1) expect(allowed).toContain(pick({ filterCandidates: () => allowed }, 'chorus', i));
    });

    it('energy：低能量不选喧哗的、高能量不选安静的；没有 energy 时副歌不选安静的', () => {
        for (let i = 0; i < 40; i += 1) {
            expect(profileOf(pick({ energy: 0.1 }, 'chorus', i)).mood).not.toBe('loud');
            expect(profileOf(pick({ energy: 0.9 }, 'verse', i)).mood).not.toBe('quiet');
            expect(profileOf(pick({}, 'chorus', i)).mood).not.toBe('quiet');
        }
    });

    it('族不连续重复，最近用过的不马上再用，间奏偏向烟花多的族', () => {
        const chain: HanabiChain = { recent: [], family: null };
        let previous: string | null = null;
        for (let i = 0; i < 60; i += 1) {
            const kind = pick({}, 'chorus', i, chain);
            if (previous) expect(profileOf(kind).family).not.toBe(profileOf(previous).family);
            expect(chain.recent).not.toContain(kind);
            advanceChain(chain, kind);
            previous = kind;
        }
        for (let i = 0; i < 20; i += 1) {
            expect(['senrin', 'uchiage', 'kiku', 'shakudama']).toContain(profileOf(pick({}, 'break', i, { recent: [], family: null }, true)).family);
        }
    });
});

describe('花火的时间安排', () => {
    const cam = { rise: 0.5, push: 0.05, roll: 0.01, punch: 0.5 };
    const shots: TimelineShot[] = [
        { startTime: 0, endTime: 3, firstSung: 0.2, lastSungEnd: 2.8, isBridge: false, camera: cam },
        { startTime: 3, endTime: 6, firstSung: 3, lastSungEnd: 5.9, isBridge: false, camera: cam },
        { startTime: 6, endTime: 9, firstSung: null, lastSungEnd: null, isBridge: true, camera: cam },
    ];
    const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 9, height: 1000, riseSpeed: 1, motion: 1 });

    it('每个镜头放在上一个的上方；文字在第一个字被唱到之前入场，退场在下一个边界的上升里', () => {
        const [a, b] = timeline.shots;
        expect(timeline.shots.map(shot => shot.worldY)).toEqual([0, -500, -1000]);
        expect(b!.enterAt).toBeLessThan(3);
        expect(b!.launchAt).toBeCloseTo(b!.enterAt - 0.45);
        expect(a!.exitAt).toBeGreaterThanOrEqual(b!.riseIn!.from);
        expect(a!.exitAt).toBeLessThanOrEqual(3);
        expect(a!.exitAt + a!.exitDuration).toBeLessThanOrEqual(b!.riseIn!.to + 1e-9);
    });

    it('rise(t) 连续、只由 t 决定，边界处上升一个镜头的距离', () => {
        let last = timeline.rise(0);
        for (let t = 0; t <= 9; t += 0.01) {
            const value = timeline.rise(t);
            expect(Math.abs(value - last)).toBeLessThan(20);
            expect(value).toBeGreaterThanOrEqual(last - 1e-6);
            last = value;
        }
        expect(timeline.rise(4.5)).toBeCloseTo(500, 0);
        expect(timeline.rise(1.234)).toBe(timeline.rise(1.234));
        expect(timeline.shotAt(3.5)).toBe(1);
    });

    it('上升速度为 0 时镜头原地切换', () => {
        const flat = buildTimeline(shots, { unitStart: 0, unitEnd: 9, height: 1000, riseSpeed: 0, motion: 1 });
        expect(flat.shots.every(shot => shot.worldY === 0)).toBe(true);
        expect(flat.rise(5)).toBe(0);
    });
});

describe('花火编译整首歌', () => {
    const program = compile();

    it('自动发现并排在内置包的最后', () => {
        expect(listPacks().map(pack => pack.id).at(-1)).toBe('hanabi');
        expect(getPack('hanabi').styles).toHaveLength(50);
    });

    it('全曲都是花火，镜头首尾相接、覆盖每一行，结果确定', () => {
        expect(program.paragraphs.every(paragraph => paragraph.direction.pack === 'hanabi')).toBe(true);
        expect(compile()).toEqual(program);
        let previousFamily: string | null = null;
        for (const paragraph of program.paragraphs) {
            const shots = paragraph.shots;
            expect(shots.length).toBeGreaterThan(0);
            shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime, 6));
            const covered = new Set(shots.flatMap(shot => (shot.native.shot as HanabiShot).slices.map(slice => slice.lineIndex)));
            paragraph.lineIndices.forEach(index => expect(covered.has(index)).toBe(true));
            for (const shot of shots) {
                const family = profileOf((shot.native.shot as HanabiShot).kind).family;
                if (previousFamily) expect(family).not.toBe(previousFamily);
                previousFamily = family;
                expect(Object.keys(shot.components).sort()).toEqual(['block', 'burst', 'enter', 'typography']);
            }
        }
        expect(program.paragraphs.flatMap(paragraph => (paragraph.transitionOut ? [paragraph.transitionOut.id] : []))
            .every(id => id.startsWith('hanabi/'))).toBe(true);
    });

    it('describeShot 的切片是行内真实偏移', () => {
        for (const paragraph of program.paragraphs) {
            for (const shot of paragraph.shots) {
                const native = shot.native.shot as HanabiShot;
                const { span } = getPack('hanabi').describeShot(native, program.lines);
                expect(span.slices).toEqual(native.slices);
                span.slices.forEach(slice => {
                    expect(slice.endOffset).toBeGreaterThan(slice.startOffset);
                    expect(slice.endOffset).toBeLessThanOrEqual(program.lines[slice.lineIndex]!.line.fullText.length);
                });
            }
        }
    });

    it('锁定预设与替换组件经 EditOp 生效；与默认相同的组件不写进原生结构', () => {
        const target = program.paragraphs[1]!.shots.find(shot => !shot.isBridge)!;
        const locked = compile('hanabi', {
            overrides: [
                { id: 'a', type: 'shot-style', anchor: target.anchor, style: 'hanabi/obi-ticket' },
                { id: 'b', type: 'shot-component', anchor: target.anchor, slot: 'burst', value: 'heart' },
                { id: 'c', type: 'shot-component', anchor: target.anchor, slot: 'block', value: 'ticket' },
            ],
        });
        expect(locked.invalidOps).toEqual([]);
        const shot = locked.paragraphs[1]!.shots.find(item => item.id === target.id)!;
        expect(shot).toMatchObject({ style: 'hanabi/obi-ticket', locked: true });
        expect(shot.components).toMatchObject({ burst: 'heart', block: 'ticket', enter: 'flip' });
        const native = shot.native.shot as HanabiShot;
        expect(native.burst).toBe('heart');
        expect(native.block).toBeUndefined();
    });

    it('energy 钩子经段落方向生效', () => {
        const calm = compileLumiProgram({
            lines: songLines,
            seed: 'hanabi',
            direction: { mode: 'single', pack: 'hanabi', shotMixing: false },
            paragraphDirections: program.paragraphs.map(paragraph => ({ anchor: paragraph.anchor, energy: 0, source: 'user' as const })),
        });
        calm.paragraphs.forEach(paragraph => paragraph.shots.forEach(shot => {
            expect(profileOf((shot.native.shot as HanabiShot).kind).mood).not.toBe('loud');
        }));
    });

    it('单元：原生段落带着镜头用到的行', () => {
        const units = buildUnits(program);
        expect(units.length).toBe(program.paragraphs.length);
        units.forEach(unit => {
            const data = unit.native.paragraph as HanabiParagraph;
            expect(unit.native.id).toBe(`hanabi-p${unit.paragraph.index}`);
            expect(data.lines.length).toBe(data.lineIndices.length);
            data.shots.flatMap(shot => shot.slices).forEach(slice => expect(data.lineIndices).toContain(slice.lineIndex));
        });
    });

    it('别的包的镜头可以换成花火（按 shot 混用）', () => {
        const reference = compileLumiProgram({ lines: songLines, seed: 'mix', direction: { mode: 'single', pack: 'tempera', shotMixing: true } });
        const lyricShot = reference.paragraphs[1]!.shots.find(shot => !shot.isBridge)!;
        const mixed = compileLumiProgram({
            lines: songLines,
            seed: 'mix',
            direction: { mode: 'single', pack: 'tempera', shotMixing: true },
            overrides: [{ id: 'a', type: 'shot-style', anchor: lyricShot.anchor, style: 'hanabi/kiku-ring' }],
        });
        expect(mixed.invalidOps).toEqual([]);
        const converted = mixed.paragraphs[1]!.shots.find(shot => shot.id === lyricShot.id)!;
        expect(converted).toMatchObject({ pack: 'hanabi', style: 'hanabi/kiku-ring', locked: true });
        expect((converted.native.shot as HanabiShot).slices.length).toBeGreaterThan(0);
    });
});
