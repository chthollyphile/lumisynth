// 剧本（LumiScript v2）：生成、解析、检查、应用。
// 关键性质：生成的剧本原样应用什么都不变（换歌、换 seed、带各种手动修改都一样）；
// 改一条指令只产生对应的一条修改；只写一部分的剧本（手写、agent 写）只改写到的部分；
// 错误标在写错的那一行，带编号、提示与快速修复；有错误时什么都不改。
import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import type { LumiProgram } from '@/compiler/types';
import type { AssetClip } from '@/core/assets/clips';
import { DEFAULT_CLIP_LOOK } from '@/core/assets/clips';
import type { BackgroundClip } from '@/core/assets/background';
import { DEFAULT_BACKGROUND_LOOK } from '@/core/assets/background';
import { applyLyricEdits } from '@/core/lyrics/edits';
import type { Line } from '@/core/types';
import { getPack } from '@/packs/registry';
import { createProject } from '@/project/defaults';
import type { LibraryAsset } from '@/project/assets';
import type { LumiProject } from '@/project/types';
import { applyScript, lintScript, type ScriptEnv } from '@/script/apply';
import { formatDiagnostic, suggest } from '@/script/diagnostics';
import { parseScript } from '@/script/parse';
import { printScript, programToJson } from '@/script/print';
import { applySettings, printSettings } from '@/script/settings';
import { findComment, formatRange, formatTime } from '@/script/syntax';
import { syntheticSong } from '../compiler/fixtures';

const song = syntheticSong(71, true);

const asset = (id: string, kind: 'image' | 'video'): LibraryAsset => ({
    id, name: `${id}.${kind === 'image' ? 'png' : 'webm'}`, kind, asset: { id, name: id, type: kind === 'image' ? 'image/png' : 'video/webm', size: 1 }, width: 10, height: 10,
});

const clip: AssetClip = { id: 'clipaaaa-0001', assetId: 'img11111-aaaa', timing: { type: 'song' }, ...DEFAULT_CLIP_LOOK, x: 0.8, y: 0.3 };
const gradient: BackgroundClip = { id: 'bgbbbbbb-0001', source: { type: 'gradient', from: '#1e1b4b', to: '#115e59', angle: 40 }, timing: { type: 'song' }, ...DEFAULT_BACKGROUND_LOOK };
const video: BackgroundClip = { id: 'bgcccccc-0002', source: { type: 'video', assetId: 'vid22222-bbbb', offset: 1.5, loop: true }, timing: { type: 'absolute', start: 10, end: 20 }, ...DEFAULT_BACKGROUND_LOOK };

const makeProject = (): LumiProject => ({
    ...createProject(),
    seed: 'script',
    assets: [asset('img11111-aaaa', 'image'), asset('vid22222-bbbb', 'video')],
    assetClips: [clip],
    backgroundClips: [gradient, video],
});

const envOf = (project: LumiProject, lines: Line[] = song): ScriptEnv => {
    const compile = (target: LumiProject): LumiProgram => compileLumiProgram({
        lines: applyLyricEdits({ lines }, target.lyricEdits).data.lines,
        seed: target.seed,
        direction: target.direction,
        paragraphDirections: target.paragraphDirections,
        overrides: target.overrides,
        structureEdits: target.structureEdits,
        library: target.library,
        params: target.engineParams,
        packTunings: target.tuning.packs,
    });
    return { project, program: compile(project), sourceLines: lines, compile };
};

const printed = (project: LumiProject) => printScript(envOf(project)).text;
const apply = (project: LumiProject, text: string) => applyScript(text, envOf(project));
const issues = (result: { diagnostics: Array<{ severity: string }> }) => result.diagnostics.filter(item => item.severity !== 'info');
const errorsOf = (result: ReturnType<typeof apply>) => result.diagnostics.filter(item => item.severity === 'error');

const replaceOnce = (text: string, pattern: RegExp | string, replacement: string | ((...match: string[]) => string)) => {
    const next = text.replace(pattern, replacement as string);
    if (next === text) throw new Error(`没有匹配：${pattern}`);
    return next;
};

/** 第 n 个段落块（1 起）的起止行（0 起，含 }）。 */
const blockLines = (text: string, n: number) => {
    const rows = text.split('\n');
    const starts = rows.flatMap((row, index) => (row.startsWith('paragraph') ? [index] : []));
    const start = starts[n - 1];
    const end = rows.findIndex((row, index) => index > start && row === '}');
    return { rows, start, end };
};

/** 只在第 n 段的块里改。 */
const inParagraph = (text: string, n: number, change: (block: string) => string) => {
    const { rows, start, end } = blockLines(text, n);
    return [...rows.slice(0, start), change(rows.slice(start, end + 1).join('\n')), ...rows.slice(end + 1)].join('\n');
};

/** 把第 n 段里以 keyword 开头的那一行换成 line。 */
const setInParagraph = (text: string, n: number, keyword: string, line: string) => inParagraph(text, n, block => replaceOnce(block, new RegExp(`^ {2}${keyword} .*$`, 'm'), line));

/** 第 n 段第 k 个镜头的行（shot k 风格 …）换成 change 的结果。 */
const shotLine = (text: string, n: number, k: number, change: (line: string) => string) => inParagraph(text, n, block => replaceOnce(block, new RegExp(`^ {2}shot ${k} .*$`, 'm'), line => change(line)));

/** 在第 n 段的 } 前面插一行。 */
const addToParagraph = (text: string, n: number, line: string) => inParagraph(text, n, block => block.replace(/\n}$/, `\n${line}\n}`));

const project0 = makeProject();
const env0 = envOf(project0);
const program0 = env0.program;
const script0 = printed(project0);

describe('syntax', () => {
    it('tells comments from colours and strings, formats times', () => {
        expect(findComment('source gradient #1e1b4b #115e59 40  # 注释')).toBe(36);
        expect(findComment('line 1 0:01.00-0:02.00 "a # b"')).toBe(-1);
        expect(findComment('# 整行注释')).toBe(0);
        expect(formatTime(65.456)).toBe('1:05.46');
        expect(formatTime(59.999)).toBe('1:00.00');
        expect(formatRange(1, 2)).toBe('0:01.00-0:02.00');
    });

    it('suggests close names', () => {
        expect(suggest('tempra', ['tempera', 'sonnet', 'lumiere'])).toEqual(['tempera']);
        expect(suggest('duo-split', ['tempera/duo-split', 'tempera/louvre-slats'])[0]).toBe('tempera/duo-split');
        expect(suggest('zzzz', ['tempera'])).toEqual([]);
    });
});

describe('print', () => {
    it('writes directives only; compiled facts go into comments', () => {
        const { lines, text } = printScript(env0);
        expect(text).toContain('lumiscript 2');
        expect(text).toContain('seed "script"');
        // 自动选出的值照常写成指令（可以直接改），标着「自动」。
        expect(text).toMatch(/^ {2}pack tempera {2}# 自动$/m);
        expect(text).toMatch(/^ {2}energy auto$/m);
        expect(text).toMatch(/^ {2}families all {2}# 自动$/m);
        expect(text).toMatch(/^ {2}transition tempera\/\S+ {2}# 自动 · /m);
        expect(text).toMatch(/^paragraph \w+ \{ {2}# 第 1 段/m);
        expect(text).toMatch(/^ {2}shot 1 tempera\/\S+ \{ {2}# \S+ · 自动/m);
        expect(text).toMatch(/^ {4}typography \S+$/m);
        // 每一段一个块，每个镜头一行，每一行歌词一条 line。
        const headers = lines.filter(line => line.text.startsWith('paragraph'));
        expect(headers.map(line => line.paragraphId)).toEqual(program0.paragraphs.map(p => p.id));
        const shots = lines.filter(line => /^ {2}shot \d+/.test(line.text));
        expect(shots.map(line => line.shotId)).toEqual(program0.paragraphs.flatMap(p => p.shots.map(s => s.id)));
        expect(lines.filter(line => line.lineIndex !== undefined && line.text.startsWith('  line ')).map(line => line.lineIndex)).toEqual(program0.lines.map((_, i) => i));
        expect(lines.find(line => line.text.startsWith('clip clipaaaa'))?.clipId).toBe(clip.id);
        expect(text).toContain('source gradient #1e1b4b #115e59 40');
        expect(text).toContain('source video vid22222 offset 1.50 loop');
        expect(text).toContain('at 0:10.00-0:20.00');
        expect(text).toContain('#   img11111  "img11111-aaaa.png"  图片');
        expect(text.split('{').length).toBe(text.split('}').length);
        // 纯文本的注释之外没有编译结果：解析自己的输出没有任何诊断。
        expect(parseScript(text).diagnostics).toEqual([]);
    });

    it('strips native data from JSON by default', () => {
        expect(programToJson(program0)).not.toContain('"native"');
        expect(programToJson(program0, true)).toContain('"native"');
    });
});

describe('round trip', () => {
    it('applying the printed script changes nothing, for any song, seed and pack', () => {
        [[71, 'a'], [5, 'b'], [13, 'zz']].forEach(([songSeed, seed]) => {
            const lines = syntheticSong(songSeed as number, songSeed !== 5);
            (['tempera', 'sonnet', 'lumiere', 'mix'] as const).forEach(pack => {
                const project: LumiProject = {
                    ...makeProject(),
                    seed: seed as string,
                    direction: pack === 'mix' ? { ...createProject().direction, mode: 'mix' } : { ...createProject().direction, mode: 'single', pack },
                };
                const env = envOf(project, lines);
                const result = applyScript(printScript(env).text, env);
                expect(issues(result), `${songSeed}/${seed}/${pack}`).toEqual([]);
                expect(result.changes, `${songSeed}/${seed}/${pack}`).toEqual([]);
                expect(result.project).toBe(project);
            });
        });
    });

    it('keeps every kind of manual edit through print → apply', () => {
        const paragraph = program0.paragraphs[1];
        const third = program0.paragraphs[2];
        const shot = paragraph.shots[0];
        const split = paragraph.lineIndices[1];
        const line = program0.lines[4];
        const project: LumiProject = {
            ...project0,
            direction: { ...project0.direction, shotMixing: true, mixByKind: { ...project0.direction.mixByKind!, chorus: 'lumiere' } },
            paragraphDirections: [
                { anchor: paragraph.anchor, pack: 'sonnet', energy: 0.8, source: 'user' },
                { anchor: third.anchor, families: null, source: 'ai' },
            ],
            overrides: [
                { id: 'x', type: 'shot-style', anchor: third.shots[0].anchor, style: third.shots[0].style },
                { id: 'ai-t', type: 'transition', anchor: paragraph.anchor, transition: 'none' },
                { id: 'dead', type: 'shot-component', anchor: { ...shot.anchor, line: { ...shot.anchor.line, hash: 'dead' } }, slot: 'accent', value: 'none' },
            ],
            structureEdits: [
                { id: 'b', type: 'break', anchor: program0.lines[split].anchor },
                { id: 'k', type: 'kind', anchor: paragraph.anchor.line, kind: 'chorus' },
            ],
            lyricEdits: {
                offset: 0.25,
                lines: [{ anchor: line.anchor, text: `${line.line.fullText}よ` }, { anchor: program0.lines[6].anchor, startTime: program0.lines[6].line.startTime + 0.1234, endTime: program0.lines[6].line.endTime }],
                segments: [{ anchor: program0.lines[7].anchor, parts: [program0.lines[7].line.fullText.slice(0, 1), program0.lines[7].line.fullText.slice(1)] }],
            },
            assetClips: [{ ...clip, effect: { type: 'echo', color: '#ff0000', size: 0.5, opacity: 0.6, period: 1.6 }, motion: { type: 'float', amount: 0.33 }, rotation: 0.123456, x: 0.12345 }],
        };
        const env = envOf(project);
        const text = printScript(env).text;
        expect(text).toContain('mix chorus lumiere');
        expect(text).toContain('shot-mixing on');
        expect(text).toContain('lyric-offset 0.25');
        expect(text).toContain('  pack sonnet locked');
        expect(text).toContain('  energy 0.80 locked');
        expect(text).toContain('  families all @ai');
        expect(text).toContain('  transition none @ai');
        expect(text).toContain(`  shot 1 ${third.shots[0].style} locked`);
        expect(text).toMatch(/^paragraph chorus locked \{/m);
        expect(text).toContain('    parts ');
        expect(text).toContain('effect echo #ff0000 0.50 0.60 1.60');
        expect(text).toContain('motion float 0.33');
        expect(text).toContain('# 没有生效的修改');
        const result = applyScript(text, env);
        expect(issues(result)).toEqual([]);
        expect(result.changes).toEqual([]);
        expect(result.project).toBe(project);
    });
});

describe('edits', () => {
    it('one changed directive makes exactly the one intended change', () => {
        const paragraph2 = program0.paragraphs[1];
        const shot = paragraph2.shots[0];
        const other = getPack(shot.pack).styles.find(style => style.id !== shot.style)!;
        const cases: Array<[string, (text: string) => string, (project: LumiProject, program: LumiProgram) => void]> = [
            ['seed', text => replaceOnce(text, 'seed "script"', 'seed "other"'), project => expect(project.seed).toBe('other')],
            ['pack', text => setInParagraph(text, 2, 'pack', '  pack sonnet'), (project, program) => {
                expect(project.paragraphDirections).toEqual([expect.objectContaining({ pack: 'sonnet', source: 'user' })]);
                expect(program.paragraphs[1].direction.pack).toBe('sonnet');
            }],
            ['ai pack', text => setInParagraph(text, 2, 'pack', '  pack sonnet @ai'), project => expect(project.paragraphDirections[0].source).toBe('ai')],
            ['pin the auto pack', text => setInParagraph(text, 2, 'pack', `  pack ${paragraph2.direction.pack} locked`), project => {
                expect(project.paragraphDirections).toEqual([expect.objectContaining({ pack: paragraph2.direction.pack, source: 'user' })]);
            }],
            ['energy', text => setInParagraph(text, 2, 'energy', '  energy 0.9'), project => expect(project.paragraphDirections[0].energy).toBe(0.9)],
            ['kind', text => inParagraph(text, 2, block => block.replace(/^paragraph \w+/, paragraph2.kind === 'outro' ? 'paragraph verse' : 'paragraph outro')), (_, program) => {
                expect(program.paragraphs[1]).toMatchObject({ kind: paragraph2.kind === 'outro' ? 'verse' : 'outro', kindManual: true });
            }],
            ['transition', text => setInParagraph(text, 2, 'transition', '  transition none'), (_, program) => expect(program.paragraphs[1].transitionOut).toBeNull()],
            ['restyle', text => shotLine(text, 2, 1, line => line.replace(shot.style, other.id)), (_, program) => {
                expect(program.paragraphs[1].shots[0]).toMatchObject({ style: other.id, locked: true });
            }],
            ['lock', text => shotLine(text, 2, 1, line => line.replace(shot.style, `${shot.style} locked`)), (_, program) => {
                expect(program.paragraphs[1].shots[0]).toMatchObject({ style: shot.style, locked: true });
            }],
            ['clip', text => replaceOnce(text, 'position 0.800 0.300', 'position 0.200 0.300'), project => expect(project.assetClips[0].x).toBe(0.2)],
            ['offset', text => replaceOnce(text, 'lyric-offset 0.00', 'lyric-offset 0.50'), project => expect(project.lyricEdits.offset).toBe(0.5)],
        ];
        cases.forEach(([name, change, verify]) => {
            const result = apply(project0, change(script0));
            expect(issues(result), name).toEqual([]);
            expect(result.changes, name).toHaveLength(1);
            verify(result.project, envOf(result.project).program);
        });
    });

    it('locks a shot component, borrows a typography, and unlocks by removing the style', () => {
        const shot = program0.paragraphs[0].shots[0];
        const other = shot.components.typography === 'collage' ? 'stack' : 'collage';
        const typography = (value: string) => inParagraph(script0, 1, block => replaceOnce(block, new RegExp(`^ {4}typography ${shot.components.typography}$`, 'm'), `    typography ${value}`));
        const edited = typography(other);
        const result = apply(project0, edited);
        expect(issues(result)).toEqual([]);
        expect(result.changes).toEqual([`镜头 1.1 的 typography：${other}`]);
        expect(envOf(result.project).program.paragraphs[0].shots[0].components.typography).toBe(other);

        const borrowed = typography('sonnet/poster-blocks');
        expect(envOf(apply(project0, borrowed).project).program.paragraphs[0].shots[0].borrowedText).toMatchObject({ pack: 'sonnet' });

        const locked = apply(project0, shotLine(script0, 1, 1, line => line.replace(shot.style, `${shot.style} locked`))).project;
        expect(printed(locked)).toContain(`  shot 1 ${shot.style} locked {`);
        const unlocked = apply(locked, shotLine(printed(locked), 1, 1, line => line.replace(' locked', '')));
        expect(unlocked.changes).toEqual(['镜头 1.1 解除锁定']);
        expect(unlocked.project.overrides).toEqual([]);
    });

    it('splits and merges paragraphs by moving line statements between blocks', () => {
        const target = program0.paragraphs.find(p => p.lineIndices.length >= 3)!;
        const n = target.index + 1;
        const at = target.lineIndices[1];
        // 拆分：在第二行前面结束这一段、开一个新块。
        const split = inParagraph(script0, n, block => replaceOnce(block, new RegExp(`^ {2}line ${at + 1} `, 'm'), `}\nparagraph {\n  line ${at + 1} `));
        const splitResult = apply(project0, split);
        expect(issues(splitResult).filter(item => item.severity === 'error')).toEqual([]);
        expect(splitResult.changes).toEqual([`在第 ${at + 1} 行开新段`]);
        const splitProgram = envOf(splitResult.project).program;
        expect(splitProgram.paragraphs.map(p => p.lineIndices[0])).toContain(at);

        // 合并：把下一段的 line 挪进这一段，删掉下一段的块。
        const next = program0.paragraphs[target.index + 1];
        const { rows, start, end } = blockLines(script0, n + 1);
        const moved = rows.slice(start + 1, end).filter(row => row.startsWith('  line '));
        const withoutNext = [...rows.slice(0, start), ...rows.slice(end + 1)].join('\n');
        const merged = inParagraph(withoutNext, n, block => block.replace(/\n(  shot 1\b)/, `\n${moved.join('\n')}\n$1`));
        const mergeResult = apply(project0, merged);
        expect(errorsOf(mergeResult)).toEqual([]);
        expect(mergeResult.changes).toEqual([`第 ${next.lineIndices[0] + 1} 行起的段落并进上一段`]);
        expect(envOf(mergeResult.project).program.paragraphs).toHaveLength(program0.paragraphs.length - 1);
        // 合并后再原样应用：不再变。
        const again = apply(mergeResult.project, printed(mergeResult.project));
        expect(again.project).toBe(mergeResult.project);
    });

    it('edits lyric text, time, word timing and segmentation through line statements', () => {
        const index = 2;
        const line = program0.lines[index].line;
        const pattern = new RegExp(`^ {2}line ${index + 1} (\\S+) ("[^"]*")(.*)$`, 'm');
        const match = pattern.exec(script0)!;
        const text = JSON.parse(match[2]) as string;

        const retyped = apply(project0, script0.replace(match[0], `  line ${index + 1} ${match[1]} ${JSON.stringify(`${text}！`)}`));
        expect(retyped.changes).toEqual([`第 ${index + 1} 行改字：「${text}」→「${text}！」`]);
        const program = envOf(retyped.project).program;
        expect(program.lines[index].line.fullText).toBe(`${text}！`);
        // 没变的字保留时间。
        expect(program.lines[index].line.words[0].startTime).toBeCloseTo(line.words[0].startTime, 5);
        // 应用后再原样应用：不再变。
        expect(apply(retyped.project, printed(retyped.project)).project).toBe(retyped.project);

        const retimed = apply(project0, script0.replace(match[0], `  line ${index + 1} ${formatRange(line.startTime + 0.5, line.endTime + 0.5)} ${match[2]}`));
        expect(retimed.changes).toEqual([`第 ${index + 1} 行的时间改为 ${formatRange(line.startTime + 0.5, line.endTime + 0.5)}`]);

        // 逐字时间与分词：块里写 word 与 parts。
        const units = [...text].map((char, i) => `    word ${formatRange(line.startTime + i * 0.05, line.startTime + (i + 1) * 0.05)} ${JSON.stringify(char)}`);
        const worded = apply(project0, script0.replace(match[0], `${match[0]} {\n    parts ${JSON.stringify(text.slice(0, 1))} ${JSON.stringify(text.slice(1))}\n${units.join('\n')}\n  }`));
        expect(errorsOf(worded)).toEqual([]);
        expect(worded.project.lyricEdits.segments[0].parts).toEqual([text.slice(0, 1), text.slice(1)]);
        expect(envOf(worded.project).program.lines[index].line.words[1].startTime).toBeCloseTo(line.startTime + 0.05, 2);
        expect(apply(worded.project, printed(worded.project)).project).toBe(worded.project);

        // 译文：块里写 translation（none 不显示），写回歌词文件里的译文就去掉修改。
        const withTranslation = song.map((item, i) => (i === index ? { ...item, translation: '原来的译文' } : item));
        const envT = (project: LumiProject) => envOf(project, withTranslation);
        const printT = (project: LumiProject) => printScript(envT(project)).text;
        const applyT = (project: LumiProject, text: string) => applyScript(text, envT(project));
        const translated = applyT(project0, script0.replace(match[0], `${match[0]} {\n    translation "新的译文"\n  }`));
        expect(translated.changes).toEqual([`第 ${index + 1} 行的译文改为「新的译文」`]);
        expect(envT(translated.project).program.lines[index].line.translation).toBe('新的译文');
        expect(printT(translated.project)).toContain('    translation "新的译文"');
        expect(printT(translated.project)).toContain('改过译文，原来 "原来的译文"');
        expect(applyT(translated.project, printT(translated.project)).project).toBe(translated.project);
        const hidden = applyT(translated.project, printT(translated.project).replace('translation "新的译文"', 'translation none'));
        expect(hidden.changes).toEqual([`第 ${index + 1} 行不显示译文`]);
        expect(envT(hidden.project).program.lines[index].line.translation).toBeUndefined();
        expect(printT(hidden.project)).toContain('    translation none');
        const untranslated = applyT(hidden.project, printT(hidden.project).replace('    translation none\n', ''));
        expect(untranslated.changes).toEqual([`第 ${index + 1} 行恢复原样`]);
        expect(untranslated.project.lyricEdits.lines).toEqual([]);

        // 回到原文：修改去掉。
        const restored = apply(retyped.project, printed(retyped.project).replace(JSON.stringify(`${text}！`), match[2]));
        expect(restored.changes).toEqual([`第 ${index + 1} 行恢复原样`]);
        expect(restored.project.lyricEdits.lines).toEqual([]);
    });

    it('edits, adds and deletes clips and reorders backgrounds', () => {
        const withNew = `${script0}\nclip {\n  asset "img11111-aaaa.png"\n  at paragraph 2\n  effect glow #00ff00\n  motion sway\n}\n`;
        const added = apply(project0, withNew);
        expect(issues(added)).toEqual([]);
        expect(added.changes).toHaveLength(1);
        const created = added.project.assetClips[1];
        expect(created).toMatchObject({ assetId: 'img11111-aaaa', timing: { type: 'paragraph' }, effect: { type: 'glow', color: '#00ff00' }, motion: { type: 'sway', amount: 0.5 } });

        const deleted = apply(project0, script0.replace(/^clip clipaaaa[^]*?^}\n/m, 'clips none\n'));
        expect(deleted.changes).toEqual([`删除了素材片段 clipaaaa`]);
        expect(deleted.project.assetClips).toEqual([]);

        const gradientBlock = /^background bgbbbbbb[^]*?^}\n/m.exec(script0)![0];
        const reordered = apply(project0, script0.replace(gradientBlock, '').replace(/(^background bgcccccc[^]*?^}\n)/m, `$1${gradientBlock}`));
        expect(reordered.changes).toEqual(['调整了背景片段的叠放顺序']);
        expect(reordered.project.backgroundClips.map(item => item.id)).toEqual([video.id, gradient.id]);
    });

    it('paragraphs auto hands the whole arrangement back', () => {
        const project: LumiProject = { ...project0, paragraphDirections: [{ anchor: program0.paragraphs[1].anchor, pack: 'sonnet', source: 'user' }] };
        const result = apply(project, 'paragraphs auto\n');
        expect(result.changes).toEqual(['分段、段落编排、转场与镜头全部交回自动']);
        expect(result.project.paragraphDirections).toEqual([]);
    });
});

describe('hand-written and partial scripts', () => {
    it('a script with only a clip adds the clip and touches nothing else', () => {
        const result = apply(project0, 'clip {\n  asset img11111\n  at shot 2.1\n}\n');
        expect(errorsOf(result)).toEqual([]);
        expect(result.project.assetClips).toHaveLength(2);
        expect(result.project.assetClips[0]).toBe(clip);
        expect(result.project.assetClips[1].timing).toMatchObject({ type: 'shot', anchor: program0.paragraphs[1].shots[0].anchor });
        // clips none 先清空：只剩写的这些。
        expect(apply(project0, 'clips none\nclip {\n  asset img11111\n  at song\n}\n').project.assetClips).toHaveLength(1);
        expect(result.project.backgroundClips).toBe(project0.backgroundClips);
        expect(result.project.seed).toBe(project0.seed);
    });

    it('a hand-written arrangement with line ranges sets exactly what it says', () => {
        const count = program0.lines.length;
        const text = [
            'lumiscript 2',
            'seed "hand"',
            'direction single sonnet',
            'paragraph verse {',
            '  lines 1..4',
            '}',
            'paragraph chorus {',
            `  lines 5..${count}`,
            '  pack tempera locked',
            '  transition none',
            '}',
        ].join('\n');
        const result = apply(project0, text);
        expect(errorsOf(result)).toEqual([]);
        const program = envOf(result.project).program;
        expect(program.paragraphs.map(p => [p.lineIndices[0], p.kind, p.direction.pack])).toEqual([[0, 'verse', 'sonnet'], [4, 'chorus', 'tempera']]);
        // 一个段落块写了，其余的编排就按剧本来：再原样应用不变。
        expect(apply(result.project, printed(result.project)).project).toBe(result.project);
    });
});

describe('diagnostics', () => {
    it('reports every syntax error at once, with positions and v1 hints', () => {
        const { diagnostics } = parseScript('seed "abc\ndirection single\nparagraph 3 chorus 0:01.00-0:02.00 {\n}\nboundary time-gap\nclip {\n  scale 9\n');
        expect(diagnostics.map(item => item.code)).toEqual(['LS101', 'LS111', 'LS112', 'LS110', 'LS106', 'LS114']);
        const scale = diagnostics.find(item => item.code === 'LS114')!;
        expect(scale).toMatchObject({ line: 7, from: 8, to: 9 });
        expect(scale.fixes?.[0].edits[0].insert).toBe('5');
        expect(diagnostics.find(item => item.code === 'LS110')?.hint).toContain('v2 不再写 boundary');
    });

    it('suggests names and offers quick fixes', () => {
        const typo = setInParagraph(script0, 1, 'pack', '  pack tempra');
        const [problem] = errorsOf(apply(project0, typo));
        expect(problem).toMatchObject({ code: 'LS201', hint: '是不是想写 tempera？' });
        expect(problem.fixes?.[0]).toMatchObject({ label: '改成 tempera' });
        expect(formatDiagnostic(problem)).toMatch(/^第 \d+ 行第 \d+ 列 错误 LS201：没有风格包 tempra\n {2}→ 是不是想写 tempera？$/);

        const style = shotLine(script0, 1, 1, line => line.replace(/tempera\/\S+/, 'tempera/duo-splt'));
        expect(errorsOf(apply(project0, style))[0]).toMatchObject({ code: 'LS202', hint: expect.stringContaining('tempera/duo-split') });
    });

    it('explains gaps and overlaps with the related paragraph', () => {
        const { rows, start, end } = blockLines(script0, 2);
        const firstLine = rows.slice(start, end).findIndex(row => row.startsWith('  line '));
        const gap = [...rows.slice(0, start + firstLine), ...rows.slice(start + firstLine + 1)].join('\n');
        const result = apply(project0, gap);
        const problem = errorsOf(result).find(item => item.code === 'LS301')!;
        expect(problem.message).toMatch(/^第 \d+ 行不在任何段落里$/);
        expect(problem.related?.[0].message).toMatch(/^上一段到第 \d+ 行$/);
        expect(result.project).toBe(project0);
    });

    it('maps compile-time failures back to the line that asked for them', () => {
        const paragraph = program0.paragraphs[0];
        const foreign = paragraph.direction.pack === 'sonnet' ? 'tempera/duo-split' : 'sonnet/type-impact';
        const edited = shotLine(script0, 1, 1, line => line.replace(paragraph.shots[0].style, foreign).replace(' {', '  # 组件换了包，去掉块').replace(/  #.*$/, ''));
        const withoutBlock = inParagraph(edited, 1, block => block.replace(new RegExp(`(^ {2}shot 1 [^\\n]*)\\n(?: {4}[^\\n]*\\n)* {2}}\\n`, 'm'), '$1\n'));
        const result = apply(project0, withoutBlock);
        const problem = errorsOf(result)[0];
        expect(problem).toMatchObject({ code: 'LS402', message: expect.stringContaining(foreign) });
        expect(withoutBlock.split('\n')[problem.line - 1]).toContain(`shot 1 ${foreign}`);
        expect(problem.hint).toContain('shot-mixing on');
        expect(result.project).toBe(project0);

        // 开了按镜头混用、块里还留着原来那个包的组件：去掉并提示，照常应用。
        const mixing = replaceOnce(shotLine(script0, 1, 1, line => line.replace(paragraph.shots[0].style, foreign)), 'shot-mixing off', 'shot-mixing on');
        const leftover = apply(project0, mixing);
        expect(errorsOf(leftover)).toEqual([]);
        const fits = (packId: string, slot: string, value: string) => Boolean(getPack(packId as never).componentSlots?.some(def => def.id === slot && def.options.some(option => option.id === value)));
        const newPack = foreign.split('/')[0];
        const foreignComponents = Object.entries(paragraph.shots[0].components).filter(([slot, value]) => !fits(newPack, slot, value));
        expect(foreignComponents.length).toBeGreaterThan(0);
        expect(leftover.diagnostics.filter(item => item.code === 'LS903')).toHaveLength(foreignComponents.length);
        expect(envOf(leftover.project).program.paragraphs[0].shots[0]).toMatchObject({ style: foreign, locked: true });
        expect(envOf(leftover.project).program.invalidOps).toEqual([]);
        // 不是原来的取值（写错了，不是留下来的）：照样是错误。
        const [slot, value] = foreignComponents[0];
        const other = getPack(paragraph.shots[0].pack).componentSlots!.find(def => def.id === slot)!.options
            .map(option => option.id).find(id => id !== value && !fits(newPack, slot, id));
        if (other) {
            const wrong = replaceOnce(mixing, new RegExp(`^ {4}${slot} ${value}$`, 'm'), `    ${slot} ${other}`);
            expect(errorsOf(apply(project0, wrong)).map(item => item.code)).toEqual([expect.stringMatching(/^LS20[56]$/)]);
        }

        const tooMany = addToParagraph(script0, 1, `  shot ${paragraph.shots.length + 1} ${paragraph.shots[0].style} locked`);
        expect(errorsOf(apply(project0, tooMany))[0]).toMatchObject({ code: 'LS317', message: `第 1 段只有 ${paragraph.shots.length} 个镜头` });
    });

    it('checks lyric lines, words and parts', () => {
        const index = 1;
        const pattern = new RegExp(`^ {2}line ${index + 1} (\\S+) ("[^"]*")(.*)$`, 'm');
        const match = pattern.exec(script0)!;
        const wrongParts = script0.replace(match[0], `${match[0]} {\n    parts "x" "y"\n  }`);
        const problem = errorsOf(apply(project0, wrongParts))[0];
        expect(problem.code).toBe('LS312');
        expect(problem.fixes?.[0].label).toBe('按新文字自动修复分词');
        const duplicate = addToParagraph(script0, 3, match[0]);
        expect(errorsOf(apply(project0, duplicate)).map(item => item.code)).toContain('LS304');
    });

    it('lints without applying', () => {
        expect(lintScript(script0, env0)).toEqual([]);
        expect(lintScript(setInParagraph(script0, 1, 'families', '  families nope'), env0)[0]).toMatchObject({ code: 'LS204', severity: 'error' });
        // 同一条指令写了两遍：提示，以后面的为准。
        expect(lintScript(addToParagraph(script0, 1, '  pack tempera'), env0)[0]).toMatchObject({ code: 'LS902', severity: 'warning' });
    });
});

describe('settings sidecar', () => {
    it('round-trips and changes one section at a time', () => {
        const text = printSettings(project0);
        const same = applySettings(text, project0);
        expect(same.ok).toBe(true);
        expect(same.changes).toEqual([]);
        expect(same.project).toBe(project0);

        const settings = JSON.parse(text);
        settings.theme.dark.accentColor = '#ff0000';
        const themed = applySettings(JSON.stringify(settings, null, 2), project0);
        expect(themed.changes).toEqual(['主题']);
        expect(themed.project.theme.dual.dark.accentColor).toBe('#ff0000');

        // 只写一部分：其余不动。
        const partial = applySettings('{ "aspect": "9:16" }', project0);
        expect(partial.changes).toEqual(['画幅']);
        expect(partial.project.aspect).toBe('9:16');
        expect(partial.project.theme).toBe(project0.theme);

        // 合并方式：只改写到的字段，同一部分里别的字段不动；主题只写一种颜色也行。
        const tuned = applySettings('{ "tuning": { "kernel": { "subtitles": { "opacity": 0.9 } } } }', { ...project0, tuning: { ...project0.tuning, kernel: { ...project0.tuning.kernel, subtitles: { mode: 'translation', scale: 1.3, opacity: 0.6 } } } }, { merge: true });
        expect(tuned.changes).toEqual(['tuning']);
        expect(tuned.project.tuning.kernel.subtitles).toEqual({ mode: 'translation', scale: 1.3, opacity: 0.9 });
        const accent = applySettings('{ "theme": { "dark": { "accentColor": "#00ff00" } } }', project0, { merge: true });
        expect(accent.ok).toBe(true);
        expect(accent.project.theme.dual.dark).toEqual({ ...project0.theme.dual.dark, accentColor: '#00ff00' });
        // 整体替换时同样的写法缺了必填字段。
        expect(applySettings('{ "theme": { "dark": { "accentColor": "#00ff00" } } }', project0).ok).toBe(false);
        // 合并方式照样查键名与类型。
        expect(applySettings('{ "tuning": { "kernel": { "subtitles": { "opacty": 0.9 } } } }', project0, { merge: true }).diagnostics[0]).toMatchObject({ code: 'LS502' });
    });

    it('locates JSON errors, unknown keys and wrong types', () => {
        const syntax = applySettings('{\n  "aspect": "9:16",\n}', project0);
        expect(syntax.diagnostics[0]).toMatchObject({ code: 'LS501', line: 3 });

        const unknown = applySettings('{\n  "tuning": { "kernel": { "postProces": {} } }\n}', project0);
        expect(unknown.diagnostics[0]).toMatchObject({ code: 'LS502', line: 2, hint: '是不是想写 postProcess？' });

        const wrongType = applySettings('{ "tuning": { "packs": { "tempera": { "showBlocks": "yes" } } } }', project0);
        expect(wrongType.diagnostics[0]).toMatchObject({ code: 'LS503', message: 'tuning.packs.tempera.showBlocks 应该是true / false' });

        const color = applySettings('{ "theme": { "dark": { "name": "x", "backgroundColor": "red", "primaryColor": "#ffffff", "accentColor": "#ffffff", "secondaryColor": "#ffffff" } } }', project0);
        expect(color.diagnostics[0]).toMatchObject({ code: 'LS504', message: expect.stringContaining('#rrggbb') });
        expect(color.ok).toBe(false);
    });
});
