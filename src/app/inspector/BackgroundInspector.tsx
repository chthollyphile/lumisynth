// src/app/inspector/BackgroundInspector.tsx
// 检查器：选中的背景片段。来源（主题色 / 渐变 / 封面 / 素材库图片或视频）、时间、铺满方式、推近、模糊、压暗、淡入淡出。
import { useMemo } from 'react';
import { resolveBackgroundClips, type BackgroundClip, type BackgroundSource } from '@/core/assets/background';
import { moveBackgroundClip, removeBackgroundClip, updateBackgroundClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { playheadParagraphTiming, SOURCE_LABELS } from '../backgroundActions';
import { TIMING_LABELS } from '../clipActions';
import { useProgram } from '../DerivedProvider';
import { seek } from '../playback';
import { formatTime } from '../Transport';
import { Button, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

export function BackgroundInspector({ clipId }: { clipId: string }) {
    const clip = useProjectStore(state => state.project.backgroundClips.find(item => item.id === clipId));
    const assets = useProjectStore(state => state.project.assets);
    const program = useProgram();
    const resolved = useMemo(() => (clip ? resolveBackgroundClips([clip], program, new Set(assets.map(item => item.id))).resolved[0] ?? null : null), [clip, program, assets]);
    if (!clip) {
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                这个背景片段已经删除了。
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>取消选择</Button>
            </div>
        );
    }
    const patch = (value: Partial<BackgroundClip>, key?: string) => updateBackgroundClip(clip.id, value, key);
    const source = clip.source;
    const images = assets.filter(item => item.kind === 'image');
    const videos = assets.filter(item => item.kind === 'video');

    const setSourceType = (type: BackgroundSource['type']) => {
        if (type === source.type) return;
        if (type === 'theme' || type === 'cover') patch({ source: { type } });
        else if (type === 'gradient') patch({ source: { type, from: '#1e1b4b', to: '#0f766e', angle: 20 } });
        else if (type === 'image' && images[0]) patch({ source: { type, assetId: images[0].id } });
        else if (type === 'video' && videos[0]) patch({ source: { type, assetId: videos[0].id, offset: 0, loop: true } });
    };

    return (
        <>
            <Section title="背景片段">
                <div className="text-xs text-zinc-400">
                    {resolved ? `${formatTime(resolved.start)} – ${resolved.timing.type === 'song' ? '全曲' : formatTime(resolved.end)}` : '没有显示：挂载点或素材已不存在'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {resolved && <Button size="sm" onClick={() => seek(resolved.start + 0.01)}>跳到开头</Button>}
                    <Button size="sm" onClick={() => moveBackgroundClip(clip.id, 1)}>上移一层</Button>
                    <Button size="sm" onClick={() => moveBackgroundClip(clip.id, -1)}>下移一层</Button>
                    <Button size="sm" variant="danger" onClick={() => { removeBackgroundClip(clip.id); setSession({ selection: { type: 'none' } }); }}>删除</Button>
                </div>
                <div className="text-[11px] text-zinc-500">片段叠在「默认背景」之上，片段之间的空档露出默认背景；后面的片段盖住前面的。</div>
            </Section>
            <Section title="来源">
                <select aria-label="背景来源" value={source.type} onChange={event => setSourceType(event.target.value as BackgroundSource['type'])} className={inputClass}>
                    {(Object.keys(SOURCE_LABELS) as BackgroundSource['type'][]).map(type => (
                        <option key={type} value={type} disabled={(type === 'image' && images.length === 0) || (type === 'video' && videos.length === 0)}>
                            {SOURCE_LABELS[type]}{type === 'image' && images.length === 0 ? '（素材库里没有图片）' : ''}{type === 'video' && videos.length === 0 ? '（素材库里没有视频）' : ''}
                        </option>
                    ))}
                </select>
                {source.type === 'gradient' && (
                    <>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="color" aria-label="渐变起点" value={source.from} onChange={event => patch({ source: { ...source, from: event.target.value } }, 'from')} className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-transparent" />
                            <input type="color" aria-label="渐变终点" value={source.to} onChange={event => patch({ source: { ...source, to: event.target.value } }, 'to')} className="h-8 w-full cursor-pointer rounded border border-zinc-700 bg-transparent" />
                        </div>
                        <Slider value={source.angle} min={0} max={360} step={1} onChange={angle => patch({ source: { ...source, angle } }, 'angle')} format={v => `${v}°`} />
                    </>
                )}
                {(source.type === 'image' || source.type === 'video') && (
                    <select aria-label="素材" value={source.assetId} onChange={event => patch({ source: { ...source, assetId: event.target.value } })} className={inputClass}>
                        {(source.type === 'image' ? images : videos).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                )}
                {source.type === 'video' && (
                    <>
                        <Field label="从视频的第几秒开始">
                            <input type="number" min={0} step={0.1} value={source.offset} className={`${inputClass} select-text`}
                                onChange={event => { const offset = Number(event.target.value); if (Number.isFinite(offset)) patch({ source: { ...source, offset: Math.max(0, offset) } }, 'offset'); }} />
                        </Field>
                        <Toggle label="循环播放" checked={source.loop} onChange={loop => patch({ source: { ...source, loop } })} />
                        <div className="text-[11px] text-zinc-500">视频的声音不会进成片。导出时逐帧解码，画面与时间严格对应。</div>
                    </>
                )}
            </Section>
            <Section title="时间">
                <div className="text-xs text-zinc-300">跟随：{TIMING_LABELS[clip.timing.type]}</div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => patch({ timing: { type: 'song' } })}>全曲</Button>
                    <Button size="sm" onClick={() => patch({ timing: playheadParagraphTiming() })}>跟随播放头所在的段落</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <Field label="淡入（秒）"><Slider value={clip.fadeIn} min={0} max={4} step={0.05} onChange={fadeIn => patch({ fadeIn }, 'fadeIn')} format={v => v.toFixed(2)} /></Field>
                    <Field label="淡出（秒）"><Slider value={clip.fadeOut} min={0} max={4} step={0.05} onChange={fadeOut => patch({ fadeOut }, 'fadeOut')} format={v => v.toFixed(2)} /></Field>
                </div>
            </Section>
            {source.type !== 'theme' && (
                <Section title="画面">
                    {source.type !== 'gradient' && (
                        <Field label="铺满方式">
                            <Segmented<BackgroundClip['fit']> value={clip.fit} onChange={fit => patch({ fit })} options={[{ value: 'cover', label: '铺满（裁切）' }, { value: 'contain', label: '完整显示' }]} />
                        </Field>
                    )}
                    <Field label="缓慢推近"><Slider value={clip.kenBurns} min={0} max={0.3} step={0.01} onChange={kenBurns => patch({ kenBurns }, 'kenBurns')} format={v => `${Math.round(v * 100)}%`} /></Field>
                    <Field label="模糊"><Slider value={clip.blur} min={0} max={40} step={1} onChange={blur => patch({ blur }, 'blur')} format={v => `${v}px`} /></Field>
                    <Field label="压暗"><Slider value={clip.dim} min={0} max={1} step={0.01} onChange={dim => patch({ dim }, 'dim')} format={v => `${Math.round(v * 100)}%`} /></Field>
                </Section>
            )}
        </>
    );
}
