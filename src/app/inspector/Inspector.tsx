// src/app/inspector/Inspector.tsx
// 辅助栏「检查器」：按选中对象（段落 / shot / 歌词行）编辑；未选中时显示编排总设置。
import { BackgroundInspector } from './BackgroundInspector';
import { ClipInspector } from './ClipInspector';
import { mergeWithPrevious, resetParagraphStructure } from '@/project/structure';
import { pickParagraphKind } from '../arrangeActions';
import { log } from '../output';
import { StylePickerGrid } from './StylePickerGrid';
import { useMemo, useState, type ReactNode } from 'react';
import { Heart, Lock, Ban, Unlock } from 'lucide-react';
import { borrowableTypographies, familyLabel, findPack, getStyle, getTransition, listPacks } from '@/packs/registry';
import { DEFAULT_MIX_BY_KIND, mixAssignment, mixOverrides, PARAGRAPH_KINDS, type LumiParagraph, type LumiShot, type PackId, type StyleId, type TransitionId } from '@/compiler/types';
import { anchorOfLine } from '@/core/lyrics/edits';
import { isValidWordSegmentation, segmentLyricWords } from '@/core/lyrics/wordSegmentation';
import {
    setShotComponent,
    lockCurrentStyle,
    lockShotStyle,
    setParagraphDirection,
    setParagraphTransition,
    toggleBlocked,
    toggleFavorite,
    unlockShotStyle,
} from '@/project/edits';
import { repairLineSegmentation, resetLineText, resetLineTiming, segmentationRepairFor, setLineBounds, setLineSegments } from '@/project/lyrics';
import { setSession, useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { seek } from '../playback';
import { packLabel, packShortLabel } from '../StylePanel';
import { formatTime } from '../Transport';
import { Button, cx, Field, inputClass, Section, Segmented, Slider, Toggle } from '../ui';

const KIND_LABELS: Record<string, string> = {
    breath: '换气', verse: '主歌', lift: '上扬', chorus: '副歌', break: '间奏', outro: '尾声',
};
const BOUNDARY_LABELS: Record<string, string> = {
    'song-start': '曲首', 'time-gap': '时间空隙', 'lyric-gap': '歌词停顿', metadata: '段落标记', 'duration-cap': '时长上限', 'line-cap': '行数上限', manual: '手动分段',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-500">{label}</span>
            <span className="truncate text-right text-zinc-200">{children}</span>
        </div>
    );
}

function StyleActions({ style }: { style: StyleId }) {
    const favorite = useProjectStore(state => state.project.library.favorites.includes(style));
    const blocked = useProjectStore(state => state.project.library.blocked.includes(style));
    return (
        <div className="flex gap-1.5">
            <Button size="sm" variant={favorite ? 'primary' : 'default'} onClick={() => toggleFavorite(style)}>
                <Heart size={12} /> {favorite ? '已收藏' : '收藏'}
            </Button>
            <Button size="sm" variant={blocked ? 'danger' : 'default'} onClick={() => toggleBlocked(style)}>
                <Ban size={12} /> {blocked ? '已屏蔽' : '屏蔽'}
            </Button>
        </div>
    );
}

function ParagraphInspector({ paragraph }: { paragraph: LumiParagraph }) {
    const program = useProgram();
    const override = useProjectStore(state => state.project.paragraphDirections.find(item => (
        item.anchor.line.index === paragraph.anchor.line.index && item.anchor.line.hash === paragraph.anchor.line.hash
    )));
    const transitionOp = useProjectStore(state => state.project.overrides.find(op => (
        op.type === 'transition' && op.anchor.line.index === paragraph.anchor.line.index && op.anchor.line.hash === paragraph.anchor.line.hash
    )));
    const { direction } = paragraph;
    const families = findPack(direction.pack)?.families ?? [];
    const activeFamilies = direction.families?.filter(id => families.some(family => family.id === id)) ?? null;

    return (
        <>
            <Section title="段落">
                <Row label="性质">{KIND_LABELS[paragraph.kind]}{paragraph.kindManual ? '（手动）' : ''}</Row>
                <Row label="时间">{formatTime(paragraph.startTime)} – {formatTime(paragraph.endTime)}</Row>
                <Row label="分段原因">{BOUNDARY_LABELS[paragraph.boundary]}{paragraph.merged ? '，含手动合并' : ''}</Row>
                <Row label="shot 数">{paragraph.shots.length}</Row>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => seek(paragraph.startTime)}>跳到段首</Button>
                    <Button size="sm" onClick={() => void pickParagraphKind(paragraph)}>改性质…</Button>
                    <Button size="sm" disabled={paragraph.index === 0} onClick={() => mergeWithPrevious(program, paragraph, message => log(message))}>与上一段合并</Button>
                    {(paragraph.boundary === 'manual' || paragraph.merged) && (
                        <Button size="sm" variant="ghost" onClick={() => resetParagraphStructure(program, paragraph, message => log(message))}>恢复自动分段</Button>
                    )}
                </div>
                <div className="text-[11px] text-zinc-500">要在某一行拆开：在时间轴的歌词块上右键，或拖动段落轨上两段之间的边界。</div>
            </Section>
            <Section title="编排（Direction）">
                <Field label="风格包">
                    <Segmented<'auto' | PackId>
                        value={override?.pack ?? 'auto'}
                        onChange={value => setParagraphDirection(paragraph, { pack: value })}
                        options={[
                            { value: 'auto', label: '自动' },
                            ...listPacks().map(pack => ({ value: pack.id, label: pack.shortLabel })),
                        ]}
                    />
                </Field>
                <Field label="能量" hint="自动时由包按段落性质与字数决定；手动时决定候选构图的安静 / 喧哗。">
                    <Toggle
                        label="手动指定"
                        checked={direction.energy !== null}
                        onChange={checked => setParagraphDirection(paragraph, { energy: checked ? 0.5 : 'auto' })}
                    />
                    {direction.energy !== null && (
                        <Slider
                            value={direction.energy}
                            min={0} max={1} step={0.01}
                            onChange={value => setParagraphDirection(paragraph, { energy: value })}
                            format={value => value.toFixed(2)}
                        />
                    )}
                </Field>
                <Field label="允许的构图族" hint="不选即不限。">
                    <div className="flex flex-wrap gap-1">
                        {families.map(family => {
                            const on = activeFamilies?.includes(family.id) ?? false;
                            return (
                                <button
                                    key={family.id}
                                    type="button"
                                    onClick={() => {
                                        const current = activeFamilies ?? [];
                                        const next = on ? current.filter(id => id !== family.id) : [...current, family.id];
                                        setParagraphDirection(paragraph, { families: next.length > 0 ? next : 'auto' });
                                    }}
                                    className={cx('rounded border px-1.5 py-0.5 text-[11px]', on ? 'border-amber-400 bg-amber-400/20 text-amber-100' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}
                                >
                                    {family.label}
                                </button>
                            );
                        })}
                    </div>
                </Field>
                {override && <Button size="sm" variant="ghost" onClick={() => setParagraphDirection(paragraph, { pack: 'auto', energy: 'auto', families: 'auto' })}>全部恢复自动</Button>}
            </Section>
            <Section title="出场转场">
                <select
                    value={transitionOp?.type === 'transition' ? transitionOp.transition : 'auto'}
                    onChange={event => setParagraphTransition(paragraph, event.target.value as TransitionId | 'none' | 'auto')}
                    className={inputClass}
                >
                    <option value="auto">自动{paragraph.transitionOut && transitionOp === undefined ? `（${getTransition(paragraph.transitionOut.id)?.label}）` : ''}</option>
                    <option value="none">无转场</option>
                    {listPacks().map(pack => (
                        <optgroup key={pack.id} label={pack.label}>
                            {pack.transitions.map(item => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                {!paragraph.transitionOut && transitionOp === undefined && <div className="text-xs text-zinc-500">最后一段没有出场转场。</div>}
            </Section>
        </>
    );
}

function ShotInspector({ shot, paragraph }: { shot: LumiShot; paragraph: LumiParagraph }) {
    const program = useProgram();
    const shotMixing = useProjectStore(state => state.project.direction.shotMixing);
    const style = getStyle(shot.style);
    const [pickPack, setPickPack] = useState<PackId>(shot.pack);
    const [family, setFamily] = useState<string>(style?.family ?? '');
    const pack = shotMixing ? pickPack : paragraph.direction.pack;
    const styles = (findPack(pack)?.styles ?? []).filter(item => !family || item.family === family);
    const text = shot.lineIndices.map(index => program.lines[index]?.line.fullText).filter(Boolean).join(' / ');
    return (
        <>
            <Section title="镜头">
                <Row label="风格">{style ? `${familyLabel(style.pack, style.family)} · ${style.kind}` : shot.style}</Row>
                <Row label="mood">{style?.mood}</Row>
                <Row label="时间">{formatTime(shot.startTime)} – {formatTime(shot.endTime)}</Row>
                <Row label="所在段落">{KIND_LABELS[paragraph.kind]}（{packShortLabel(paragraph.direction.pack)}）</Row>
                {shot.isBridge ? <div className="text-xs text-zinc-500">间奏 bridge：无歌词，只有构图。</div> : <div className="text-xs text-zinc-400">{text}</div>}
                <div className="flex flex-wrap gap-1.5">
                    {shot.locked ? (
                        <Button size="sm" onClick={() => unlockShotStyle(shot)}><Unlock size={12} /> 解除锁定</Button>
                    ) : (
                        <Button size="sm" onClick={() => lockCurrentStyle(shot)}><Lock size={12} /> 锁定当前风格</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => seek(shot.startTime)}>跳到这里</Button>
                </div>
                {style && <StyleActions style={style.id} />}
            </Section>
            {(findPack(shot.pack)?.componentSlots?.length ?? 0) > 0 && (
                <Section title="组件（构图 × 排版 × 点缀）">
                    <div className="text-[11px] text-zinc-500">构图就是风格本身；排版与点缀可以单独替换，只影响这一个镜头。</div>
                    {findPack(shot.pack)!.componentSlots!.map(slotDef => {
                        const locked = shot.lockedComponents.includes(slotDef.id);
                        const borrowable = slotDef.id === 'typography' && !shot.isBridge && style
                            ? borrowableTypographies(shot.pack, style.kind)
                            : [];
                        const current = shot.components[slotDef.id];
                        const currentLabel = slotDef.options.find(option => option.id === current)?.label
                            ?? borrowable.find(option => option.value === current)?.label
                            ?? current;
                        return (
                            <Field key={slotDef.id} label={slotDef.label}>
                                <select
                                    value={locked ? current : 'auto'}
                                    onChange={event => setShotComponent(shot, slotDef.id, event.target.value)}
                                    className={inputClass}
                                >
                                    <option value="auto">自动（{currentLabel}）</option>
                                    <optgroup label={packShortLabel(shot.pack)}>
                                        {slotDef.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                                    </optgroup>
                                    {borrowable.length > 0 && (
                                        <optgroup label="借用其他包的排版">
                                            {borrowable.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </optgroup>
                                    )}
                                </select>
                            </Field>
                        );
                    })}
                    {shot.borrowedText && (
                        <div className="text-[11px] text-zinc-500">
                            字由{packShortLabel(shot.borrowedText.pack)}排在本构图的文字区域里（预览上的虚线框），构图与点缀仍是{packShortLabel(shot.pack)}的。
                        </div>
                    )}
                </Section>
            )}
            <Section title="换成…">
                {shotMixing && (
                    <Segmented<PackId>
                        value={pickPack}
                        onChange={value => {
                            setPickPack(value);
                            setFamily('');
                        }}
                        options={listPacks().map(item => ({ value: item.id, label: item.shortLabel }))}
                    />
                )}
                <select value={family} onChange={event => setFamily(event.target.value)} className={inputClass}>
                    <option value="">全部族</option>
                    {(findPack(pack)?.families ?? []).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <StylePickerGrid shot={shot} styles={styles} />
                <div className="text-[11px] text-zinc-500">
                    鼠标停在缩略图上可以在预览里试看，点击才替换；也可以用方向键 + 回车。{shotMixing ? '换成另一个包的风格时，这一格由那个包来画，镜头边界不变。' : '跨包换风格需要在检查器的编排设置里开启「按 shot 混用」。'}
                </div>
            </Section>
        </>
    );
}

function LineInspector({ index }: { index: number }) {
    const program = useProgram();
    const edit = useProjectStore(state => state.project.lyricEdits.lines.find(item => item.anchor.index === index));
    const hasTiming = Boolean(edit && (edit.startTime !== undefined || edit.endTime !== undefined || edit.words));
    const line = program.lines[index]?.line;
    // 选原始数据（引用稳定），修复结果在外面算：选择器每次返回新数组会让 zustand 反复重渲染。
    const segments = useProjectStore(state => state.project.lyricEdits.segments);
    const repair = useMemo(() => {
        if (!line) return null;
        const project = useProjectStore.getState().project;
        return segmentationRepairFor({ ...project, lyricEdits: { ...project.lyricEdits, segments } }, anchorOfLine(line, index), line);
    }, [segments, line, index]);
    const savedParts = useProjectStore(state => state.project.lyricEdits.segments.find(item => item.anchor.index === index)?.parts);
    const [draft, setDraft] = useState<string | null>(null);
    const current = useMemo(() => (line ? segmentLyricWords(line).map((part, i, parts) => (
        line.fullText.slice(part.index, parts[i + 1]?.index ?? line.fullText.length)
    )) : []), [line]);
    if (!line) return <Section title="歌词行"><div className="text-xs text-zinc-500">这一行已不存在。</div></Section>;
    const anchor = anchorOfLine(line, index);
    const draftText = draft ?? current.join('|');
    const parts = draftText.split('|');
    const valid = isValidWordSegmentation(line.fullText, parts);
    return (
        <>
            <Section title={`第 ${index + 1} 行`}>
                <div data-selectable className="text-sm text-zinc-100">{line.fullText}</div>
                {line.translation && <div data-selectable className="text-xs text-zinc-400">{line.translation}</div>}
                <div className="grid grid-cols-2 gap-2">
                    <Field label="开始（秒）">
                        <input
                            type="number" step={0.01} value={Number(line.startTime.toFixed(3))}
                            onChange={event => setLineBounds(anchor, line, { startTime: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="结束（秒）">
                        <input
                            type="number" step={0.01} value={Number(line.endTime.toFixed(3))}
                            onChange={event => setLineBounds(anchor, line, { endTime: Number(event.target.value) })}
                            className={inputClass}
                        />
                    </Field>
                </div>
                <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => seek(line.startTime)}>跳到这里</Button>
                    {hasTiming && <Button size="sm" variant="ghost" onClick={() => resetLineTiming(anchor)}>恢复原始时间</Button>}
                    {edit?.text !== undefined && <Button size="sm" variant="ghost" onClick={() => resetLineText(anchor)}>恢复原文</Button>}
                </div>
            </Section>
            <Section title="分词">
                {repair && (
                    <div role="alert" className="space-y-1.5 rounded border border-amber-800/70 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-100">
                        <div>改字之后，这一行的手动分词对不上新文字了（现在先用自动分词）。</div>
                        <div className="text-zinc-300">原来：<span className="font-mono">{savedParts?.join('|')}</span></div>
                        <div className="text-zinc-300">修复后：<span className="font-mono">{repair.join('|')}</span></div>
                        <div className="flex gap-1.5">
                            <Button size="sm" variant="primary" onClick={() => { repairLineSegmentation(anchor, line); setDraft(null); }}>自动修复</Button>
                            <Button size="sm" onClick={() => setDraft(repair.join('|'))}>手动修改</Button>
                        </div>
                    </div>
                )}
                <Field label="用 | 分隔词" hint={valid ? '分词只影响字号层级与镜头，不改变文字。' : '拼起来必须与原文完全一致。'}>
                    <input
                        value={draftText}
                        onChange={event => setDraft(event.target.value)}
                        className={cx(inputClass, !valid && 'border-red-500')}
                    />
                </Field>
                <div className="flex gap-1.5">
                    <Button size="sm" variant="primary" disabled={!valid || draft === null} onClick={() => {
                        setLineSegments(anchor, parts);
                        setDraft(null);
                    }}
                    >
                        应用
                    </Button>
                    {line.wordSegments && <Button size="sm" variant="ghost" onClick={() => {
                        setLineSegments(anchor, null);
                        setDraft(null);
                    }}
                    >
                        恢复自动分词
                    </Button>}
                </div>
            </Section>
        </>
    );
}

function ProjectInspector() {
    const direction = useProjectStore(state => state.project.direction);
    const mix = mixAssignment(direction);
    const subtitles = useProjectStore(state => state.project.tuning.kernel.subtitles);
    const program = useProgram();
    const lockedCount = program.paragraphs.reduce((sum, p) => sum + p.shots.filter(s => s.locked).length, 0);
    return (
        <>
            <Section title="编排">
                <Field label="模式">
                    <Segmented<'single' | 'mix'>
                        value={direction.mode}
                        onChange={mode => updateProject(p => ({ ...p, direction: { ...p.direction, mode } }))}
                        options={[{ value: 'single', label: '全曲一个包' }, { value: 'mix', label: '按段落混用' }]}
                    />
                </Field>
                {direction.mode === 'single' ? (
                    <Field label="风格包">
                        <select
                            value={direction.pack}
                            onChange={event => updateProject(p => ({ ...p, direction: { ...p.direction, pack: event.target.value } }))}
                            className={inputClass}
                        >
                            {listPacks().map(pack => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
                        </select>
                    </Field>
                ) : (
                    <Field label="每种段落用哪个包" hint="检查器里单独指定过的段落不受影响。">
                        <div className="space-y-1">
                            {PARAGRAPH_KINDS.map(kind => (
                                <label key={kind} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
                                    <span className="w-8 shrink-0 whitespace-nowrap">{KIND_LABELS[kind]}</span>
                                    <select
                                        value={mix[kind]}
                                        onChange={event => updateProject(p => ({
                                            ...p,
                                            direction: { ...p.direction, mixByKind: mixOverrides({ ...p.direction.mixByKind, [kind]: event.target.value }) },
                                        }))}
                                        className={cx(inputClass, 'h-7 min-w-0 flex-1')}
                                    >
                                        {listPacks().map(pack => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
                                        {!findPack(mix[kind]) && (
                                            <option value={mix[kind]}>{packLabel(mix[kind])}（未安装）</option>
                                        )}
                                    </select>
                                </label>
                            ))}
                            {PARAGRAPH_KINDS.some(kind => mix[kind] !== DEFAULT_MIX_BY_KIND[kind]) && (
                                <Button size="sm" variant="ghost" onClick={() => updateProject(p => ({ ...p, direction: { ...p.direction, mixByKind: {} } }))}>
                                    恢复默认分配
                                </Button>
                            )}
                        </div>
                    </Field>
                )}
                <Toggle
                    label="段内按镜头混用不同的包"
                    checked={direction.shotMixing}
                    onChange={shotMixing => updateProject(p => ({ ...p, direction: { ...p.direction, shotMixing } }))}
                />
                <Row label="段落 / shot">{program.paragraphs.length} / {program.paragraphs.reduce((sum, p) => sum + p.shots.length, 0)}</Row>
                <Row label="锁定的 shot">{lockedCount}</Row>
            </Section>
            <Section title="字幕">
                <Field label="画面底部的第二行">
                    <Segmented<'translation' | 'romanization' | 'none'>
                        value={subtitles.mode}
                        onChange={mode => updateProject(p => ({ ...p, tuning: { ...p.tuning, kernel: { ...p.tuning.kernel, subtitles: { ...p.tuning.kernel.subtitles, mode } } } }))}
                        options={[{ value: 'translation', label: '译文' }, { value: 'romanization', label: '罗马音' }, { value: 'none', label: '不显示' }]}
                    />
                </Field>
            </Section>
            <div className="px-4 py-3 text-xs text-zinc-500">在时间轴上点选段落、镜头或歌词行来编辑它们。</div>
        </>
    );
}

export function Inspector() {
    const selection = useSession(state => state.selection);
    const program = useProgram();
    if (selection.type === 'paragraph' || selection.type === 'shot') {
        const paragraph = program.paragraphs.find(item => item.id === selection.paragraphId);
        if (paragraph && selection.type === 'paragraph') return <ParagraphInspector key={paragraph.id} paragraph={paragraph} />;
        const shotId = selection.type === 'shot' ? selection.shotId : null;
        const shot = paragraph?.shots.find(item => item.id === shotId);
        if (paragraph && shot) return <ShotInspector key={shot.id} shot={shot} paragraph={paragraph} />;
        return (
            <div className="space-y-2 px-4 py-3 text-xs text-zinc-500">
                选中的对象在重新编排后已不存在。
                <Button size="sm" onClick={() => setSession({ selection: { type: 'none' } })}>取消选择</Button>
            </div>
        );
    }
    if (selection.type === 'line') return <LineInspector key={selection.lineIndex} index={selection.lineIndex} />;
    if (selection.type === 'clip') return <ClipInspector key={selection.clipId} clipId={selection.clipId} />;
    if (selection.type === 'background') return <BackgroundInspector key={selection.clipId} clipId={selection.clipId} />;
    return <ProjectInspector />;
}
