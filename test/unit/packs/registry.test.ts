// 风格包是可扩展的：注册一个最小的第三方包，编译器、内核单元、跨包转换、工程 tuning 都不需要改。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import type { StylePack } from '@/packs/contract';
import { findPack, getStyle, listPacks, registerPack } from '@/packs/registry';
import { IDLE_FRAME } from '@/kernel/transitions';
import { buildUnits } from '@/kernel/units';
import { createProject, normalizeProject, packTuningOf } from '@/project/defaults';
import { syntheticSong } from '../compiler/fixtures';

interface LensShot {
    id: string;
    kind: string;
    lineIndex: number;
    startTime: number;
    endTime: number;
}

/** 每行一个镜头、两种风格轮换的玩具包。 */
const lensPack: StylePack<{ glow: number }, { unused: boolean }, { count: number }, LensShot, { id: string; shots: LensShot[] }> = {
    id: 'lens',
    label: '光学 lens',
    shortLabel: '光学',
    color: '#a78bfa',
    description: '测试用的光学包。',
    version: 1,
    families: [{ id: 'optics', pack: 'lens', label: '光学' }],
    styles: [
        { id: 'lens/flare', pack: 'lens', kind: 'flare', family: 'optics', mood: 'loud' },
        { id: 'lens/bokeh', pack: 'lens', kind: 'bokeh', family: 'optics', mood: 'quiet' },
    ],
    transitions: [{
        id: 'lens/iris', pack: 'lens', kind: 'iris', label: '光圈', preRoll: false,
        duration: () => 0.4, enterClamp: [0.2, 0.4], resolveFrame: () => IDLE_FRAME,
    }],
    shotBoundaryTransition: 'lens/iris',
    tuning: { defaults: { glow: 0.5 }, normalize: raw => ({ glow: 0.5, ...(raw as object) }) },
    params: { defaults: { unused: false }, normalize: raw => ({ unused: false, ...(raw as object) }) },
    segmentLine: line => line.fullText.length,
    createChain: () => ({ count: 0 }),
    compileParagraph: (context, chain) => context.lines.map(line => {
        const forced = context.cast.forceKind?.({ lineIndex: line.sourceIndex, slot: 's0' }) ?? null;
        const kind = forced ?? (chain.count++ % 2 === 0 ? 'flare' : 'bokeh');
        return {
            native: { id: `p${context.paragraphIndex}-l${line.sourceIndex}`, kind, lineIndex: line.sourceIndex, startTime: line.line.startTime, endTime: line.renderEndTime },
            lineIndex: line.sourceIndex,
            slot: 's0',
        };
    }),
    chooseTransition: () => 'iris',
    describeShot: (shot, lines) => ({
        id: shot.id,
        kind: shot.kind,
        span: {
            id: shot.id, startTime: shot.startTime, endTime: shot.endTime, lyricEndTime: shot.endTime, isBridge: false,
            slices: [{ lineIndex: shot.lineIndex, startOffset: 0, endOffset: lines[shot.lineIndex].line.fullText.length }],
        },
    }),
    fromSpan: (span, kind) => (span.slices.length === 0 ? null : {
        shot: { id: span.id, kind, lineIndex: span.slices[0].lineIndex, startTime: span.startTime, endTime: span.endTime },
    }),
    toNativeParagraph: (_program, paragraph, options = {}) => {
        const id = `lens-p${paragraph.index}${options.idSuffix ?? ''}`;
        return { id, data: { id, shots: (options.shots ?? paragraph.shots).filter(s => s.native.pack === 'lens').map(s => s.native.shot as LensShot) } };
    },
    createAdapter: () => { throw new Error('not used in this test'); },
};

registerPack(lensPack);
const lines = syntheticSong(51, true);

describe('style pack registry', () => {
    it('lists the built-in packs first and the new one after', () => {
        expect(listPacks().map(pack => pack.id)).toEqual(['tempera', 'sonnet', 'lumiere', 'hanabi', 'lens']);
        expect(getStyle('lens/flare')?.family).toBe('optics');
        expect(() => registerPack(lensPack)).toThrow();
    });

    it('compiles a whole song with the new pack and splits units generically', () => {
        const program = compileLumiProgram({ lines, seed: 'lens', direction: { mode: 'single', pack: 'lens', shotMixing: false } });
        expect(program.paragraphs.every(p => p.direction.pack === 'lens')).toBe(true);
        expect(program.paragraphs.every(p => p.transitionOut === null || p.transitionOut.id === 'lens/iris')).toBe(true);
        expect(program.paragraphs[0].shots.map(s => s.style)).toEqual(program.paragraphs[0].shots.map((_, i) => (i % 2 === 0 ? 'lens/flare' : 'lens/bokeh')));
        const units = buildUnits(program);
        expect(units.length).toBe(program.paragraphs.length);
        expect(units[0].native.id).toBe('lens-p0');
    });

    it('mixes by paragraph kind and converts shots across packs both ways', () => {
        const reference = compileLumiProgram({ lines, seed: 'lens', direction: { mode: 'single', pack: 'tempera', shotMixing: true } });
        const shot = reference.paragraphs[1].shots.find(s => !s.isBridge)!;
        const program = compileLumiProgram({
            lines,
            seed: 'lens',
            direction: { mode: 'single', pack: 'tempera', shotMixing: true },
            overrides: [{ id: 'x', type: 'shot-style', anchor: shot.anchor, style: 'lens/bokeh' }],
        });
        const converted = program.paragraphs[1].shots.find(s => s.id === shot.id)!;
        expect(converted).toMatchObject({ pack: 'lens', style: 'lens/bokeh', locked: true });
        const units = buildUnits(program).filter(unit => unit.paragraph.id === 'p1');
        expect(units.some(unit => unit.pack === 'lens')).toBe(true);
        const intoLens = units.findIndex(unit => unit.pack === 'lens');
        if (intoLens > 0) expect(units[intoLens - 1].transitionOut?.id).toBe('lens/iris');

        const mixed = compileLumiProgram({
            lines,
            seed: 'lens',
            direction: {
                mode: 'mix', pack: 'tempera', shotMixing: false,
                mixByKind: { chorus: 'lens', lift: 'lens', break: 'lens', verse: 'sonnet', breath: 'sonnet', outro: 'tempera' },
            },
        });
        for (const paragraph of mixed.paragraphs) {
            if (paragraph.kind === 'chorus') expect(paragraph.direction.pack).toBe('lens');
            if (paragraph.kind === 'verse') expect(paragraph.direction.pack).toBe('sonnet');
        }
    });

    it('falls back to the first pack when a project names a pack that is not installed', () => {
        const program = compileLumiProgram({ lines, seed: 'x', direction: { mode: 'single', pack: 'missing', shotMixing: false } });
        expect(program.paragraphs.every(p => p.direction.pack === 'tempera')).toBe(true);
        expect(findPack('missing')).toBeUndefined();
    });

    it('gives every registered pack its tuning in new and migrated projects', () => {
        expect(packTuningOf<{ glow: number }>(createProject(), 'lens')).toEqual({ glow: 0.5 });
        const legacy = normalizeProject({ tuning: { sonnet: { showGuide: false } } } as never);
        expect(packTuningOf<{ showGuide: boolean }>(legacy, 'sonnet').showGuide).toBe(false);
        expect(packTuningOf<{ glow: number }>(legacy, 'lens')).toEqual({ glow: 0.5 });
    });
});
