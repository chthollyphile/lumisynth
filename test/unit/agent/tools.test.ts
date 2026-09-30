// agent 工具层：读到的是写入后立刻重算的编排；写操作进撤销栈；参数错误变成 isError 结果。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAgentState, setPreviewKernel } from '@/agent/host';
import { AGENT_PROMPTS, AGENT_TOOLS, agentTaskInstruction, callAgentTool, findAgentTool, getAgentPrompt, onAgentActivity } from '@/agent/tools';
import { clock, seek, usePlayback } from '@/app/playback';
import type { LumiKernel } from '@/kernel/runtime';
import { listPacks } from '@/packs/registry';
import { createProject } from '@/project/defaults';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';

const LRC = Array.from({ length: 24 }, (_, index) => {
    const time = 1 + index * 2.4 + Math.floor(index / 6) * 4;
    const stamp = `${String(Math.floor(time / 60)).padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}`;
    return `[${stamp}]${['光と影のあいだで', '夢を見ていた', '君の声を探して', '夜空に消えた星', 'もう一度だけ', '走り出す今'][index % 6]}`;
}).join('\n');

const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await callAgentTool(name, args);
    const text = result.content.find(item => item.type === 'text');
    return { result, text: text?.type === 'text' ? text.text : '' };
};
const callJson = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await call(name, args)).text);

afterEach(() => {
    setPreviewKernel(null);
    useSession.setState({ audioBuffer: null });
    vi.unstubAllGlobals();
});

beforeEach(() => {
    useProjectStore.getState().replace({
        ...createProject('agent test'),
        seed: 'agent',
        lyrics: { fileName: 'song.lrc', content: LRC },
        meta: { title: 'Song', artist: 'Artist', album: '' },
    });
});

describe('agent tools', () => {
    it('describes the project, lyrics, arrangement and style catalog', async () => {
        const project = await callJson('get_project');
        expect(project).toMatchObject({ name: 'agent test', lyrics: { lines: 24 }, invalidOps: 0 });
        expect(project.paragraphs).toBeGreaterThan(1);
        const lyrics = await callJson('get_lyrics', { from: 2, to: 3 });
        expect(lyrics.map((line: { index: number }) => line.index)).toEqual([2, 3]);
        const arrangement = await callJson('get_arrangement');
        expect(arrangement.paragraphs).toHaveLength(project.paragraphs);
        expect(arrangement.paragraphs[0].shots[0]).toHaveProperty('style');
        const styles = await callJson('list_styles', { pack: 'tempera' });
        expect(styles[0].componentSlots.map((slot: { id: string }) => slot.id)).toEqual(['typography', 'accent']);
        expect(styles[0].borrowableTypographies).toContain('sonnet/poster-blocks');
    });

    it('writes paragraph direction, shot style and components, readable right away, all undoable', async () => {
        const events: string[] = [];
        const off = onAgentActivity(entry => events.push(`${entry.tool}:${entry.ok}`));
        await call('set_paragraph_direction', { paragraph: 1, pack: 'sonnet', energy: 0.8 });
        let arrangement = await callJson('get_arrangement', { paragraph: 1 });
        expect(arrangement.direction).toMatchObject({ pack: 'sonnet', energy: 0.8, source: 'user' });
        expect(arrangement.shots[0].style.startsWith('sonnet/')).toBe(true);

        await call('set_shot_component', { paragraph: 1, shot: 0, slot: 'typography', value: 'tempera/stack' });
        arrangement = await callJson('get_arrangement', { paragraph: 1 });
        expect(arrangement.shots[0].borrowedTypography).toBe('tempera/stack');

        // 不接受的值：报错并自动撤销，不留下失效的修改。
        const bad = await call('set_shot_component', { paragraph: 1, shot: 0, slot: 'accent', value: 'glitter' });
        expect(bad.result.isError).toBe(true);
        expect(useProjectStore.getState().project.overrides.filter(op => op.type === 'shot-component')).toHaveLength(1);

        await call('undo', { steps: 2 });
        arrangement = await callJson('get_arrangement', { paragraph: 1 });
        expect(arrangement.direction.source).toBe('auto');
        off();
        expect(events).toEqual(['set_paragraph_direction:true', 'set_shot_component:true', 'set_shot_component:false', 'undo:true']);
    });

    it('drives the lumiere pack: family descriptions, direction, components and borrowing', async () => {
        const [lumiere] = await callJson('list_styles', { pack: 'lumiere' });
        expect(lumiere.styles).toHaveLength(100);
        expect(lumiere.families.every((family: { description?: string }) => Boolean(family.description))).toBe(true);
        expect(lumiere.componentSlots.map((slot: { id: string }) => slot.id)).toEqual(['typography', 'burst']);
        expect(lumiere.borrowableTypographies).toContain('sonnet/poster-blocks');

        await call('set_paragraph_direction', { paragraph: 1, pack: 'lumiere', energy: 0.3 });
        let arrangement = await callJson('get_arrangement', { paragraph: 1 });
        expect(arrangement.shots.every((shot: { style: string }) => shot.style.startsWith('lumiere/'))).toBe(true);
        const typography = await call('set_shot_component', { paragraph: 1, shot: 0, slot: 'typography', value: 'crossed' });
        expect(typography.result.isError).toBeFalsy();
        await call('set_shot_component', { paragraph: 1, shot: 0, slot: 'burst', value: 'on' });
        arrangement = await callJson('get_arrangement', { paragraph: 1 });
        expect(arrangement.shots[0].components).toMatchObject({ typography: 'crossed', burst: 'on' });

        // 别的包借绘光的排版。
        await call('set_paragraph_direction', { paragraph: 2, pack: 'tempera' });
        await call('set_shot_component', { paragraph: 2, shot: 0, slot: 'typography', value: 'lumiere/vertical' });
        arrangement = await callJson('get_arrangement', { paragraph: 2 });
        expect(arrangement.shots[0].borrowedTypography).toBe('lumiere/vertical');
    });

    it('validates input and reports errors as results', async () => {
        expect((await call('get_arrangement', { paragraph: 999 })).result.isError).toBe(true);
        expect((await call('set_paragraph_direction', { paragraph: 0, pack: 'ghost' })).text).toMatch(/没有风格包/);
        expect((await call('set_paragraph_transition', { paragraph: 0, transition: 'made/up' })).result.isError).toBe(true);
        expect((await call('set_shot_style', { paragraph: 'x', shot: 0, style: 'tempera/duo-split' })).text).toMatch(/必须是数字/);
        expect((await call('no_such_tool')).result.isError).toBe(true);
    });

    it('writes segmentation, skipping lines that do not reassemble', async () => {
        const result = await callJson('set_segmentation', {
            lines: [{ index: 0, parts: ['光と', '影の', 'あいだで'] }, { index: 1, parts: ['wrong'] }],
        });
        expect(result.rejectedLines).toEqual([1]);
        const segments = useProjectStore.getState().project.lyricEdits.segments;
        expect(segments).toEqual([{ anchor: expect.objectContaining({ index: 0 }), parts: ['光と', '影の', 'あいだで'] }]);
    });

    it('applies a scene direction and a theme like the built-in AI would', async () => {
        const { paragraphs } = await callJson('get_arrangement');
        await call('apply_scene_direction', {
            summary: 'x',
            paragraphs: paragraphs.map((p: { index: number }) => ({ index: p.index, pack: 'sonnet', energy: 0.4, families: [], transition: 'auto', reason: '' })),
        });
        const after = await callJson('get_arrangement');
        expect(after.paragraphs.every((p: { direction: { pack: string; source: string } }) => p.direction.pack === 'sonnet' && p.direction.source === 'ai')).toBe(true);

        const theme = (bg: string) => ({ name: '夜', backgroundColor: bg, primaryColor: '#eeeeee', accentColor: '#ff0066', secondaryColor: '#999999', wordColors: [], lyricsIcons: [] });
        await call('set_theme', { light: theme('#fafafa'), dark: theme('#101018') });
        const project = useProjectStore.getState().project;
        expect(project.theme).toMatchObject({ source: 'ai' });
        expect(project.theme.dual.dark).toMatchObject({ backgroundColor: '#101018', provider: 'agent' });
    });

    it('builds the three prompts from the current project', () => {
        expect(AGENT_PROMPTS.map(prompt => prompt.name)).toEqual(['theme', 'segmentation', 'scene_direction']);
        expect(getAgentPrompt('segmentation').messages[0].content.text).toContain('光と影のあいだで');
        expect(getAgentPrompt('scene_direction').messages[0].content.text).toContain('apply_scene_direction');
        expect(() => getAgentPrompt('nope')).toThrow();
        // 每个工具都有 object 类型的输入 schema（MCP 的要求）。
        expect(AGENT_TOOLS.every(tool => tool.inputSchema.type === 'object')).toBe(true);
    });

    it('offers the prompts as read-only brief tools, which the AI panel instructions point at', async () => {
        // prompt 只能由用户触发；模型自己调用的 brief 工具给出同一份内容。
        expect((await call('get_theme_brief')).text).toBe(getAgentPrompt('theme').messages[0].content.text);
        expect((await call('get_segmentation_brief')).text).toBe(getAgentPrompt('segmentation').messages[0].content.text);
        expect((await call('get_scene_direction_brief')).text).toBe(getAgentPrompt('scene_direction').messages[0].content.text);

        // skipManual：手动改过分词的行不再出现在说明里。
        const indices = async (args: Record<string, unknown>) => JSON.parse((await call('get_segmentation_brief', args)).text.match(/line indices (\[[^\]]*\])/)![1]) as number[];
        const all = await indices({});
        const text = getAgentState().program.lines[all[0]].line.fullText;
        await call('set_segmentation', { lines: [{ index: all[0], parts: [text.slice(0, 2), text.slice(2)] }] });
        expect(await indices({})).toEqual(all);
        expect(await indices({ skipManual: true })).toEqual(all.slice(1));

        for (const task of ['theme', 'segmentation', 'scene_direction'] as const) {
            const instruction = agentTaskInstruction(task);
            expect(findAgentTool(instruction.match(/get_\w+_brief/)![0])?.readOnly).toBe(true);
            expect(findAgentTool(instruction.match(/(set_theme|set_segmentation|apply_scene_direction)/)![0])?.readOnly).toBe(false);
        }
        expect(agentTaskInstruction('segmentation', { skipManual: true })).toContain('skipManual: true');
        expect(agentTaskInstruction('segmentation')).not.toContain('skipManual');
    });

    it('splits and merges paragraphs', async () => {
        const before = await callJson('get_arrangement');
        const target = before.paragraphs.find((p: { lines: number[] }) => p.lines.length >= 2);
        const line = target.lines[1];
        const split = await callJson('edit_structure', { action: 'split', line });
        expect(split.paragraphs).toHaveLength(before.paragraphs.length + 1);
        const created = split.paragraphs.find((p: { lines: number[] }) => p.lines[0] === line);
        expect((await callJson('get_arrangement', { paragraph: created.index })).boundary).toBe('manual');
        const merged = await callJson('edit_structure', { action: 'merge', paragraph: created.index });
        expect(merged.paragraphs).toHaveLength(before.paragraphs.length);
        expect(useProjectStore.getState().project.structureEdits).toEqual([]);
        expect((await call('edit_structure', { action: 'merge', paragraph: 0 })).result.isError).toBe(true);
        await call('set_paragraph_kind', { paragraph: 0, kind: 'chorus' });
        expect((await callJson('get_arrangement', { paragraph: 0 }))).toMatchObject({ kind: 'chorus', kindManual: true });
    });

    it('reads the script with a version, applies an edited one as one undo step, refuses a stale one', async () => {
        const read = (await call('get_script')).text;
        const version = /# version (\w+)\n$/.exec(read)![1];
        const script = read.replace(/# version \w+\n$/, '');
        // 第 2 个段落块的 pack 改成 sonnet（生成的剧本里写着自动选出的包）。
        const rows = script.split('\n');
        const second = rows.findIndex((row, index) => row.startsWith('paragraph') && rows.slice(0, index).some(other => other.startsWith('paragraph')));
        const packRow = rows.findIndex((row, index) => index > second && row.startsWith('  pack '));
        const edited = rows.map((row, index) => (index === packRow ? '  pack sonnet' : row)).join('\n');
        expect(edited).not.toBe(script);
        const checked = JSON.parse((await call('check_script', { script: edited })).text);
        expect(checked).toMatchObject({ ok: true, wouldChange: ['第 2 段：包 sonnet'], diagnostics: [] });
        expect(useProjectStore.getState().project.paragraphDirections).toEqual([]);

        const applied = JSON.parse((await call('apply_script', { script: edited, version })).text);
        expect(applied.changes).toEqual(['第 2 段：包 sonnet']);
        expect((await callJson('get_arrangement', { paragraph: 1 })).direction).toMatchObject({ pack: 'sonnet', source: 'user' });

        // 工程变了：旧版本号被拒，force 才应用。
        const stale = await call('apply_script', { script: edited.replace('seed "agent"', 'seed "other"'), version });
        expect(stale.result.isError).toBe(true);
        expect(useProjectStore.getState().project.seed).toBe('agent');

        const broken = await call('apply_script', { script: edited.replace(/^ {2}line 1 .*\n/m, '') });
        expect(broken.result.isError).toBe(true);
        expect(broken.text).toMatch(/第 \d+ 行第 \d+ 列 错误 LS301：第 1 行不在任何段落里/);
        const typo = JSON.parse((await call('check_script', { script: 'direction single tempra\n' })).text);
        expect(typo.ok).toBe(false);
        expect(typo.diagnostics[0]).toMatchObject({ line: 1, column: 18, code: 'LS201', hint: '是不是想写 tempera？', fixes: [{ label: '改成 tempera', edits: [{ line: 1, column: 18, endColumn: 24, text: 'tempera' }] }] });

        await call('undo');
        expect((await callJson('get_arrangement', { paragraph: 1 })).direction.source).toBe('auto');
    });

    it('edits lyric text, line timing and word timing; repairs a stale segmentation; resets', async () => {
        const [line] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(line.edited).toEqual({ text: false, lineTiming: false, wordTiming: false });
        expect(line.words.map((word: { text: string }) => word.text).join('')).toBe(line.text.replace(/\s+/g, ''));

        await call('set_segmentation', { lines: [{ index: 2, parts: [line.text.slice(0, 2), line.text.slice(2)] }] });
        const changed = JSON.parse((await call('set_line_text', { line: 2, text: `${line.text}よ` })).text);
        expect(changed.segmentationStale).toBe(true);
        expect(changed.proposedSegmentation.join('')).toBe(`${line.text}よ`);
        let [after] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(after).toMatchObject({ text: `${line.text}よ`, segmentationStale: true, edited: { text: true } });
        // 没变的字保留时间。
        expect(after.words[0]).toEqual(line.words[0]);

        await call('fix_segmentation', { line: 2 });
        [after] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(after.segmentationStale).toBe(false);
        expect((await call('fix_segmentation', { line: 2 })).result.isError).toBe(true);

        await call('set_line_timing', { line: 2, start: line.startTime + 0.1, end: line.endTime + 0.3 });
        [after] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(after.startTime).toBeCloseTo(line.startTime + 0.1, 2);
        expect(after.endTime).toBeCloseTo(line.endTime + 0.3, 2);

        const words = after.words.map((word: { text: string; startTime: number; endTime: number }, i: number) => ({ ...word, startTime: after.startTime + i * 0.1, endTime: after.startTime + (i + 1) * 0.1 }));
        await call('set_word_timing', { line: 2, words });
        [after] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(after.edited.wordTiming).toBe(true);
        expect(after.words[1].startTime).toBeCloseTo(after.startTime + 0.1, 2);
        expect((await call('set_word_timing', { line: 2, words: [{ text: 'nope', startTime: 1, endTime: 2 }] })).result.isError).toBe(true);

        await call('reset_lyric_line', { line: 2, what: 'all' });
        [after] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(after).toMatchObject({ text: line.text, edited: { text: false, lineTiming: false, wordTiming: false } });
    });

    it('changes lyric text through apply_script', async () => {
        const read = (await call('get_script')).text;
        const version = /# version (\w+)\n$/.exec(read)![1];
        const script = read.replace(/# version \w+\n$/, '');
        const match = /  line 3 (\S+) ("[^"]*")/.exec(script)!;
        const text = JSON.parse(match[2]) as string;
        const edited = script.replace(match[0], `  line 3 ${match[1]} ${JSON.stringify(`${text}！`)}`);
        expect(script).toContain('lumiscript 2');
        const applied = JSON.parse((await call('apply_script', { script: edited, version })).text);
        expect(applied.changes).toEqual([`第 3 行改字：「${text}」→「${text}！」`]);
        const [line] = await callJson('get_lyrics', { from: 2, to: 2 });
        expect(line.text).toBe(`${text}！`);
    });
    it('filters the style catalog, lists it briefly and returns one style in detail', async () => {
        const full = await call('list_styles');
        const packs = JSON.parse(full.text);
        // 结构化结果与文本相同（数组放在 packs 下）。
        expect(full.result.structuredContent).toEqual({ packs });
        expect(packs.map((pack: { id: string }) => pack.id)).toEqual(listPacks().map(pack => pack.id));
        const tempera = packs.find((pack: { id: string }) => pack.id === 'tempera');
        expect(tempera.componentSlots[0].options.every((option: unknown) => typeof option === 'string')).toBe(true);
        expect(tempera.componentSlots[0].optionDetails.map((option: { id: string }) => option.id)).toEqual(tempera.componentSlots[0].options);
        // 包里写了的说明原样透传。
        for (const pack of listPacks()) {
            const listed = packs.find((item: { id: string }) => item.id === pack.id);
            pack.styles.forEach((style, index) => {
                expect(listed.styles[index]).toMatchObject({ id: style.id, family: style.family, mood: style.mood });
                expect(listed.styles[index].label).toBe(style.label);
                expect(listed.styles[index].description).toBe(style.description);
                expect(listed.styles[index].keywords).toEqual(style.keywords?.length ? style.keywords : undefined);
            });
            pack.componentSlots?.forEach((slot, index) => expect(listed.componentSlots[index].description).toBe(slot.description));
        }

        const brief = await callJson('list_styles', { brief: true });
        expect(brief).toHaveLength(packs.length);
        for (const pack of brief) {
            expect(pack).not.toHaveProperty('componentSlots');
            expect(pack).not.toHaveProperty('borrowableTypographies');
            for (const style of pack.styles) expect(Object.keys(style).every(key => ['id', 'label', 'family', 'mood', 'description'].includes(key))).toBe(true);
        }
        expect(JSON.stringify(brief).length).toBeLessThan(JSON.stringify(packs).length);

        const quiet = await callJson('list_styles', { mood: 'quiet' });
        expect(quiet.length).toBeGreaterThan(0);
        expect(quiet.flatMap((pack: { styles: Array<{ mood: string }> }) => pack.styles).every((style: { mood: string }) => style.mood === 'quiet')).toBe(true);
        expect(quiet.every((pack: { styles: unknown[] }) => pack.styles.length > 0)).toBe(true);

        const temperaPack = listPacks().find(pack => pack.id === 'tempera')!;
        const family = temperaPack.families[0];
        for (const value of [family.id, family.label.toUpperCase()]) {
            const [byFamily] = await callJson('list_styles', { pack: 'tempera', family: value });
            expect(byFamily.styles.length).toBe(temperaPack.styles.filter(style => style.family === family.id).length);
            expect(byFamily.families.map((item: { id: string }) => item.id)).toEqual([family.id]);
        }

        const target = temperaPack.styles[3];
        const byKeyword = await callJson('list_styles', { keyword: target.kind.toUpperCase() });
        expect(byKeyword.flatMap((pack: { styles: Array<{ id: string }> }) => pack.styles.map(style => style.id))).toContain(target.id);
        expect(await callJson('list_styles', { keyword: 'no-such-style-anywhere' })).toEqual([]);
        const described = listPacks().flatMap(pack => pack.styles).find(style => style.keywords?.length);
        if (described) {
            const byTag = await callJson('list_styles', { pack: described.pack, keyword: described.keywords![0] });
            expect(byTag[0].styles.map((style: { id: string }) => style.id)).toContain(described.id);
        }

        const detail = await callJson('list_styles', { style: target.id });
        expect(detail).toMatchObject({ id: target.id, pack: 'tempera', kind: target.kind, family: target.family, familyLabel: expect.any(String), mood: target.mood });
        expect(detail.componentSlots.map((slot: { id: string }) => slot.id)).toEqual(['typography', 'accent']);
        expect(Array.isArray(detail.borrowableTypographies)).toBe(true);

        expect((await call('list_styles', { mood: 'angry' })).result.isError).toBe(true);
        expect((await call('list_styles', { style: 'tempera/nope' })).result.isError).toBe(true);
    });

    it('reports line counts with interludes, the timeline and the index base', async () => {
        const lrc = ['[00:01.00]光と影のあいだで', '[00:03.50]夢を見ていた', '[00:06.00]君の声を探して', '[00:30.00]夜空に消えた星', '[00:32.50]もう一度だけ', '[00:35.00]'].join('\n');
        useProjectStore.getState().replace({ ...useProjectStore.getState().project, lyrics: { fileName: 'gap.lrc', content: lrc } });
        let project = await callJson('get_project');
        expect(project.indexBase).toBe(0);
        const { total, sung, interlude } = project.lineCounts;
        expect(sung).toBe(5);
        expect(interlude).toBeGreaterThan(0);
        expect(total).toBe(sung + interlude);
        expect(total).toBe(project.lyrics.lines);
        const lyrics = await callJson('get_lyrics');
        expect(lyrics.filter((line: { interlude: boolean }) => line.interlude)).toHaveLength(interlude);
        expect(lyrics.filter((line: { interlude: boolean }) => line.interlude).every((line: { text: string }) => line.text === '......')).toBe(true);
        expect((await call('get_lyrics')).result.structuredContent).toEqual({ lines: lyrics });

        // 没有音频：没有尾部缺口。
        expect(project.timeline).toMatchObject({ audioDuration: null, uncoveredTail: null });
        const lastSung = lyrics.filter((line: { interlude: boolean }) => !line.interlude).at(-1);
        expect(project.timeline.lyricsEnd).toBe(lastSung.endTime);
        expect(project.timeline.arrangementEnd).toBeGreaterThanOrEqual(project.timeline.lyricsEnd);

        // 音频比编排长：给出尾部没有编排的范围。
        useSession.setState({ audioBuffer: { duration: 120 } as AudioBuffer });
        project = await callJson('get_project');
        expect(project.timeline).toMatchObject({ audioDuration: 120, uncoveredTail: { start: project.timeline.arrangementEnd, end: 120 } });
    });

    it('apply_scene_direction reports that the structure is unchanged and which manual paragraphs it skipped', async () => {
        const before = await callJson('get_arrangement');
        await call('set_paragraph_direction', { paragraph: 1, pack: 'lumiere' });
        const result = await callJson('apply_scene_direction', {
            summary: 'x',
            paragraphs: before.paragraphs.map((p: { index: number }) => ({ index: p.index, pack: 'sonnet', energy: 0.5, families: [], transition: 'auto', reason: '' })),
        });
        expect(result).toMatchObject({ structureChanged: false, skippedManual: [1], skippedManualTransitions: [], invalidOps: 0 });
        const after = await callJson('get_arrangement');
        expect(after.paragraphs.map((p: { lines: number[]; kind: string }) => [p.lines, p.kind])).toEqual(before.paragraphs.map((p: { lines: number[]; kind: string }) => [p.lines, p.kind]));
        expect(after.paragraphs[1].direction).toMatchObject({ pack: 'lumiere', source: 'user' });
        expect(after.paragraphs[0].direction).toMatchObject({ pack: 'sonnet', source: 'ai' });
    });

    it('puts JSON results and versions into structuredContent', async () => {
        const script = await call('get_script');
        const version = /# version (\w+)\n$/.exec(script.text)![1];
        expect(script.result.structuredContent).toEqual({ version, script: script.text.replace(/# version \w+\n$/, '') });
        const settings = await call('get_settings');
        expect(settings.result.content[1]).toEqual({ type: 'text', text: `version ${(settings.result.structuredContent as { version: string }).version}` });
        expect((settings.result.structuredContent as { settings: { aspect: string } }).settings.aspect).toBe('16:9');
        const project = await call('get_project');
        expect(project.result.structuredContent).toEqual(JSON.parse(project.text));
        const written = await call('set_paragraph_direction', { paragraph: 0, energy: 0.2 });
        expect(written.result.structuredContent).toMatchObject({ result: expect.any(String), invalidOps: 0 });
        // 纯文本结果与错误没有结构化部分。
        expect((await call('get_arrangement', { paragraph: 999 })).result.structuredContent).toBeUndefined();
    });

    it('render_frame renders one or several moments and puts the playhead back', async () => {
        expect((await call('render_frame', { time: 1 })).text).toMatch(/预览还没有就绪/);
        const rendered: number[] = [];
        const kernel = {
            canvas: { width: 1920, height: 1080 },
            prepareAt: async () => undefined,
            renderAt: (time: number) => {
                // 截帧期间播放头在截的那一刻。
                expect(clock.get()).toBe(time);
                rendered.push(time);
            },
        };
        setPreviewKernel(kernel as unknown as LumiKernel);
        vi.stubGlobal('document', {
            createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => undefined }), toDataURL: () => 'data:image/png;base64,AAAA' }),
        });
        seek(12.5);

        const single = await call('render_frame', { time: 40 });
        expect(single.result.content.map(item => item.type)).toEqual(['image', 'text']);
        expect(single.text).toBe('t = 40s，960×540');
        expect(clock.get()).toBe(12.5);
        expect(usePlayback.getState().time).toBe(12.5);

        const several = await call('render_frame', { times: [1, 2.5, 3], maxWidth: 480 });
        expect(several.result.content.filter(item => item.type === 'image')).toHaveLength(3);
        expect(several.result.content.filter(item => item.type === 'text').map(item => (item.type === 'text' ? item.text : ''))).toEqual(['t = 1s，480×270', 't = 2.5s，480×270', 't = 3s，480×270']);
        expect(rendered).toEqual([40, 1, 2.5, 3]);
        expect(clock.get()).toBe(12.5);

        expect((await call('render_frame', { times: [1, 2, 3, 4, 5, 6, 7] })).result.isError).toBe(true);
        expect((await call('render_frame', { times: [1, 'x'] })).result.isError).toBe(true);
        // 渲染出错也把播放头放回去。
        kernel.renderAt = () => { throw new Error('boom'); };
        expect((await call('render_frame', { time: 30 })).result.isError).toBe(true);
        expect(clock.get()).toBe(12.5);
    });
    it('reads and applies settings, and serves the script reference', async () => {
        const [settings, versionLine] = (await call('get_settings')).result.content.map(item => (item.type === 'text' ? item.text : ''));
        const version = versionLine.replace('version ', '');
        const parsed = JSON.parse(settings);
        expect(parsed.aspect).toBe('16:9');
        expect(parsed.tuning.packs.tempera).toHaveProperty('showBlocks');
        const applied = JSON.parse((await call('apply_settings', { settings: '{ "aspect": "9:16" }', version })).text);
        expect(applied.changes).toEqual(['画幅']);
        expect(useProjectStore.getState().project.aspect).toBe('9:16');
        const stale = await call('apply_settings', { settings: '{ "aspect": "1:1" }', version });
        expect(stale.result.isError).toBe(true);
        const bad = await call('apply_settings', { settings: '{ "aspect": "2:1" }' });
        expect(bad.result.isError).toBe(true);
        expect(bad.text).toContain('LS504');

        const reference = (await call('script_reference')).text;
        expect(reference).toContain('name: lumiscript');
        expect(reference).toContain('# LumiScript v2 语法参考');
    });
});
