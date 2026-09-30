import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySceneDirection, buildSceneDirectionRequest, clearSceneDirection, generateAiSegmentation } from '@/ai/actions';
import { buildSceneDirectionPrompt } from '@/ai/sceneDirection';
import { compileLumiProgram } from '@/compiler/compile';
import { createProject } from '@/project/defaults';
import { patchParagraphDirection } from '@/project/edits';
import { useProjectStore } from '@/project/store';
import { syntheticSong } from '../compiler/fixtures';

// 分词请求本身的协议在 providers.test.ts 里测；这里只看结果怎么写进工程（第一行故意拼不回原文）。
vi.mock('@/ai/client', async importOriginal => ({
    ...(await importOriginal<typeof import('@/ai/client')>()),
    requestSegmentation: vi.fn(async (texts: string[]) => ({
        lines: texts.map((text, index) => (index === 0 ? ['wrong'] : [text.slice(0, 1), text.slice(1)])),
    })),
}));

const lines = syntheticSong(61, true);
const program = compileLumiProgram({ lines, seed: 'ai' });

beforeEach(() => useProjectStore.getState().replace({ ...createProject(), seed: 'ai' }));
afterEach(() => vi.unstubAllGlobals());

describe('AI actions', () => {
    it('describes every registered pack and every paragraph in the request', () => {
        const request = buildSceneDirectionRequest(program, useProjectStore.getState().project, null);
        expect(request.packs.map(pack => pack.id)).toEqual(['tempera', 'sonnet', 'lumiere', 'hanabi']);
        expect(request.packs[0].families.length).toBe(13);
        expect(request.packs[0].families[0].moods.length).toBeGreaterThan(0);
        expect(request.paragraphs).toHaveLength(program.paragraphs.length);
        expect(request.paragraphs.every(p => p.loudness === null)).toBe(true);
        // 绘光的族名看不出画面，带一句话描述进提示词。
        const lumiere = request.packs[2]!;
        expect(lumiere.families.every(family => Boolean(family.description))).toBe(true);
        expect(buildSceneDirectionPrompt(request)).toContain(`stage (追光 — ${lumiere.families.find(f => f.id === 'stage')!.description}`);
    });

    it('applies a direction without touching user overrides, and clears only AI results', () => {
        const userParagraph = program.paragraphs[1];
        useProjectStore.getState().update(p => patchParagraphDirection(p, userParagraph.anchor, { pack: 'tempera' }));
        applySceneDirection(program, {
            summary: '',
            paragraphs: program.paragraphs.map(p => ({ index: p.index, pack: 'sonnet', energy: 0.7, families: [], transition: 'sonnet/mono-glitch', reason: '' })),
        });
        const project = useProjectStore.getState().project;
        const recompiled = compileLumiProgram({ lines, seed: 'ai', paragraphDirections: project.paragraphDirections, overrides: project.overrides });
        expect(recompiled.paragraphs[1].direction).toMatchObject({ pack: 'tempera', source: 'user' });
        expect(recompiled.paragraphs[0].direction).toMatchObject({ pack: 'sonnet', energy: 0.7, source: 'ai' });
        expect(recompiled.paragraphs[0].transitionOut?.id).toBe('sonnet/mono-glitch');
        expect(recompiled.invalidOps).toEqual([]);

        clearSceneDirection();
        const cleared = useProjectStore.getState().project;
        expect(cleared.paragraphDirections).toHaveLength(1);
        expect(cleared.overrides).toEqual([]);
    });

    it('writes valid AI segmentations and skips lines that do not reassemble', async () => {
        const count = await generateAiSegmentation(program, { keepManual: true }, useProjectStore.getState().project);
        const segments = useProjectStore.getState().project.lyricEdits.segments;
        expect(count).toBe(segments.length);
        expect(count).toBe(program.lines.filter(line => line.line.fullText !== '......').length - 1);
    });
});
