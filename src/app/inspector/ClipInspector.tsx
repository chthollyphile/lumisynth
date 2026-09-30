// src/app/inspector/ClipInspector.tsx
// 检查器：选中的素材片段。时间（跟随镜头 / 段落 / 歌词行，或绝对时间）、层级、位置与大小、混合、跟随运镜、入场 / 退场。
// 预览上也可以直接拖动与缩放（见 Preview 的 ClipHandles）。
import { useMemo } from 'react';
import { ASSET_SLOTS, CLIP_ANIMATIONS, CLIP_EFFECTS, CLIP_MOTIONS, FOLLOW_MODES, normalizeClipEffect, normalizeClipMotion, resolveAssetClips, type AssetBlend, type AssetClip, type AssetSlot, type ClipAnimationType, type ClipEffect, type ClipEffectType, type ClipMotionType, type FollowMode } from '@/core/assets/clips';
import { removeAssetClip, updateAssetClip } from '@/project/assets';
import { setSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { anchorClipAtPlayhead, detachClip, SLOT_LABELS, TIMING_LABELS } from '../clipActions';
import { useProgram } from '../DerivedProvider';
import { AssetThumb } from '../views/LibraryView';
import { seek } from '../playback';
import { formatTime } from '../Transport';
import { Button, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

const ANIMATION_LABELS: Record<ClipAnimationType, string> = {
    none: '无', fade: '淡入淡出', 'slide-up': '从下方', 'slide-down': '从上方', 'slide-left': '从右侧', 'slide-right': '从左侧', zoom: '缩放',
    'rush-left': '从右侧冲入', 'rush-right': '从左侧冲入', pop: '弹出',
};

const BLEND_LABELS: Record<AssetBlend, string> = { normal: '正常', add: '相加', multiply: '正片叠底', screen: '滤色' };

export const MOTION_LABELS: Record<ClipMotionType, string> = { none: '不动', float: '漂浮', drift: '横移', push: '推近', sway: '摇摆' };

const MOTION_HINTS: Record<ClipMotionType, string> = {
    none: '',
    float: '沿一段弧线上下往返，两端自然停顿。',
    drift: '整段时间沿平缓的 S 形曲线往画面中间滑过去，起停都放缓。',
    push: '缓慢放大、微微上移，像镜头往前推。',
    sway: '带一点旋转的来回摆动。',
};

export const EFFECT_LABELS: Record<ClipEffectType, string> = { none: '无', echo: '重影扩张', glow: '外发光', shadow: '投影剪影' };

const EFFECT_HINTS: Record<ClipEffectType, string> = {
    none: '',
    echo: '和图片同形状的剪影一圈圈向外扩张、淡出，循环（ADV 立绘 PV 常见的效果）。',
    glow: '图片轮廓外的一圈柔光。',
    shadow: '同形状的纯色剪影偏在右下，像贴纸的投影。',
};

const EFFECT_SIZE_LABELS: Record<ClipEffectType, string> = { none: '', echo: '扩张幅度', glow: '光晕半径', shadow: '偏移' };

export const FOLLOW_LABELS: Record<FollowMode, string> = { off: '不跟随', scene: '贴在场景上', motion: '只跟随运动' };

const FOLLOW_HINTS: Record<FollowMode, string> = {
    off: '固定在画面上，不随镜头移动。',
    scene: '和场景里的东西一样随镜头推拉、平移、旋转；切镜头时跟着跳。位置、大小是没有运镜时的值。',
    motion: '只跟随镜头内的推拉、漂移、呼吸，每个镜头从原位重新开始，不会跳。',
};

export function ClipInspector({ clipId }: { clipId: string }) {
    const clip = useProjectStore(state => state.project.assetClips.find(item => item.id === clipId));
    const assets = useProjectStore(state => state.project.assets);
    const program = useProgram();
    const resolved = useMemo(() => (clip ? resolveAssetClips([clip], program, new Set(assets.map(item => item.id))) : null), [clip, program, assets]);
    if (!clip) {
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                这个素材片段已经删除了。
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>取消选择</Button>
            </div>
        );
    }
    const asset = assets.find(item => item.id === clip.assetId);
    const range = resolved?.resolved[0];
    const patch = (value: Partial<AssetClip>, key?: string) => updateAssetClip(clip.id, value, key);

    return (
        <>
            <Section title="素材片段">
                <div className="flex gap-2">
                    <AssetThumb assetId={clip.assetId} className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-zinc-950" />
                    <div className="min-w-0 text-xs">
                        <div className="truncate text-zinc-200">{asset?.name ?? '（素材库里已没有这个素材）'}</div>
                        <div className="text-zinc-500">{range ? `${formatTime(range.start)} – ${formatTime(range.end)}` : '没有显示：挂载点已不存在'}</div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {range && <Button size="sm" onClick={() => seek(range.start + 0.01)}>跳到开头</Button>}
                    <Button size="sm" variant="danger" onClick={() => { removeAssetClip(clip.id); setSession({ selection: { type: 'none' } }); }}>删除</Button>
                </div>
            </Section>
            <Section title="时间">
                <div className="text-xs text-zinc-300">跟随：{TIMING_LABELS[clip.timing.type]}</div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => anchorClipAtPlayhead(clip, 'shot')}>跟随播放头所在的镜头</Button>
                    <Button size="sm" onClick={() => anchorClipAtPlayhead(clip, 'paragraph')}>跟随所在段落</Button>
                    {clip.timing.type !== 'absolute' && range && <Button size="sm" variant="ghost" onClick={() => detachClip(range)}>改为绝对时间</Button>}
                </div>
                {clip.timing.type === 'absolute' ? (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="开始（秒）">
                            <input type="number" step={0.01} min={0} value={clip.timing.start} className={`${inputClass} select-text`}
                                onChange={event => { const start = Number(event.target.value); if (Number.isFinite(start) && clip.timing.type === 'absolute') patch({ timing: { ...clip.timing, start } }, 'start'); }} />
                        </Field>
                        <Field label="结束（秒）">
                            <input type="number" step={0.01} min={0} value={clip.timing.end} className={`${inputClass} select-text`}
                                onChange={event => { const end = Number(event.target.value); if (Number.isFinite(end) && clip.timing.type === 'absolute') patch({ timing: { ...clip.timing, end } }, 'end'); }} />
                        </Field>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="提前出现（秒）">
                            <Slider value={clip.lead} min={-2} max={4} step={0.05} onChange={lead => patch({ lead }, 'lead')} format={v => v.toFixed(2)} />
                        </Field>
                        <Field label="延后消失（秒）">
                            <Slider value={clip.tail} min={-2} max={4} step={0.05} onChange={tail => patch({ tail }, 'tail')} format={v => v.toFixed(2)} />
                        </Field>
                    </div>
                )}
            </Section>
            <Section title="画面">
                <Field label="层级" hint={clip.slot === 'back' ? '凝彩的大色块、封面背景等不透明的场景会把它盖住。' : clip.slot === 'mid' ? '盖在场景的图形上、被歌词盖住（凝彩的歌词反色会读到它）；镜头之间和段落转场的那一瞬间会先放到场景之上，不会闪。' : undefined}>
                    <Segmented<AssetSlot>
                        value={clip.slot}
                        onChange={slot => patch({ slot })}
                        options={ASSET_SLOTS.map(slot => ({ value: slot, label: SLOT_LABELS[slot] }))}
                    />
                </Field>
                <Field label="位置（也可以在预览上拖动）">
                    <Slider value={clip.x} min={-0.2} max={1.2} step={0.005} onChange={x => patch({ x }, 'x')} format={v => `X ${Math.round(v * 100)}%`} />
                    <Slider value={clip.y} min={-0.2} max={1.2} step={0.005} onChange={y => patch({ y }, 'y')} format={v => `Y ${Math.round(v * 100)}%`} />
                </Field>
                <Field label="大小（高度占画面）">
                    <Slider value={clip.scale} min={0.05} max={2} step={0.01} onChange={scale => patch({ scale }, 'scale')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
                <Field label="旋转">
                    <Slider value={clip.rotation} min={-Math.PI} max={Math.PI} step={0.01} onChange={rotation => patch({ rotation }, 'rotation')} format={v => `${Math.round((v * 180) / Math.PI)}°`} />
                </Field>
                <Field label="不透明度">
                    <Slider value={clip.opacity} min={0} max={1} step={0.01} onChange={opacity => patch({ opacity }, 'opacity')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
                <Toggle label="水平翻转" checked={clip.flipX} onChange={flipX => patch({ flipX })} />
                <Field label="混合">
                    <select value={clip.blend} onChange={event => patch({ blend: event.target.value as AssetBlend })} className={inputClass}>
                        {(Object.keys(BLEND_LABELS) as AssetBlend[]).map(blend => <option key={blend} value={blend}>{BLEND_LABELS[blend]}</option>)}
                    </select>
                </Field>
            </Section>
            <EffectSection clip={clip} patch={patch} />
            <Section title="跟随运镜">
                <Field
                    label="方式"
                    hint={FOLLOW_HINTS[clip.follow ?? 'off']}
                >
                    <Segmented<FollowMode>
                        value={clip.follow ?? 'off'}
                        onChange={follow => patch({ follow })}
                        options={FOLLOW_MODES.map(mode => ({ value: mode, label: FOLLOW_LABELS[mode] }))}
                    />
                </Field>
                {(clip.follow ?? 'off') !== 'off' && (
                    <Field label="跟随程度" hint="1 表示和歌词一起动；小一些像是离得更远的背景。">
                        <Slider value={clip.followAmount ?? 1} min={0} max={1} step={0.05} onChange={followAmount => patch({ followAmount }, 'follow-amount')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                )}
            </Section>
            <Section title="动画">
                <MotionFields clip={clip} patch={patch} />
                {(['enter', 'exit'] as const).map(key => (
                    <Field key={key} label={key === 'enter' ? '入场' : '退场'}>
                        <div className="grid grid-cols-[1fr_5rem] gap-2">
                            <select value={clip[key].type} onChange={event => patch({ [key]: { ...clip[key], type: event.target.value as ClipAnimationType } })} className={inputClass}>
                                {CLIP_ANIMATIONS.map(type => <option key={type} value={type}>{ANIMATION_LABELS[type]}</option>)}
                            </select>
                            <input type="number" step={0.05} min={0} max={5} value={clip[key].duration} aria-label={`${key === 'enter' ? '入场' : '退场'}时长`} className={`${inputClass} select-text`}
                                onChange={event => { const duration = Number(event.target.value); if (Number.isFinite(duration)) patch({ [key]: { ...clip[key], duration: Math.max(0, duration) } }, `${key}-duration`); }} />
                        </div>
                    </Field>
                ))}
            </Section>
        </>
    );
}

function EffectSection({ clip, patch }: { clip: AssetClip; patch: (value: Partial<AssetClip>, key?: string) => void }) {
    const effect = normalizeClipEffect(clip.effect);
    const set = (value: Partial<ClipEffect>, key?: string) => patch({ effect: { ...effect, ...value } }, key ? `effect-${key}` : undefined);
    return (
        <Section title="效果">
            <Field label="类型" hint={EFFECT_HINTS[effect.type] || undefined}>
                <Segmented<ClipEffectType>
                    value={effect.type}
                    onChange={type => set({ type })}
                    options={CLIP_EFFECTS.map(type => ({ value: type, label: EFFECT_LABELS[type] }))}
                />
            </Field>
            {effect.type !== 'none' && (
                <>
                    <Field label="颜色">
                        <input type="color" aria-label="效果颜色" value={effect.color} onChange={event => set({ color: event.target.value }, 'color')} className="h-8 w-full rounded border border-zinc-700 bg-transparent" />
                    </Field>
                    <Field label={EFFECT_SIZE_LABELS[effect.type]}>
                        <Slider value={effect.size} min={0} max={1} step={0.01} onChange={size => set({ size }, 'size')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                    <Field label="强度">
                        <Slider value={effect.opacity} min={0} max={1} step={0.01} onChange={opacity => set({ opacity }, 'opacity')} format={v => `${Math.round(v * 100)}%`} />
                    </Field>
                    {effect.type === 'echo' && (
                        <Field label="节奏（一轮的秒数）">
                            <Slider value={effect.period} min={0.3} max={4} step={0.05} onChange={period => set({ period }, 'period')} format={v => `${v.toFixed(2)}s`} />
                        </Field>
                    )}
                </>
            )}
        </Section>
    );
}

function MotionFields({ clip, patch }: { clip: AssetClip; patch: (value: Partial<AssetClip>, key?: string) => void }) {
    const motion = normalizeClipMotion(clip.motion);
    return (
        <>
            <Field label="持续运动" hint={MOTION_HINTS[motion.type] || '显示期间一直在动的路径动画（带缓动的贝塞尔曲线）。镜头不怎么动的场景（比如绘光）里很有用。'}>
                <Segmented<ClipMotionType>
                    value={motion.type}
                    onChange={type => patch({ motion: { ...motion, type } })}
                    options={CLIP_MOTIONS.map(type => ({ value: type, label: MOTION_LABELS[type] }))}
                />
            </Field>
            {motion.type !== 'none' && (
                <Field label="幅度">
                    <Slider value={motion.amount} min={0} max={1} step={0.01} onChange={amount => patch({ motion: { ...motion, amount } }, 'motion-amount')} format={v => `${Math.round(v * 100)}%`} />
                </Field>
            )}
        </>
    );
}
