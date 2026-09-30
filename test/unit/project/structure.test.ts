// 手动分段、合并、移动段首、段落性质：编译结果，以及挂在段首行上的设置怎么跟着搬。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import type { LumiProgram, StructureEdit } from '@/compiler/types';
import { createProject } from '@/project/defaults';
import { planIsolate, planMergeWithPrevious, planMoveStart, planResetStructure, planSetKind, planSplit, recompileProject } from '@/project/structure';
import type { LumiProject } from '@/project/types';
import { syntheticSong } from '../compiler/fixtures';

const lines = syntheticSong(71, true);
const project = (): LumiProject => ({ ...createProject(), seed: 'structure' });
const compile = (p: LumiProject): LumiProgram => compileLumiProgram({
    lines,
    seed: p.seed,
    paragraphDirections: p.paragraphDirections,
    overrides: p.overrides,
    structureEdits: p.structureEdits,
    params: p.engineParams,
});
const starts = (program: LumiProgram) => program.paragraphs.map(paragraph => paragraph.lineIndices[0]);

const base = compile(project());
const multiLine = base.paragraphs.find(paragraph => paragraph.lineIndices.length >= 3)!;
const splitLine = multiLine.lineIndices[1];

describe('structure edits in the compiler', () => {
    it('changes nothing without edits', () => {
        expect(compileLumiProgram({ lines, seed: 'structure' }).paragraphs.map(p => p.lineIndices)).toEqual(base.paragraphs.map(p => p.lineIndices));
        expect(base.paragraphs.every(p => !p.merged && !p.kindManual)).toBe(true);
        expect(base.invalidStructureEdits).toEqual([]);
    });

    it('breaks, joins and sets kinds; joined paragraphs ignore the size caps', () => {
        const breakEdit: StructureEdit = { id: 'b', type: 'break', anchor: base.lines[splitLine].anchor };
        const broken = compileLumiProgram({ lines, seed: 'structure', structureEdits: [breakEdit] });
        expect(starts(broken)).toContain(splitLine);
        expect(broken.paragraphs.find(p => p.lineIndices[0] === splitLine)!.boundary).toBe('manual');

        // 把所有段落都并成一段：超过行数 / 时长上限也不再切开。
        const joins: StructureEdit[] = base.paragraphs.slice(1).map((p, i) => ({ id: `j${i}`, type: 'join', anchor: p.anchor.line }));
        const joined = compileLumiProgram({ lines, seed: 'structure', structureEdits: joins });
        expect(joined.paragraphs).toHaveLength(1);
        expect(joined.paragraphs[0].merged).toBe(true);
        expect(joined.paragraphs[0].lineIndices).toHaveLength(lines.length);

        const kind: StructureEdit = { id: 'k', type: 'kind', anchor: base.paragraphs[1].anchor.line, kind: 'chorus' };
        const kinded = compileLumiProgram({ lines, seed: 'structure', structureEdits: [kind] });
        expect(kinded.paragraphs[1]).toMatchObject({ kind: 'chorus', kindManual: true });
    });

    it('a break adds exactly one boundary and a join removes exactly one, wherever they are', () => {
        const auto = starts(base);
        base.lines.forEach((line, index) => {
            if (index === 0) return;
            const broken = starts(compileLumiProgram({ lines, seed: 'structure', structureEdits: [{ id: 'b', type: 'break', anchor: line.anchor }] }));
            expect(broken).toEqual([...new Set([...auto, index])].sort((a, b) => a - b));
        });
        auto.slice(1).forEach(start => {
            const joined = starts(compileLumiProgram({ lines, seed: 'structure', structureEdits: [{ id: 'j', type: 'join', anchor: base.lines[start].anchor }] }));
            expect(joined).toEqual(auto.filter(item => item !== start));
        });
    });

    it('lists edits whose line is gone, that sit on the first line, or whose paragraph start moved', () => {
        const edits: StructureEdit[] = [
            { id: 'a', type: 'break', anchor: { index: 3, hash: 'deadbeef' } },
            { id: 'b', type: 'join', anchor: base.lines[0].anchor },
            { id: 'c', type: 'kind', anchor: base.lines[splitLine].anchor, kind: 'lift' },
        ];
        const program = compileLumiProgram({ lines, seed: 'structure', structureEdits: edits });
        expect(program.invalidStructureEdits.map(item => [item.edit.id, item.reason])).toEqual([
            ['a', 'line-missing'],
            ['b', 'first-line'],
            ['c', 'not-paragraph-start'],
        ]);
    });
});

describe('structure edit actions', () => {
    it('split: the new paragraph copies the direction and takes the outgoing transition', () => {
        let p = project();
        p = {
            ...p,
            paragraphDirections: [{ anchor: multiLine.anchor, pack: 'sonnet', energy: 0.8, source: 'user' }],
            overrides: [{ id: 't', type: 'transition', anchor: multiLine.anchor, transition: 'sonnet/mono-glitch' }],
        };
        const program = compile(p);
        const change = planSplit(p, program, splitLine)!;
        const after = compile(change.project);
        const head = after.paragraphs.find(q => q.lineIndices[0] === multiLine.lineIndices[0])!;
        const tail = after.paragraphs.find(q => q.lineIndices[0] === splitLine)!;
        expect(tail.direction).toMatchObject({ pack: 'sonnet', energy: 0.8, source: 'user' });
        expect(head.direction).toMatchObject({ pack: 'sonnet', source: 'user' });
        expect(tail.transitionOut?.id).toBe('sonnet/mono-glitch');
        expect(after.invalidOps).toEqual([]);
        expect(after.invalidDirections).toEqual([]);
        expect(planSplit(p, program, multiLine.lineIndices[0])).toBeNull();
    });

    it('split then merge restores the original structure without leftover edits', () => {
        const p0 = project();
        const split = planSplit(p0, base, splitLine)!;
        const splitProgram = compile(split.project);
        const tail = splitProgram.paragraphs.find(q => q.lineIndices[0] === splitLine)!;
        const merged = planMergeWithPrevious(split.project, splitProgram, tail)!;
        expect(merged.project.structureEdits).toEqual([]);
        expect(compile(merged.project).paragraphs.map(q => q.lineIndices)).toEqual(base.paragraphs.map(q => q.lineIndices));
    });

    it('merge: drops the merged paragraph\'s own settings and keeps its outgoing transition', () => {
        const second = base.paragraphs[2];
        const first = base.paragraphs[1];
        let p = project();
        p = {
            ...p,
            paragraphDirections: [{ anchor: second.anchor, pack: 'sonnet', source: 'user' }, { anchor: first.anchor, energy: 0.2, source: 'user' }],
            overrides: [
                { id: 'between', type: 'transition', anchor: first.anchor, transition: 'none' },
                { id: 'out', type: 'transition', anchor: second.anchor, transition: 'tempera/block-wipe' },
            ],
        };
        const program = compile(p);
        const change = planMergeWithPrevious(p, program, program.paragraphs[2])!;
        expect(change.notes.join()).toMatch(/编排/);
        const after = compile(change.project);
        const mergedParagraph = after.paragraphs[1];
        expect(mergedParagraph.lineIndices).toEqual([...first.lineIndices, ...second.lineIndices]);
        expect(mergedParagraph.direction).toMatchObject({ energy: 0.2, source: 'user' });
        expect(mergedParagraph.transitionOut?.id).toBe('tempera/block-wipe');
        expect(after.invalidDirections).toEqual([]);
        expect(after.invalidOps).toEqual([]);
        // 交回自动分段。
        const reset = planResetStructure(change.project, after, mergedParagraph)!;
        expect(starts(recompileProject(reset.project, after))).toEqual(starts(base));
    });

    it('moves a paragraph start and its settings along', () => {
        const target = base.paragraphs.find((q, i) => i > 0 && q.lineIndices.length >= 2)!;
        let p = project();
        p = { ...p, paragraphDirections: [{ anchor: target.anchor, pack: 'sonnet', source: 'user' }] };
        const program = compile(p);
        const paragraph = program.paragraphs[target.index];
        const newStart = paragraph.lineIndices[1];
        const change = planMoveStart(p, program, paragraph, newStart)!;
        const after = compile(change.project);
        const moved = after.paragraphs.find(q => q.lineIndices[0] === newStart)!;
        expect(moved.direction).toMatchObject({ pack: 'sonnet', source: 'user' });
        expect(starts(after)).not.toContain(paragraph.lineIndices[0]);
        expect(after.invalidDirections).toEqual([]);
        // 只能在上一段段首之后、本段末行之内。
        expect(planMoveStart(p, program, paragraph, program.paragraphs[target.index - 1].lineIndices[0])).toBeNull();
    });

    it('sets and clears a manual kind', () => {
        const p = project();
        const set = planSetKind(p, base.paragraphs[0], 'chorus');
        expect(compile(set.project).paragraphs[0]).toMatchObject({ kind: 'chorus', kindManual: true });
        const cleared = planSetKind(set.project, base.paragraphs[0], 'auto');
        expect(cleared.project.structureEdits).toEqual([]);
    });

    it('isolates a run of lines inside a paragraph, across paragraphs, and leaves an exact paragraph alone', () => {
        const p = project();
        // 段内：中间几行自成一段。
        const inside = planIsolate(p, base, multiLine.lineIndices[1], multiLine.lineIndices[1])!;
        const insideStarts = starts(compile(inside.project));
        expect(insideStarts).toContain(multiLine.lineIndices[1]);
        if (multiLine.lineIndices[2] !== undefined) expect(insideStarts).toContain(multiLine.lineIndices[2]);

        // 跨段：从第 1 段的最后一行到第 2 段的第 1 行，合成一段，两头各开一段。
        const a = base.paragraphs[0].lineIndices.at(-1)!;
        const b = base.paragraphs[1].lineIndices[0];
        const across = compile(planIsolate(p, base, a, b)!.project);
        const own = across.paragraphs.find(paragraph => paragraph.lineIndices[0] === a)!;
        expect(own.lineIndices).toEqual([a, b]);
        expect(starts(across)).toContain(b + 1 < lines.length ? b + 1 : a);

        // 正好是一段：什么也不改。
        expect(planIsolate(p, base, base.paragraphs[1].lineIndices[0], base.paragraphs[1].lineIndices.at(-1)!)).toBeNull();
    });
});
