// src/app/wizard/StepStyle.tsx
// 向导第 2 步：风格与画幅。一个包画全曲，或者按段落混用（副歌、间奏给大构图，主歌给排字）；
// 配了 AI 的话可以让它按歌词给每一段挑。缩略图停留时播放这个包的镜头动画。
import { useState } from 'react';
import { Check, Shuffle, Sparkles } from 'lucide-react';
import { generateSceneDirection } from '@/ai/actions';
import { resolveAiProvider, useAiSettings } from '@/ai/settings';
import type { PackId } from '@/compiler/types';
import { listPacks } from '@/packs/registry';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import type { OutputAspect } from '@/project/types';
import { useProgram } from '../DerivedProvider';
import { StyleThumb, useThumbnailLook } from '../library/StyleThumb';
import { log } from '../output';
import { Button, cx } from '../ui';

const ASPECTS: Array<{ value: OutputAspect; label: string; hint: string; box: string }> = [
    { value: '16:9', label: '横屏 16:9', hint: 'B 站 / YouTube', box: 'h-4 w-7' },
    { value: '9:16', label: '竖屏 9:16', hint: '抖音 / 小红书', box: 'h-7 w-4' },
    { value: '1:1', label: '方形 1:1', hint: '动态封面', box: 'h-5 w-5' },
    { value: '4:3', label: '4:3', hint: '复古屏幕', box: 'h-5 w-6' },
];

/** 描述里的第一句（卡片上放不下整段）。 */
const firstSentence = (text: string) => text.split(/[。；]/)[0] + '。';

export function StepStyle() {
    const direction = useProjectStore(state => state.project.direction);
    const aspect = useProjectStore(state => state.project.aspect);
    const aiDirected = useProjectStore(state => state.project.paragraphDirections.some(item => item.source === 'ai'));
    const program = useProgram();
    const analysis = useSession(state => state.analysis);
    const aiAvailable = useAiSettings(state => resolveAiProvider(state) !== null);
    const look = useThumbnailLook();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const packs = listPacks();

    const pickPack = (pack: PackId) => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'single', pack } }));
    const pickMix = () => updateProject(p => ({ ...p, direction: { ...p.direction, mode: 'mix' } }));
    const aiDirect = async () => {
        setBusy(true);
        setError(null);
        try {
            pickMix();
            const result = await generateSceneDirection(program, useProjectStore.getState().project, analysis);
            log(`AI 按歌词编排了 ${result.paragraphs.length} 段`);
        } catch (reason) {
            setError((reason as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">视觉风格</div>
                <div className="grid grid-cols-2 gap-2">
                    {packs.map(pack => {
                        const selected = direction.mode === 'single' && direction.pack === pack.id;
                        return (
                            <button
                                key={pack.id}
                                type="button"
                                aria-pressed={selected}
                                aria-label={`风格：${pack.label}`}
                                onClick={() => pickPack(pack.id)}
                                className={cx('group overflow-hidden rounded-lg border text-left transition-colors', selected ? 'border-amber-400 bg-zinc-800/70' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600')}
                            >
                                {pack.styles[0] && <StyleThumb style={pack.styles[0].id} look={look} />}
                                <div className="space-y-0.5 p-2">
                                    <div className="flex items-center gap-1.5 text-sm text-zinc-100">
                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: pack.color }} />
                                        {pack.shortLabel}
                                        {selected && <Check size={13} className="ml-auto text-amber-400" />}
                                    </div>
                                    <div className="line-clamp-3 text-[11px] leading-snug text-zinc-500">{firstSentence(pack.description)}</div>
                                </div>
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        aria-pressed={direction.mode === 'mix'}
                        aria-label="风格：按段落混用"
                        onClick={pickMix}
                        className={cx('flex flex-col overflow-hidden rounded-lg border text-left transition-colors', direction.mode === 'mix' ? 'border-amber-400 bg-zinc-800/70' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600')}
                    >
                        <div className="flex aspect-video w-full items-center justify-center gap-1.5 bg-zinc-950">
                            {packs.map(pack => <span key={pack.id} className="h-8 w-3 rounded-sm" style={{ backgroundColor: pack.color, opacity: 0.8 }} />)}
                            <Shuffle size={16} className="ml-1 text-zinc-500" />
                        </div>
                        <div className="space-y-0.5 p-2">
                            <div className="flex items-center gap-1.5 text-sm text-zinc-100">
                                按段落混用
                                {direction.mode === 'mix' && <Check size={13} className="ml-auto text-amber-400" />}
                            </div>
                            <div className="text-[11px] leading-snug text-zinc-500">副歌、间奏用大构图，主歌用排字，段落之间换风格。</div>
                        </div>
                    </button>
                </div>
                {aiAvailable && (
                    <div className="flex items-center gap-2 rounded-md border border-zinc-800 p-2">
                        <Sparkles size={14} className="shrink-0 text-amber-400" />
                        <div className="min-w-0 flex-1 text-[11px] text-zinc-400">
                            {aiDirected ? '已按 AI 的编排给每段挑了风格。' : '让 AI 读歌词，给每一段挑风格与转场。'}
                        </div>
                        <Button size="sm" disabled={busy || program.lines.length === 0} onClick={() => void aiDirect()}>
                            {busy ? '编排中…' : aiDirected ? '重新编排' : 'AI 编排'}
                        </Button>
                    </div>
                )}
                {error && <div className="text-xs text-red-400">{error}</div>}
            </div>

            <div className="space-y-2">
                <div className="text-xs font-medium text-zinc-400">画幅</div>
                <div className="grid grid-cols-4 gap-2">
                    {ASPECTS.map(item => (
                        <button
                            key={item.value}
                            type="button"
                            aria-pressed={aspect === item.value}
                            onClick={() => updateProject(p => ({ ...p, aspect: item.value }))}
                            className={cx('flex flex-col items-center gap-1.5 rounded-lg border px-1 py-2.5 transition-colors', aspect === item.value ? 'border-amber-400 bg-zinc-800/70' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600')}
                        >
                            <span className="flex h-7 items-center"><span className={cx('rounded-sm border-2', item.box, aspect === item.value ? 'border-amber-400' : 'border-zinc-500')} /></span>
                            <span className="text-xs text-zinc-100">{item.label}</span>
                            <span className="text-[10px] text-zinc-500">{item.hint}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
