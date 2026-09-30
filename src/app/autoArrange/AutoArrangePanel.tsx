// src/app/autoArrange/AutoArrangePanel.tsx
// 自动编排的选项与按钮（素材库与向导共用）：层级、跟随运镜、效果、构图变化、放在哪些段落。
import { LayoutTemplate, Trash2 } from 'lucide-react';
import { ASSET_SLOTS, CLIP_EFFECTS, CLIP_MOTIONS, FOLLOW_MODES, type AssetSlot, type ClipEffectType, type ClipMotionType, type FollowMode } from '@/core/assets/clips';
import type { ArrangeCoverage } from '@/core/assets/autoArrange';
import { SLOT_LABELS } from '../clipActions';
import { EFFECT_LABELS, FOLLOW_LABELS, MOTION_LABELS } from '../inspector/ClipInspector';
import { Button, Field, inputClass, Segmented, Slider } from '../ui';
import { autoArrangeAssets, clearAutoArrangement, setArrangeOptions, useArrangeOptions, useAutoClipCount } from './autoArrangeActions';

export function ArrangeOptionsFields() {
    const options = useArrangeOptions();
    return (
        <>
            <Field label="放在哪些镜头">
                <Segmented<ArrangeCoverage>
                    value={options.coverage}
                    onChange={coverage => setArrangeOptions({ coverage })}
                    options={[{ value: 'all', label: '每个镜头' }, { value: 'highlights', label: '副歌、上扬与间奏' }]}
                />
            </Field>
            <Field label="放图的概率" hint="每个镜头放图的机会；同一份编排重新编排结果不变，调低只会去掉一些。">
                <Slider value={options.probability} min={0} max={1} step={0.05} onChange={probability => setArrangeOptions({ probability })} format={v => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label="构图变化" hint="0 = 固定位置；越高越常换远近、偏移与倾斜不同的构图。按镜头抽签，重新编排结果不变。">
                <Slider value={options.variety} min={0} max={1} step={0.05} onChange={variety => setArrangeOptions({ variety })} format={v => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label="层级">
                <select aria-label="自动编排的层级" value={options.slot} onChange={event => setArrangeOptions({ slot: event.target.value as AssetSlot })} className={inputClass}>
                    {ASSET_SLOTS.map(slot => <option key={slot} value={slot}>{SLOT_LABELS[slot]}</option>)}
                </select>
            </Field>
            <Field label="跟随运镜">
                <Segmented<FollowMode>
                    value={options.follow}
                    onChange={follow => setArrangeOptions({ follow })}
                    options={FOLLOW_MODES.map(mode => ({ value: mode, label: FOLLOW_LABELS[mode] }))}
                />
            </Field>
            <Field label="持续运动" hint="带缓动的路径动画；镜头不怎么动的场景（比如绘光）里图不会完全静止。">
                <Segmented<ClipMotionType>
                    value={options.motion}
                    onChange={motion => setArrangeOptions({ motion })}
                    options={CLIP_MOTIONS.map(type => ({ value: type, label: MOTION_LABELS[type] }))}
                />
            </Field>
            <Field label="效果">
                <div className="flex gap-2">
                    <select aria-label="自动编排的效果" value={options.effect} onChange={event => setArrangeOptions({ effect: event.target.value as ClipEffectType })} className={inputClass}>
                        {CLIP_EFFECTS.map(type => <option key={type} value={type}>{EFFECT_LABELS[type]}</option>)}
                    </select>
                    {options.effect !== 'none' && (
                        <input type="color" aria-label="效果颜色" value={options.effectColor} onChange={event => setArrangeOptions({ effectColor: event.target.value })} className="h-8 w-10 shrink-0 rounded border border-zinc-700 bg-transparent" />
                    )}
                </div>
            </Field>
        </>
    );
}

/** assetIds：只用这些图（例如素材库里选中的）；null = 素材库里的全部图片。 */
export function AutoArrangePanel({ assetIds, imageCount }: { assetIds: string[] | null; imageCount: number }) {
    const autoCount = useAutoClipCount();
    return (
        <div className="space-y-2.5">
            <ArrangeOptionsFields />
            <div className="flex gap-1.5">
                <Button variant="primary" className="flex-1" disabled={imageCount === 0} onClick={() => autoArrangeAssets(assetIds)}>
                    <LayoutTemplate size={14} /> {autoCount > 0 ? '重新编排' : '自动编排'}（{assetIds ? `选中的 ${imageCount} 张` : `全部 ${imageCount} 张`}）
                </Button>
                {autoCount > 0 && (
                    <Button variant="ghost" onClick={clearAutoArrangement} title={`删掉自动编排的 ${autoCount} 个片段（自己摆的不动）`}>
                        <Trash2 size={14} />
                    </Button>
                )}
            </div>
            <div className="text-[11px] leading-relaxed text-zinc-500">
                以镜头为单位轮流放图，切镜头时图跟着换：立绘大体左右交替、从所在的一侧滑入，横图多放中间；构图按变化度在远近、偏移、倾斜之间变换。{autoCount > 0 ? `现在有 ${autoCount} 个自动编排的片段；重新编排只替换它们，自己摆的不动。` : '放好之后每个片段都可以单独调整。'}
            </div>
        </div>
    );
}
