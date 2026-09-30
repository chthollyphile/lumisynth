// src/app/views/ProblemsView.tsx
// 「问题」面板：失效的歌词修改、失效的编排修改（EditOp）。失效项不会被悄悄丢掉，而是列在这里。
import { useProjectStore } from '@/project/store';
import { repairLineSegmentation } from '@/project/lyrics';
import { setSession, useSession } from '@/project/session';
import { resolveAssetClips } from '@/core/assets/clips';
import { removeAssetClip, removeBackgroundClip } from '@/project/assets';
import { resolveBackgroundClips } from '@/core/assets/background';
import { AlertTriangle } from 'lucide-react';
import type { InvalidEdit } from '@/core/lyrics/edits';
import { updateProject } from '@/project/store';
import type { InvalidEditOp } from '@/compiler/types';
import { useEffectiveLyrics, useProgram } from '../DerivedProvider';

const REASONS: Record<InvalidEdit['reason'], string> = {
    'line-missing': '对应的行已不存在',
    'text-changed': '歌词文件里这一行的原文变了（换过歌词文件）',
    'invalid-segmentation': '分词拼起来与原文不符',
};

export interface Problem {
    key: string;
    message: string;
    detail: string;
    remove: () => void;
    /** 按钮上的字（默认「删除这条修改」）。 */
    action?: string;
    /** 排在删除前面的其他操作（比如自动修复）。 */
    extra?: Array<{ label: string; run: () => void }>;
}

const OP_REASONS: Record<InvalidEditOp['reason'], string> = {
    'anchor-missing': '锚定的 shot 或段落已不存在（歌词、分段或 seed 变了）',
    'style-unknown': '风格不存在',
    'transition-unknown': '转场不存在',
    'pack-mismatch': '风格属于另一个包，而该段没有开按 shot 混用',
    'component-unknown': '这个镜头所属的风格包没有这个组件或选项（可能换过包或风格）',
};

export const useProblems = (): Problem[] => {
    const program = useProgram();
    const lyricProblems = useLyricProblems();
    const opProblems: Problem[] = program.invalidOps.filter(({ op }) => !op.id.startsWith('peek-')).map(({ op, reason }) => ({
        key: `op-${op.id}`,
        message: op.type === 'shot-style'
            ? `第 ${op.anchor.line.index + 1} 行的 shot 风格锁定（${op.style}）已失效`
            : op.type === 'shot-component'
                ? `第 ${op.anchor.line.index + 1} 行镜头的组件设置（${op.slot} = ${op.value}）已失效`
                : `第 ${op.anchor.line.index + 1} 行起的段落转场设置已失效`,
        detail: OP_REASONS[reason],
        remove: () => updateProject(project => ({ ...project, overrides: project.overrides.filter(item => item.id !== op.id) })),
    }));
    const directionProblems: Problem[] = program.invalidDirections.map((item, index) => ({
        key: `direction-${index}-${item.anchor.line.index}`,
        message: `第 ${item.anchor.line.index + 1} 行起的段落编排设置已失效`,
        detail: '该行已不存在、文本已变，或不再是段首',
        remove: () => updateProject(project => ({
            ...project,
            paragraphDirections: project.paragraphDirections.filter(other => other !== item),
        })),
    }));
    const structureProblems: Problem[] = program.invalidStructureEdits.map(({ edit, reason }) => ({
        key: `structure-${edit.id}`,
        message: edit.type === 'kind'
            ? `第 ${edit.anchor.index + 1} 行起的段落性质设置已失效`
            : `第 ${edit.anchor.index + 1} 行的手动${edit.type === 'break' ? '分段' : '合并'}已失效`,
        detail: reason === 'line-missing' ? '该行已不存在或文本已变' : reason === 'first-line' ? '第一行本来就是段首' : '这一行已经不是段首',
        remove: () => updateProject(project => ({ ...project, structureEdits: project.structureEdits.filter(item => item.id !== edit.id) })),
    }));
    const assetClips = useProjectStore(state => state.project.assetClips);
    const assets = useProjectStore(state => state.project.assets);
    const clipProblems: Problem[] = resolveAssetClips(assetClips, program, new Set(assets.map(item => item.id))).invalid.map(({ clip, reason }) => ({
        key: `clip-${clip.id}`,
        message: `素材片段「${assets.find(item => item.id === clip.assetId)?.name ?? clip.assetId}」没有显示`,
        detail: reason === 'asset-missing' ? '素材库里已经没有这个素材' : '它挂载的歌词行 / 段落 / 镜头已不存在（可以改为绝对时间）',
        remove: () => removeAssetClip(clip.id),
    }));
    const backgroundClips = useProjectStore(state => state.project.backgroundClips);
    const backgroundProblems: Problem[] = resolveBackgroundClips(backgroundClips, program, new Set(assets.map(item => item.id))).invalid.map(({ clip, reason }) => ({
        key: `background-${clip.id}`,
        message: '一个背景片段没有显示',
        detail: reason === 'asset-missing' ? '素材库里已经没有它用的图片或视频' : '它跟随的段落已不存在（可以改为全曲或绝对时间）',
        remove: () => removeBackgroundClip(clip.id),
    }));
    const scriptProblems: Problem[] = useSession(state => state.scriptProblems).map((item, index) => ({
        key: `script-${index}-${item.line}`,
        message: `${item.code.startsWith('LS5') ? '设置' : '剧本'}第 ${item.line} 行 ${item.code}：${item.message}`,
        detail: [item.hint, item.severity === 'error' ? '没有应用' : '提示'].filter(Boolean).join('；'),
        remove: () => setSession({ scriptProblems: useSession.getState().scriptProblems.filter(other => other !== item) }),
        action: '忽略',
    }));
    return [...lyricProblems, ...opProblems, ...directionProblems, ...structureProblems, ...clipProblems, ...backgroundProblems, ...scriptProblems];
};

export const useLyricProblems = (): Problem[] => {
    const { invalidEdits, data } = useEffectiveLyrics();
    return invalidEdits.map((edit, index) => {
        const same = (item: { anchor: { index: number; hash: string } }) => item.anchor.index === edit.anchor.index && item.anchor.hash === edit.anchor.hash;
        const line = data?.lines[edit.anchor.index];
        const repairable = edit.kind === 'segments' && edit.reason === 'invalid-segmentation' && line;
        return {
            key: `lyric-${index}-${edit.kind}-${edit.anchor.index}`,
            message: edit.kind === 'line' ? `第 ${edit.anchor.index + 1} 行的歌词修改已失效` : `第 ${edit.anchor.index + 1} 行的手动分词已失效`,
            detail: repairable ? '改字之后分词拼不回新文字（现在先用自动分词）' : REASONS[edit.reason],
            remove: () => updateProject(project => ({
                ...project,
                lyricEdits: {
                    ...project.lyricEdits,
                    lines: edit.kind === 'line' ? project.lyricEdits.lines.filter(item => !same(item)) : project.lyricEdits.lines,
                    segments: edit.kind === 'segments' ? project.lyricEdits.segments.filter(item => !same(item)) : project.lyricEdits.segments,
                },
            })),
            ...(repairable ? {
                action: '恢复自动分词',
                extra: [
                    { label: '自动修复', run: () => repairLineSegmentation(edit.anchor, line) },
                    // 检查器的分词框里有修复后的样子，改好再应用。
                    { label: '手动修改', run: () => setSession({ selection: { type: 'line', lineIndex: edit.anchor.index } }) },
                ],
            } : {}),
        };
    });
};

export function ProblemsList({ problems }: { problems: Problem[] }) {
    if (problems.length === 0) {
        return <div className="px-4 py-3 text-xs text-zinc-500">没有问题。</div>;
    }
    return (
        <ul className="py-1 text-[13px]">
            {problems.map(problem => (
                <li key={problem.key} className="group flex items-center gap-2 px-3 py-1 hover:bg-zinc-900">
                    <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                    <span className="text-zinc-200">{problem.message}</span>
                    <span className="text-zinc-500">{problem.detail}</span>
                    <div className="flex-1" />
                    {problem.extra?.map(item => (
                        <button
                            key={item.label}
                            type="button"
                            onClick={item.run}
                            className="rounded px-1.5 text-xs text-sky-300 hover:bg-zinc-800 hover:text-sky-100"
                        >
                            {item.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={problem.remove}
                        className="invisible rounded px-1.5 text-xs text-zinc-400 group-hover:visible hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        {problem.action ?? '删除这条修改'}
                    </button>
                </li>
            ))}
        </ul>
    );
}
