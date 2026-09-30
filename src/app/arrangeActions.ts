// src/app/arrangeActions.ts
// 镜头与段落上的常用操作：右键菜单、快速选择、命令面板、面包屑共用。选择风格 / 排版时高亮项在预览里试看。
import { PARAGRAPH_KINDS, type LumiParagraph, type LumiProgram, type LumiShot } from '@/compiler/types';
import { getAgentState } from '@/agent/host';
import { borrowableTypographies, familyLabel, findPack, getStyle, listPacks } from '@/packs/registry';
import {
    lockCurrentStyle,
    lockShotStyle,
    patchParagraphDirection,
    setParagraphDirection,
    setParagraphTransition,
    setShotComponent,
    unlockShotStyle,
} from '@/project/edits';
import { setPeek, setSession, useSession } from '@/project/session';
import { mergeWithPrevious, resetParagraphStructure, setParagraphKind, splitParagraphAt } from '@/project/structure';
import { updateProject, useProjectStore } from '@/project/store';
import { bringShotIntoView } from './inspector/StylePickerGrid';
import { log } from './output';
import { seek, usePlayback } from './playback';
import { revealInTimeline } from './timeline/reveal';
import type { ContextMenuItem } from './workbench/ContextMenu';
import { showQuickPick, type QuickPickItem } from './workbench/QuickPick';

export const PARAGRAPH_KIND_LABELS: Record<string, string> = {
    breath: '换气', verse: '主歌', lift: '上扬', chorus: '副歌', break: '间奏', outro: '尾声',
};

const packShort = (id: string) => findPack(id)?.shortLabel ?? id;

// ---------------------------------------------------------------------------------------------
// 选择

export const selectShot = (paragraph: LumiParagraph, shot: LumiShot, jump = true) => {
    setSession({ selection: { type: 'shot', paragraphId: paragraph.id, shotId: shot.id } });
    if (jump) {
        seek(shot.startTime + 0.01);
        revealInTimeline(shot.startTime, shot.endTime);
    }
};

export const selectParagraph = (paragraph: LumiParagraph, jump = true) => {
    setSession({ selection: { type: 'paragraph', paragraphId: paragraph.id } });
    if (jump) {
        seek(paragraph.startTime + 0.01);
        revealInTimeline(paragraph.startTime, paragraph.endTime);
    }
};

/** 当前选中的镜头 / 段落（按最新的编排解析）。 */
export const currentSelection = (program: LumiProgram = getAgentState().program) => {
    const selection = useSession.getState().selection;
    if (selection.type !== 'shot' && selection.type !== 'paragraph') return { paragraph: null, shot: null };
    const paragraph = program.paragraphs.find(item => item.id === selection.paragraphId) ?? null;
    const shot = selection.type === 'shot' ? paragraph?.shots.find(item => item.id === selection.shotId) ?? null : null;
    return { paragraph, shot };
};

/** 时刻 time 所在的段落与镜头。 */
export const locateAt = (program: LumiProgram, time: number) => {
    const paragraph = [...program.paragraphs].reverse().find(item => time >= item.startTime) ?? program.paragraphs[0] ?? null;
    const shot = paragraph ? [...paragraph.shots].reverse().find(item => time >= item.startTime) ?? null : null;
    return { paragraph, shot };
};

/** 播放头所在的段落 / 镜头 id。只在跨过镜头边界时变化（播放时不逐帧重渲染）。 */
export const usePlayheadLocation = (program: LumiProgram) => {
    const key = usePlayback(state => {
        const { paragraph, shot } = locateAt(program, state.time);
        return `${paragraph?.id ?? ''}|${shot?.id ?? ''}`;
    });
    const [paragraphId, shotId] = key.split('|');
    return { paragraphId: paragraphId || null, shotId: shotId || null };
};

export const shotText = (program: LumiProgram, shot: LumiShot) => (
    shot.isBridge ? '（间奏）' : shot.lineIndices.map(index => program.lines[index]?.line.fullText).filter(Boolean).join(' / ')
);

// ---------------------------------------------------------------------------------------------
// 快速选择

export const pickShotStyle = async (shot: LumiShot) => {
    const project = useProjectStore.getState().project;
    const packs = project.direction.shotMixing ? listPacks() : listPacks().filter(pack => pack.id === shot.pack);
    const items: QuickPickItem<string>[] = packs.flatMap(pack => pack.styles.map(style => ({
        label: style.kind,
        description: `${packs.length > 1 ? `${pack.shortLabel} · ` : ''}${familyLabel(pack.id, style.family)} · ${style.mood}`,
        value: style.id,
        thumbnail: style.id,
        picked: style.id === shot.style,
    })));
    bringShotIntoView(shot);
    const chosen = await showQuickPick(items, {
        title: `更换镜头风格（当前：${shot.style}）`,
        placeholder: '输入以过滤；上下键在预览里试看，回车替换',
        onActive: style => setPeek([{ id: 'peek-style', type: 'shot-style', anchor: shot.anchor, style }]),
    });
    setPeek(null, 0);
    if (chosen && (chosen !== shot.style || !shot.locked)) lockShotStyle(shot, chosen);
};

export const pickShotComponent = async (shot: LumiShot, slotId: string) => {
    const pack = findPack(shot.pack);
    const slot = pack?.componentSlots?.find(item => item.id === slotId);
    if (!slot) return;
    const kind = getStyle(shot.style)?.kind ?? '';
    const current = shot.components[slotId];
    const items: QuickPickItem<string>[] = [
        { label: '自动', description: '交回自动规则', value: 'auto', picked: !shot.lockedComponents.includes(slotId) },
        ...slot.options.map(option => ({ label: option.label, description: pack!.shortLabel, value: option.id, picked: shot.lockedComponents.includes(slotId) && option.id === current })),
        ...(slotId === 'typography' && !shot.isBridge
            ? borrowableTypographies(shot.pack, kind).map(option => ({ label: option.label, description: '借用其他包', value: option.value, picked: option.value === current }))
            : []),
    ];
    bringShotIntoView(shot);
    const chosen = await showQuickPick(items, {
        title: `镜头的${slot.label}`,
        onActive: value => setPeek(value === 'auto' ? [] : [{ id: 'peek-component', type: 'shot-component', anchor: shot.anchor, slot: slotId, value }]),
    });
    setPeek(null, 0);
    if (chosen) setShotComponent(shot, slotId, chosen);
};

export const pickParagraphPack = async (paragraph: LumiParagraph) => {
    const items: QuickPickItem<string>[] = [
        { label: '自动', description: '按编排设置', value: 'auto', picked: paragraph.direction.source === 'auto' },
        ...listPacks().map(pack => ({ label: pack.label, description: pack.description.slice(0, 40), value: pack.id, picked: paragraph.direction.source !== 'auto' && paragraph.direction.pack === pack.id })),
    ];
    const chosen = await showQuickPick(items, { title: `第 ${paragraph.index + 1} 段（${PARAGRAPH_KIND_LABELS[paragraph.kind]}）由哪个包来画` });
    if (chosen) setParagraphDirection(paragraph, { pack: chosen });
};

export const pickParagraphTransition = async (paragraph: LumiParagraph) => {
    const currentId = paragraph.transitionOut?.id ?? 'none';
    const items: QuickPickItem<string>[] = [
        { label: '自动', value: 'auto' },
        { label: '无转场', value: 'none', picked: currentId === 'none' },
        ...listPacks().flatMap(pack => pack.transitions.map(transition => ({
            label: transition.label,
            description: pack.shortLabel,
            value: transition.id,
            picked: transition.id === currentId,
        }))),
    ];
    const chosen = await showQuickPick(items, { title: `第 ${paragraph.index + 1} 段的出场转场` });
    if (chosen) setParagraphTransition(paragraph, chosen);
};

export const pickParagraphKind = async (paragraph: LumiParagraph) => {
    const chosen = await showQuickPick<string>([
        { label: '自动判断', description: '按歌词标记、时长与字数', value: 'auto', picked: !paragraph.kindManual },
        ...PARAGRAPH_KINDS.map(kind => ({ label: PARAGRAPH_KIND_LABELS[kind], description: kind, value: kind, picked: paragraph.kindManual && paragraph.kind === kind })),
    ], { title: `第 ${paragraph.index + 1} 段的性质（影响按段落混用时用哪个包、镜头的能量）` });
    if (chosen) setParagraphKind(paragraph, chosen as never, message => log(message));
};

/** 这一段范围内有没有手动分段 / 合并记录。 */
const hasManualStructure = (paragraph: LumiParagraph) => {
    const lines = new Set(paragraph.lineIndices);
    return useProjectStore.getState().project.structureEdits.some(edit => edit.type !== 'kind' && lines.has(edit.anchor.index));
};

/** 分段相关的菜单项：在某一行开新段（lineIndex 给出时）、与上一段合并、性质、交回自动分段。 */
export const structureMenuItems = (program: LumiProgram, paragraph: LumiParagraph, lineIndex?: number): ContextMenuItem[] => [
    ...(lineIndex !== undefined ? [{
        label: `在第 ${lineIndex + 1} 行开新段`,
        run: () => splitParagraphAt(program, lineIndex, message => log(message)),
        disabled: paragraph.lineIndices[0] === lineIndex,
    }] : []),
    { label: '与上一段合并', run: () => mergeWithPrevious(program, paragraph, message => log(message)), disabled: paragraph.index === 0 },
    { label: `性质…（当前：${PARAGRAPH_KIND_LABELS[paragraph.kind]}${paragraph.kindManual ? '，手动' : ''}）`, run: () => pickParagraphKind(paragraph) },
    { label: '恢复自动分段', run: () => resetParagraphStructure(program, paragraph, message => log(message)), disabled: !hasManualStructure(paragraph) },
];

/** 把这一段的编排覆盖（包、energy、族）复制到同一性质的所有段落。 */
export const copyDirectionToSameKind = (program: LumiProgram, paragraph: LumiParagraph) => {
    const targets = program.paragraphs.filter(item => item.kind === paragraph.kind && item.id !== paragraph.id);
    if (targets.length === 0) return;
    const { pack, energy, families, source } = paragraph.direction;
    const patch = source === 'auto'
        ? { pack: 'auto' as const, energy: 'auto' as const, families: 'auto' as const }
        : { pack, energy, families };
    updateProject(project => targets.reduce((next, target) => patchParagraphDirection(next, target.anchor, patch), project));
    log(`已把第 ${paragraph.index + 1} 段的编排复制到 ${targets.length} 个${PARAGRAPH_KIND_LABELS[paragraph.kind]}段落`);
};

// ---------------------------------------------------------------------------------------------
// 右键菜单

export const shotMenu = (program: LumiProgram, paragraph: LumiParagraph, shot: LumiShot): ContextMenuItem[] => {
    const slots = findPack(shot.pack)?.componentSlots ?? [];
    return [
        { label: '更换风格…', run: () => pickShotStyle(shot) },
        ...slots.map(slot => ({ label: `${slot.label}…`, run: () => pickShotComponent(shot, slot.id), disabled: shot.isBridge && slot.id === 'typography' })),
        'separator',
        shot.locked
            ? { label: '解除风格锁定', run: () => unlockShotStyle(shot) }
            : { label: '锁定当前风格', run: () => lockCurrentStyle(shot) },
        { label: '清除这个镜头的组件替换', run: () => slots.forEach(slot => setShotComponent(shot, slot.id, 'auto')), disabled: shot.lockedComponents.length === 0 },
        'separator',
        ...(shot.lineIndices.length > 0 && shot.lineIndices[0] >= 0 && paragraph.lineIndices.includes(shot.lineIndices[0]) && paragraph.lineIndices[0] !== shot.lineIndices[0]
            ? [{ label: `从这个镜头的第 ${shot.lineIndices[0] + 1} 行开新段`, run: () => splitParagraphAt(program, shot.lineIndices[0], message => log(message)) }]
            : []),
        { label: '跳到这里', run: () => selectShot(paragraph, shot) },
        { label: '所在段落', run: () => selectParagraph(paragraph) },
        ...paragraphMenu(program, paragraph).filter(item => item !== 'separator' && item.label !== '跳到这里').slice(0, 2),
    ];
};

export const paragraphMenu = (program: LumiProgram, paragraph: LumiParagraph): ContextMenuItem[] => [
    { label: `由哪个包来画…（当前：${packShort(paragraph.direction.pack)}）`, run: () => pickParagraphPack(paragraph) },
    { label: '出场转场…', run: () => pickParagraphTransition(paragraph), disabled: paragraph.index === program.paragraphs.length - 1 },
    'separator',
    ...structureMenuItems(program, paragraph),
    'separator',
    { label: `把编排复制到所有${PARAGRAPH_KIND_LABELS[paragraph.kind]}段落`, run: () => copyDirectionToSameKind(program, paragraph) },
    { label: '交回自动编排', run: () => setParagraphDirection(paragraph, { pack: 'auto', energy: 'auto', families: 'auto' }), disabled: paragraph.direction.source === 'auto' },
    'separator',
    { label: '跳到这里', run: () => selectParagraph(paragraph) },
];
