// src/app/backgroundActions.ts
// 背景轨的常用操作与文字：时间轴、检查器、素材库、「画面与编排」共用。
import type { BackgroundClip, BackgroundSource, ResolvedBackgroundClip } from '@/core/assets/background';
import type { ClipTiming } from '@/core/assets/clips';
import { getAgentState } from '@/agent/host';
import { addBackgroundClip, moveBackgroundClip, removeBackgroundClip, updateBackgroundClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { locateAt } from './arrangeActions';
import { TIMING_LABELS } from './clipActions';
import { clock, seek } from './playback';
import type { ContextMenuItem } from './workbench/ContextMenu';

export const SOURCE_LABELS: Record<BackgroundSource['type'], string> = {
    theme: '主题色',
    gradient: '渐变',
    cover: '封面',
    image: '图片',
    video: '视频',
};

export const describeBackground = (clip: BackgroundClip) => {
    const assets = useProjectStore.getState().project.assets;
    const source = clip.source;
    const name = source.type === 'image' || source.type === 'video'
        ? assets.find(item => item.id === source.assetId)?.name ?? '（素材已删除）'
        : SOURCE_LABELS[source.type];
    return `${name}${source.type === 'image' || source.type === 'video' ? `（${SOURCE_LABELS[source.type]}）` : ''} · ${TIMING_LABELS[clip.timing.type]}`;
};

/** 播放头所在段落的挂载（没有段落时全曲）。 */
export const playheadParagraphTiming = (): ClipTiming => {
    const { paragraph } = locateAt(getAgentState().program, clock.get());
    return paragraph ? { type: 'paragraph', anchor: paragraph.anchor } : { type: 'song' };
};

export const addBackgroundAt = (source: BackgroundSource, scope: 'song' | 'paragraph') => {
    const clip = addBackgroundClip(source, scope === 'song' ? { type: 'song' } : playheadParagraphTiming());
    setSession({ selection: { type: 'background', clipId: clip.id } });
    return clip;
};

export const backgroundMenu = (clip: ResolvedBackgroundClip): ContextMenuItem[] => [
    { label: '全曲', checked: clip.timing.type === 'song', run: () => updateBackgroundClip(clip.id, { timing: { type: 'song' } }) },
    { label: '跟随播放头所在的段落', run: () => updateBackgroundClip(clip.id, { timing: playheadParagraphTiming() }) },
    { label: '改为绝对时间', disabled: clip.timing.type === 'absolute' || clip.timing.type === 'song', run: () => updateBackgroundClip(clip.id, { timing: { type: 'absolute', start: clip.start, end: clip.end } }) },
    'separator',
    { label: '上移一层（盖住后面的）', run: () => moveBackgroundClip(clip.id, 1) },
    { label: '下移一层', run: () => moveBackgroundClip(clip.id, -1) },
    'separator',
    { label: '跳到开头', run: () => seek(clip.start) },
    { label: '删除', run: () => { removeBackgroundClip(clip.id); setSession({ selection: { type: 'none' } }); } },
];
