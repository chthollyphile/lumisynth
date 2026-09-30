// 素材库：旧工程的凝彩图片池迁移、删除时连带清理、凝彩自动取用、agent 工具。
import { beforeEach, describe, expect, it } from 'vitest';
import { callAgentTool } from '@/agent/tools';
import { projectAssetRefs } from '@/project/archive';
import { isInTemperaPool, removeLibraryAsset, setTemperaAuto } from '@/project/assets';
import { createProject, normalizeProject } from '@/project/defaults';
import { useProjectStore } from '@/project/store';
import type { TemperaTuning } from '@/packs/tempera/temperaTuning';

const LRC = Array.from({ length: 12 }, (_, index) => `[00:${String(2 + index * 3).padStart(2, '0')}.00]光と影のあいだで${index}`).join('\n');
const ref = (id: string) => ({ id: `blob-${id}`, name: `${id}.png`, type: 'image/png', size: 10 });

beforeEach(() => {
    const project = createProject('assets');
    useProjectStore.getState().replace({
        ...project,
        lyrics: { fileName: 'a.lrc', content: LRC },
        assets: [{ id: 'img', name: 'img.png', kind: 'image', asset: ref('img'), width: 200, height: 400 }],
    });
});

const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await callAgentTool(name, args);
    const text = result.content.find(item => item.type === 'text');
    return { result, text: text?.type === 'text' ? text.text : '' };
};

describe('asset library', () => {
    it('migrates the legacy tempera image pool into the library, keeping ids', () => {
        const legacy = normalizeProject({ ...createProject(), assets: undefined, layerImageAssets: { old: ref('old') } } as never);
        expect(legacy.assets).toEqual([{ id: 'old', name: 'old.png', kind: 'image', asset: ref('old'), width: 0, height: 0 }]);
        expect('layerImageAssets' in JSON.parse(JSON.stringify(legacy))).toBe(false);
        expect(projectAssetRefs(legacy)).toContainEqual(ref('old'));
    });

    it('toggles tempera auto use and removes clips and pool entries with the asset', async () => {
        setTemperaAuto('img', true);
        expect(isInTemperaPool(useProjectStore.getState().project, 'img')).toBe(true);
        await call('place_asset', { asset: 'img', start: 1, end: 3 });
        expect(useProjectStore.getState().project.assetClips).toHaveLength(1);
        removeLibraryAsset('img');
        const project = useProjectStore.getState().project;
        expect(project.assets).toEqual([]);
        expect(project.assetClips).toEqual([]);
        expect((project.tuning.packs.tempera as TemperaTuning).layerImages).toEqual([]);
    });

    it('lets an agent place, adjust, list and remove clips', async () => {
        const placed = JSON.parse((await call('place_asset', { asset: 'img', paragraph: 0, slot: 'overlay', x: 0.2, scale: 0.3, opacity: 3 })).text);
        const listed = JSON.parse((await call('list_assets')).text);
        expect(listed.clips).toHaveLength(1);
        expect(listed.clips[0]).toMatchObject({ id: placed.clip, slot: 'overlay', x: 0.2, scale: 0.3, opacity: 1 });
        expect(listed.clips[0].timing.type).toBe('paragraph');
        expect(listed.clips[0].end).toBeGreaterThan(listed.clips[0].start);
        await call('update_asset_clip', { clip: placed.clip, blend: 'screen', enter: { type: 'zoom', duration: 1 }, rotation: 0.5 });
        expect(useProjectStore.getState().project.assetClips[0]).toMatchObject({ blend: 'screen', enter: { type: 'zoom', duration: 1 }, rotation: 0.5 });
        expect((await call('place_asset', { asset: 'nope', start: 0 })).result.isError).toBe(true);
        expect((await call('place_asset', { asset: 'img' })).result.isError).toBe(true);
        await call('update_asset_clip', { clip: placed.clip, remove: true });
        expect(useProjectStore.getState().project.assetClips).toEqual([]);
    });

    it('manages background clips through the agent tool and drops them with their asset', async () => {
        const added = JSON.parse((await call('set_background', { action: 'add', source: { type: 'image', assetId: 'img' }, timing: { paragraph: 0 }, dim: 0.5 })).text);
        const gradient = JSON.parse((await call('set_background', { action: 'add', source: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 90 }, timing: 'song' })).text);
        let project = useProjectStore.getState().project;
        expect(project.backgroundClips.map(clip => clip.source.type)).toEqual(['image', 'gradient']);
        expect(project.backgroundClips[0]).toMatchObject({ dim: 0.5, timing: { type: 'paragraph' } });
        expect((await call('set_background', { action: 'add', source: { type: 'video', assetId: 'img' } })).result.isError).toBe(true);
        await call('set_background', { action: 'update', clip: gradient.clip, timing: { start: 1, end: 5 }, kenBurns: 0 });
        expect(useProjectStore.getState().project.backgroundClips[1]).toMatchObject({ timing: { type: 'absolute', start: 1, end: 5 }, kenBurns: 0 });
        const listed = JSON.parse((await call('list_assets')).text);
        expect(listed.backgrounds).toHaveLength(2);
        removeLibraryAsset('img');
        project = useProjectStore.getState().project;
        expect(project.backgroundClips.map(clip => clip.id)).toEqual([gradient.clip]);
        expect(added.clip).toBeTruthy();
    });
});

