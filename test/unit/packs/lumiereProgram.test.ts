// 绘光 L1：编译（切块、选光位、间奏、锁定、组件槽、跨包转换）与内核单元。
import { describe, expect, it } from 'vitest';
import '@/packs/builtin';
import { compileLumiProgram } from '@/compiler/compile';
import { buildUnits } from '@/kernel/units';
import { borrowableTypographies, getPack } from '@/packs/registry';
import type { CastContext } from '@/packs/contract';
import { LUMIERE_PROFILES, profileOf } from '@/packs/lumiere/catalog';
import { castShot, DEFAULT_LUMIERE_PARAMS, planShots, type LumiereParagraph, type LumiereShot } from '@/packs/lumiere/program';
import type { ParagraphKind, UnifiedLine } from '@/compiler/types';
import { syntheticSong } from '../compiler/fixtures';

const lines = syntheticSong(7, true);
const compile = (seed = 'lumiere', overrides = {}) => compileLumiProgram({
    lines,
    seed,
    direction: { mode: 'single', pack: 'lumiere', shotMixing: false },
    ...overrides,
});

const fakeLine = (index: number, start: number, end: number): UnifiedLine => ({
    sourceIndex: index,
    line: { fullText: 'x', startTime: start, endTime: end, words: [] },
    renderEndTime: end,
    anchor: { index, hash: 'h' } as never,
    segments: {},
});

describe('绘光的切块', () => {
    it('短行两两合一个镜头，长行单独；镜头首尾相接，覆盖整段', () => {
        const shots = planShots([
            fakeLine(0, 0, 2), fakeLine(1, 2, 4), fakeLine(2, 4, 9), fakeLine(3, 9, 11), fakeLine(4, 11, 13),
        ], 0, 14, DEFAULT_LUMIERE_PARAMS);
        expect(shots.map(shot => shot.lines.map(line => line.sourceIndex))).toEqual([[0, 1], [2], [3, 4]]);
        expect(shots[0]!.startTime).toBe(0);
        shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime));
        expect(shots.at(-1)!.endTime).toBe(14);
    });

    it('行后的空隙超过阈值时出间奏镜头', () => {
        const shots = planShots([fakeLine(0, 0, 3), fakeLine(1, 10, 13)], 0, 13, DEFAULT_LUMIERE_PARAMS);
        expect(shots.map(shot => shot.isBridge)).toEqual([false, true, false]);
        expect(shots[0]!.endTime).toBeCloseTo(3.6);
        expect(shots[1]).toMatchObject({ startTime: 3.6, endTime: 10, lines: [] });
    });
});

describe('绘光的选光位', () => {
    const baseCast: CastContext = { filterCandidates: null, energy: null, forceKind: null };
    const pick = (cast: Partial<CastContext>, kind: ParagraphKind = 'verse', shotIndex = 0, isBridge = false) => castShot({
        seed: 's', paragraphIndex: 0, shotIndex, kind, isBridge,
        slot: { lineIndex: 0, slot: 's0' }, cast: { ...baseCast, ...cast }, chain: { recent: [], family: null },
    });

    it('锁定的光位直接用', () => {
        expect(pick({ forceKind: () => 'zenith-well' })).toBe('zenith-well');
    });

    it('低能量不选喧哗的、副歌偏喧哗与中性', () => {
        for (let i = 0; i < 40; i += 1) {
            expect(profileOf(pick({ energy: 0.1 }, 'verse', i)).mood).not.toBe('loud');
            expect(profileOf(pick({}, 'chorus', i)).mood).not.toBe('quiet');
        }
    });

    it('间奏不选喧哗的；最近用过的不马上再用', () => {
        for (let i = 0; i < 20; i += 1) expect(profileOf(pick({}, 'verse', i, true)).mood).not.toBe('loud');
        const recent = LUMIERE_PROFILES.filter(profile => profile.mood !== 'loud').slice(0, 3).map(profile => profile.kind);
        const kind = castShot({
            seed: 's', paragraphIndex: 0, shotIndex: 1, kind: 'verse', isBridge: false,
            slot: { lineIndex: 0, slot: 's0' }, cast: baseCast, chain: { recent, family: null },
        });
        expect(recent).not.toContain(kind);
    });
});

describe('绘光编译整首歌', () => {
    const program = compile();

    it('全曲都是绘光，镜头最多两行、首尾相接，结果确定', () => {
        expect(program.paragraphs.every(paragraph => paragraph.direction.pack === 'lumiere')).toBe(true);
        expect(compile()).toEqual(program);
        for (const paragraph of program.paragraphs) {
            const shots = paragraph.shots;
            expect(shots.length).toBeGreaterThan(0);
            shots.forEach(shot => {
                expect(shot.style.startsWith('lumiere/')).toBe(true);
                expect((shot.native.shot as LumiereShot).lineIndices.length).toBeLessThanOrEqual(2);
            });
            shots.slice(1).forEach((shot, index) => expect(shot.startTime).toBeCloseTo(shots[index]!.endTime, 6));
            // 每一行都落在某个镜头里。
            const covered = new Set(shots.flatMap(shot => (shot.native.shot as LumiereShot).lineIndices));
            paragraph.lineIndices.forEach(index => expect(covered.has(index)).toBe(true));
        }
        expect(program.paragraphs.flatMap(paragraph => paragraph.transitionOut ? [paragraph.transitionOut.id] : [])
            .every(id => id.startsWith('lumiere/'))).toBe(true);
    });

    it('锁定风格与替换组件都经 EditOp 生效', () => {
        const target = program.paragraphs[1]!.shots[0]!;
        const locked = compile('lumiere', {
            overrides: [
                { id: 'a', type: 'shot-style', anchor: target.anchor, style: 'lumiere/zenith-rain' },
                { id: 'b', type: 'shot-component', anchor: target.anchor, slot: 'typography', value: 'crossed' },
            ],
        });
        const shot = locked.paragraphs[1]!.shots[0]!;
        expect(shot).toMatchObject({ style: 'lumiere/zenith-rain', locked: true });
        expect(shot.components.typography).toBe('crossed');
        // 光雨默认是竖排，改成纵横交错后写进原生结构；改回默认就不写。
        expect((shot.native.shot as LumiereShot).typography).toBe('crossed');
        const pack = getPack('lumiere');
        expect((pack.applyComponents!(shot.native.shot, { typography: 'vertical' }) as LumiereShot).typography).toBeUndefined();
        expect(locked.invalidOps).toEqual([]);
    });

    it('单元：只在全曲开头或与上一段隔开时播放开场，原生段落带着本段的行', () => {
        const units = buildUnits(program);
        expect(units.length).toBe(program.paragraphs.length);
        units.forEach(unit => {
            const data = unit.native.paragraph as LumiereParagraph;
            expect(unit.native.id).toBe(`lumiere-p${unit.paragraph.index}`);
            const previous = program.paragraphs[unit.paragraph.index - 1];
            expect(data.opening).toBe(!previous || unit.paragraph.startTime - previous.endTime >= 2.5);
            expect(data.lines.length).toBe(data.lineIndices.length);
            unit.paragraph.lineIndices.forEach(index => expect(data.lineIndices).toContain(index));
        });
    });
});

describe('跨包：别的包的镜头换成绘光', () => {
    it('按 shot 混用时锁定成绘光光位，间奏也能转', () => {
        const reference = compileLumiProgram({ lines, seed: 'mix', direction: { mode: 'single', pack: 'tempera', shotMixing: true } });
        const paragraph = reference.paragraphs.find(p => p.shots.some(s => s.isBridge)) ?? reference.paragraphs[1]!;
        const lyricShot = paragraph.shots.find(s => !s.isBridge)!;
        const bridge = paragraph.shots.find(s => s.isBridge);
        const program = compileLumiProgram({
            lines,
            seed: 'mix',
            direction: { mode: 'single', pack: 'tempera', shotMixing: true },
            overrides: [
                { id: 'a', type: 'shot-style', anchor: lyricShot.anchor, style: 'lumiere/zenith-halo' },
                ...(bridge ? [{ id: 'b', type: 'shot-style' as const, anchor: bridge.anchor, style: 'lumiere/zenith-ember' }] : []),
            ],
        });
        const converted = program.paragraphs[paragraph.index]!.shots.find(s => s.id === lyricShot.id)!;
        expect(converted).toMatchObject({ pack: 'lumiere', style: 'lumiere/zenith-halo', locked: true });
        if (bridge) {
            expect(program.paragraphs[paragraph.index]!.shots.find(s => s.id === bridge.id)).toMatchObject({ pack: 'lumiere', style: 'lumiere/zenith-ember' });
        }
        const units = buildUnits(program).filter(unit => unit.paragraph.id === paragraph.id && unit.pack === 'lumiere');
        expect(units.length).toBeGreaterThan(0);
        expect(program.invalidOps).toEqual([]);
    });
});

describe('跨包借排版', () => {
    it('绘光的三种排版可以借给别的包：客镜头用天井光位、只画字', () => {
        const reference = compileLumiProgram({ lines, seed: 'borrow', direction: { mode: 'single', pack: 'tempera', shotMixing: false } });
        const target = reference.paragraphs[1]!.shots.find(s => !s.isBridge)!;
        const kind = target.style.split('/')[1]!;
        expect(borrowableTypographies('tempera', kind).map(item => item.value))
            .toEqual(expect.arrayContaining(['lumiere/horizontal', 'lumiere/vertical', 'lumiere/crossed']));
        const program = compileLumiProgram({
            lines,
            seed: 'borrow',
            direction: { mode: 'single', pack: 'tempera', shotMixing: false },
            overrides: [{ id: 'a', type: 'shot-component', anchor: target.anchor, slot: 'typography', value: 'lumiere/vertical' }],
        });
        const shot = program.paragraphs[1]!.shots.find(s => s.id === target.id)!;
        expect(program.invalidOps).toEqual([]);
        expect(shot.borrowedText).toMatchObject({ pack: 'lumiere', typography: 'vertical' });
        const guest = shot.borrowedText!.native.shot as LumiereShot;
        // 竖排借的是光环（默认就是竖排，所以不写 typography）。
        expect(guest.kind).toBe('zenith-halo');
        expect(guest.typography).toBeUndefined();
        expect(shot.borrowedText!.guestRegion).toEqual(getPack('lumiere').textRegion!('zenith-halo'));
        const units = buildUnits(program).filter(unit => unit.paragraph.index === 1);
        expect(units.flatMap(unit => unit.guests).map(guest => guest.unit.pack)).toContain('lumiere');
        expect(getPack('lumiere').textOnlyTuning!(getPack('lumiere').tuning.defaults)).toMatchObject({ textOnly: true });
    });

    it('绘光做宿主：借别的包的排版时自己的字隐去', () => {
        const target = compile().paragraphs[1]!.shots.find(s => !s.isBridge)!;
        const options = borrowableTypographies('lumiere', target.style.split('/')[1]!).map(item => item.value);
        expect(options).toContain('sonnet/poster-blocks');
        expect(options.some(value => value.startsWith('lumiere/'))).toBe(false);
        const borrowed = compile('lumiere', {
            overrides: [{ id: 'a', type: 'shot-component', anchor: target.anchor, slot: 'typography', value: 'sonnet/poster-blocks' }],
        });
        const shot = borrowed.paragraphs[1]!.shots.find(s => s.id === target.id)!;
        expect(borrowed.invalidOps).toEqual([]);
        expect((shot.native.shot as LumiereShot).textHidden).toBe(true);
        expect(shot.borrowedText).toMatchObject({ pack: 'sonnet', typography: 'poster-blocks' });
    });
});
