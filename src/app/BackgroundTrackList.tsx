// src/app/BackgroundTrackList.tsx
// 「画面与编排 › 背景与后处理」里的背景轨：列出片段（点一下选中，在检查器里编辑），添加新片段。
import { Plus } from 'lucide-react';
import { useProjectStore } from '@/project/store';
import { useSession } from '@/project/session';
import { setSession } from '@/project/session';
import { addBackgroundAt, describeBackground } from './backgroundActions';
import { Button, cx } from './ui';

export function BackgroundTrackList() {
    const clips = useProjectStore(state => state.project.backgroundClips);
    const selection = useSession(state => state.selection);
    return (
        <div className="space-y-1.5">
            <div className="text-xs text-zinc-400">背景轨</div>
            {clips.length === 0 && <div className="text-[11px] text-zinc-500">还没有背景片段：整首歌都用上面的默认背景。可以按段落换成渐变、图片或视频。</div>}
            {[...clips].reverse().map(clip => (
                <button
                    key={clip.id}
                    type="button"
                    onClick={() => setSession({ selection: { type: 'background', clipId: clip.id } })}
                    className={cx(
                        'block w-full truncate rounded border px-2 py-1 text-left text-xs',
                        selection.type === 'background' && selection.clipId === clip.id ? 'border-violet-300 bg-violet-500/20 text-violet-50' : 'border-zinc-800 text-zinc-300 hover:border-zinc-600',
                    )}
                >
                    {describeBackground(clip)}
                </button>
            ))}
            <div className="flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => addBackgroundAt({ type: 'gradient', from: '#1e1b4b', to: '#0f766e', angle: 20 }, 'paragraph')}>
                    <Plus size={12} /> 当前段落换背景
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addBackgroundAt({ type: 'gradient', from: '#1e1b4b', to: '#0f766e', angle: 20 }, 'song')}>
                    全曲
                </Button>
            </div>
            <div className="text-[11px] text-zinc-500">图片、视频先放进「素材库」，也可以在素材库的卡片上右键「设为背景」。</div>
        </div>
    );
}
