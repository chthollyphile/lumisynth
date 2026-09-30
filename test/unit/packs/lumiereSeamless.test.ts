// 绘光的轨迹过渡（从 folia 移植）：接缝转场「轨迹」把相邻的绘光段落并成一个场景单元。
import { describe, expect, it } from 'vitest';
import '@/packs/builtin';
import { compileLumiProgram, type CompileInput } from '@/compiler/compile';
import { buildUnits } from '@/kernel/units';
import { getTransition } from '@/packs/registry';
import type { LumiereParagraph } from '@/packs/lumiere/program';
import { resolveLumiereCameraProgress, resolveLumiereLeadShot } from '@/packs/lumiere/unitLayout';
import { syntheticSong } from '../compiler/fixtures';

const lines = syntheticSong(7, true);
const base: CompileInput = { lines, seed: 'seamless', direction: { mode: 'single', pack: 'lumiere', shotMixing: false } };
const seamless: CompileInput = { ...base, packTunings: { lumiere: { seamlessTransitions: true } } };

describe('绘光的轨迹过渡', () => {
    it('关着时照常按段落切单元，自动转场里没有轨迹', () => {
        const program = compileLumiProgram(base);
        expect(program.paragraphs.length).toBeGreaterThan(2);
        expect(program.paragraphs.some(paragraph => paragraph.transitionOut?.id === 'lumiere/trajectory')).toBe(false);
        expect(buildUnits(program).length).toBe(program.paragraphs.length);
    });

    it('打开后段落之间都是轨迹，整首并成一个单元：镜头原样、只开场一次、原段落范围留在 sections', () => {
        const reference = compileLumiProgram(base);
        const program = compileLumiProgram(seamless);
        expect(getTransition('lumiere/trajectory')?.joins).toBe(true);
        program.paragraphs.slice(0, -1).forEach(paragraph => expect(paragraph.transitionOut).toMatchObject({ id: 'lumiere/trajectory', source: 'auto' }));
        expect(program.paragraphs.at(-1)!.transitionOut).toBeNull();
        // 镜头与光位和不开时逐个相同。
        expect(program.paragraphs.map(paragraph => paragraph.shots.map(shot => shot.style)))
            .toEqual(reference.paragraphs.map(paragraph => paragraph.shots.map(shot => shot.style)));

        const units = buildUnits(program);
        expect(units).toHaveLength(1);
        const unit = units[0]!;
        const data = unit.native.paragraph as LumiereParagraph;
        expect(unit.startTime).toBe(program.paragraphs[0]!.startTime);
        expect(unit.endTime).toBe(program.paragraphs.at(-1)!.endTime);
        expect(unit.transitionOut).toBeNull();
        expect(unit.shots.length).toBe(program.paragraphs.reduce((sum, paragraph) => sum + paragraph.shots.length, 0));
        expect(data.opening).toBe(true);
        expect(data.transitionOut).toBeNull();
        expect(data.sections).toEqual(program.paragraphs.map(paragraph => ({ startTime: paragraph.startTime, endTime: paragraph.endTime })));
        expect(data.lineIndices).toEqual(program.paragraphs.flatMap(paragraph => paragraph.lineIndices));
        expect(data.lines.length).toBe(data.lineIndices.length);
        expect(unit.native.id).not.toBe(buildUnits(reference)[0]!.native.id);
        // 结果确定，缓存键稳定。
        expect(buildUnits(compileLumiProgram(seamless))[0]!.key).toBe(unit.key);
    });

    it('用户指定的转场不动，并在那里断开单元；中间换了别的包的段落不并', () => {
        const program = compileLumiProgram(seamless);
        const cut = program.paragraphs[1]!;
        const manual = compileLumiProgram({
            ...seamless,
            overrides: [{ id: 't', type: 'transition', anchor: cut.anchor, transition: 'lumiere/flare-cut' }],
        });
        expect(manual.paragraphs[1]!.transitionOut).toMatchObject({ id: 'lumiere/flare-cut', source: 'user' });
        const units = buildUnits(manual);
        expect(units).toHaveLength(2);
        expect(units[0]!.endTime).toBe(manual.paragraphs[1]!.endTime);
        expect(units[0]!.transitionOut?.id).toBe('lumiere/flare-cut');
        expect(units.map(unit => unit.index)).toEqual([0, 1]);

        const mixed = compileLumiProgram({
            ...seamless,
            paragraphDirections: [{ anchor: program.paragraphs[2]!.anchor, pack: 'sonnet', source: 'user' }],
        });
        // 进出商籁段落的转场不是轨迹（两侧不是同一个包）。
        expect(mixed.paragraphs[1]!.transitionOut?.id).not.toBe('lumiere/trajectory');
        expect(mixed.paragraphs[2]!.transitionOut?.id.startsWith('sonnet/')).toBe(true);
        const packs = buildUnits(mixed).map(unit => unit.pack);
        expect(packs.slice(0, 3)).toEqual(['lumiere', 'sonnet', 'lumiere']);
    });

    it('手动选「轨迹」接到别的包时不并，按拉焦衔接', () => {
        const program = compileLumiProgram({
            ...base,
            paragraphDirections: [{ anchor: compileLumiProgram(base).paragraphs[1]!.anchor, pack: 'sonnet', source: 'user' }],
            overrides: [{ id: 't', type: 'transition', anchor: compileLumiProgram(base).paragraphs[0]!.anchor, transition: 'lumiere/trajectory' }],
        });
        expect(program.paragraphs[0]!.transitionOut?.id).toBe('lumiere/trajectory');
        const units = buildUnits(program);
        expect(units[0]!.pack).toBe('lumiere');
        expect(units[1]!.pack).toBe('sonnet');
        const frame = getTransition('lumiere/trajectory')!.resolveFrame('exit', 1, { transitionSeed: 0, flowAngle: 0 });
        expect(frame.blur).toBeGreaterThan(0);
    });
});

describe('并起来的单元的运镜与领头光位', () => {
    it('每段推一次、下一段拉回：段落边界处位置连续', () => {
        const span = { startTime: 0, endTime: 30 };
        const sections = [{ startTime: 0, endTime: 10 }, { startTime: 12, endTime: 20 }, { startTime: 20, endTime: 30 }];
        const at = (time: number) => resolveLumiereCameraProgress(time, span, sections);
        expect(at(0)).toBeCloseTo(0);
        expect(at(11.999)).toBeCloseTo(1, 3);
        expect(at(12)).toBeCloseTo(1);
        expect(at(19.999)).toBeCloseTo(0, 3);
        expect(at(20)).toBeCloseTo(0);
        expect(at(30)).toBeCloseTo(1);
        // 没有 sections 时整个单元推一次。
        expect(resolveLumiereCameraProgress(15, span)).toBeCloseTo(0.5);
    });

    it('领头光位跳过段首的间奏镜头', () => {
        expect(resolveLumiereLeadShot([{ lines: [] }, { lines: [0] }, { lines: [1] }])).toEqual({ lines: [0] });
        const bridges = [{ lines: [] }, { lines: [] }];
        expect(resolveLumiereLeadShot(bridges)).toBe(bridges[0]);
    });
});
