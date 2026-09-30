// src/app/clipActions.ts
// 素材片段的常用操作：时间轴右键菜单、检查器、快捷键共用。
import type { AssetClip, AssetSlot, ClipTiming, ResolvedAssetClip } from '@/core/assets/clips';
import { ASSET_SLOTS } from '@/core/assets/clips';
import { getAgentState } from '@/agent/host';
import { duplicateAssetClip, removeAssetClip, updateAssetClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { locateAt } from './arrangeActions';
import { clock, seek } from './playback';
import type { ContextMenuItem } from './workbench/ContextMenu';

export const SLOT_LABELS: Record<AssetSlot, string> = {
    back: '场景之下',
    mid: '场景之上、歌词之下',
    front: '歌词之上',
    overlay: '最上层',
};

export const TIMING_LABELS: Record<ClipTiming['type'], string> = {
    song: '全曲',
    absolute: '绝对时间',
    lines: '歌词行',
    paragraph: '段落',
    shot: '镜头',
};

/** 把片段挂到播放头所在的镜头 / 段落上（不改外观）。 */
export const anchorClipAtPlayhead = (clip: AssetClip, to: 'shot' | 'paragraph') => {
    const { program } = getAgentState();
    const { paragraph, shot } = locateAt(program, clock.get());
    const timing: ClipTiming | null = to === 'shot'
        ? (shot ? { type: 'shot', anchor: shot.anchor } : null)
        : (paragraph ? { type: 'paragraph', anchor: paragraph.anchor } : null);
    if (timing) updateAssetClip(clip.id, { timing, lead: 0, tail: 0 });
};

/** 改为绝对时间（保持当前的起止时刻）。 */
export const detachClip = (clip: ResolvedAssetClip) => updateAssetClip(clip.id, { timing: { type: 'absolute', start: clip.start, end: clip.end }, lead: 0, tail: 0 });

export const clipMenu = (clip: ResolvedAssetClip): ContextMenuItem[] => [
    ...ASSET_SLOTS.map(slot => ({
        label: `层级：${SLOT_LABELS[slot]}`,
        checked: clip.slot === slot,
        run: () => updateAssetClip(clip.id, { slot }),
    })),
    'separator',
    { label: '跟随播放头所在的镜头', run: () => anchorClipAtPlayhead(clip, 'shot') },
    { label: '跟随播放头所在的段落', run: () => anchorClipAtPlayhead(clip, 'paragraph') },
    { label: '改为绝对时间', run: () => detachClip(clip), disabled: clip.timing.type === 'absolute' },
    'separator',
    { label: '跳到开头', run: () => seek(clip.start) },
    {
        label: '复制', run: () => {
            const copy = duplicateAssetClip(clip.id);
            if (copy) setSession({ selection: { type: 'clip', clipId: copy.id } });
        },
    },
    { label: '删除', keybinding: 'Delete', run: () => { removeAssetClip(clip.id); setSession({ selection: { type: 'none' } }); } },
];
