import { beforeEach, describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { createProject } from '@/project/defaults';
import {
    lockCurrentStyle,
    lockShotStyle,
    patchParagraphDirection,
    setParagraphTransition,
    toggleBlocked,
    toggleFavorite,
    unlockShotStyle,
} from '@/project/edits';
import { setLineBounds } from '@/project/lyrics';
import { useProjectStore } from '@/project/store';
import { anchorOfLine } from '@/core/lyrics/edits';
import { syntheticSong } from '../compiler/fixtures';

const lines = syntheticSong(21, true);
const compile = () => {
    const { project } = useProjectStore.getState();
    return compileLumiProgram({
        lines,
        seed: project.seed,
        direction: project.direction,
        paragraphDirections: project.paragraphDirections,
        overrides: project.overrides,
        library: project.library,
        params: project.engineParams,
    });
};

beforeEach(() => {
    useProjectStore.getState().replace({ ...createProject(), seed: 'edits' });
});

describe('project edits', () => {
    it('locks the current style so it survives a reseed, and unlocks', () => {
        const shot = compile().paragraphs[1].shots[0];
        lockCurrentStyle(shot);
        useProjectStore.getState().update(p => ({ ...p, seed: 'reseeded' }));
        const after = compile().paragraphs[1].shots[0];
        expect(after.style).toBe(shot.style);
        expect(after.locked).toBe(true);
        unlockShotStyle(after);
        expect(useProjectStore.getState().project.overrides).toEqual([]);
    });

    it('replaces an existing lock on the same slot instead of stacking', () => {
        const shot = compile().paragraphs[0].shots[0];
        lockShotStyle(shot, 'tempera/chasm');
        lockShotStyle(shot, 'tempera/lintel');
        expect(useProjectStore.getState().project.overrides).toHaveLength(1);
        expect(compile().paragraphs[0].shots[0].style).toBe('tempera/lintel');
    });

    it('patches paragraph direction fields and drops empty overrides', () => {
        const paragraph = compile().paragraphs[2];
        let project = patchParagraphDirection(useProjectStore.getState().project, paragraph.anchor, { pack: 'sonnet', energy: 0.8 });
        expect(project.paragraphDirections).toEqual([{ anchor: paragraph.anchor, source: 'user', pack: 'sonnet', energy: 0.8 }]);
        project = patchParagraphDirection(project, paragraph.anchor, { pack: 'auto' });
        expect(project.paragraphDirections[0]).not.toHaveProperty('pack');
        project = patchParagraphDirection(project, paragraph.anchor, { energy: 'auto' });
        expect(project.paragraphDirections).toEqual([]);
    });

    it('sets and clears paragraph transitions', () => {
        const paragraph = compile().paragraphs[0];
        setParagraphTransition(paragraph, 'none');
        expect(compile().paragraphs[0].transitionOut).toBeNull();
        setParagraphTransition(paragraph, 'sonnet/camera-pull');
        expect(compile().paragraphs[0].transitionOut?.id).toBe('sonnet/camera-pull');
        setParagraphTransition(paragraph, 'auto');
        expect(useProjectStore.getState().project.overrides).toEqual([]);
    });

    it('keeps favorites and blocks mutually exclusive', () => {
        toggleFavorite('tempera/chasm');
        toggleBlocked('tempera/chasm');
        const { library } = useProjectStore.getState().project;
        expect(library).toEqual({ favorites: [], blocked: ['tempera/chasm'] });
    });

    it('coalesces a boundary drag into one undo step', () => {
        const anchor = anchorOfLine(lines[3], 3);
        for (let i = 0; i < 5; i += 1) setLineBounds(anchor, lines[3], { startTime: lines[3].startTime + i * 0.01 });
        expect(useProjectStore.getState().past).toHaveLength(1);
        useProjectStore.getState().undo();
        expect(useProjectStore.getState().project.lyricEdits.lines).toEqual([]);
    });
});
