// src/app/Breadcrumbs.tsx
// 预览上方的面包屑（VS Code 编辑器顶部那条）：段落 › 镜头。有选区时显示选区，否则显示播放头所在处；
// 点任一段弹出快速选择，在同级之间跳转。
import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { getStyle } from '@/packs/registry';
import { useSession } from '@/project/session';
import { PARAGRAPH_KIND_LABELS, selectParagraph, selectShot, shotText, usePlayheadLocation } from './arrangeActions';
import { useProgram } from './DerivedProvider';
import { packShortLabel } from './StylePanel';
import { formatTime } from './Transport';
import { showQuickPick } from './workbench/QuickPick';

export function Breadcrumbs() {
    const program = useProgram();
    const selection = useSession(state => state.selection);
    const location = usePlayheadLocation(program);

    const { paragraph, shot } = useMemo(() => {
        if (selection.type === 'shot' || selection.type === 'paragraph') {
            const p = program.paragraphs.find(item => item.id === selection.paragraphId) ?? null;
            const s = selection.type === 'shot' ? p?.shots.find(item => item.id === selection.shotId) ?? null : null;
            if (p) return { paragraph: p, shot: s };
        }
        const p = program.paragraphs.find(item => item.id === location.paragraphId) ?? program.paragraphs[0] ?? null;
        const s = p?.shots.find(item => item.id === location.shotId) ?? null;
        return { paragraph: p, shot: s };
    }, [program, selection, location.paragraphId, location.shotId]);

    if (!paragraph) return <div className="h-6 shrink-0 border-b border-zinc-800 bg-zinc-950" />;

    const pickParagraph = async () => {
        const chosen = await showQuickPick(program.paragraphs.map(item => ({
            label: `${item.index + 1}. ${PARAGRAPH_KIND_LABELS[item.kind]} · ${packShortLabel(item.direction.pack)}`,
            description: formatTime(item.startTime),
            value: item,
            picked: item.id === paragraph.id,
        })), { title: '跳到段落' });
        if (chosen) selectParagraph(chosen);
    };

    const pickShot = async () => {
        const chosen = await showQuickPick(paragraph.shots.map(item => ({
            label: getStyle(item.style)?.kind ?? item.style,
            description: shotText(program, item).slice(0, 36),
            value: item,
            thumbnail: item.style,
            picked: item.id === shot?.id,
        })), { title: `第 ${paragraph.index + 1} 段的镜头` });
        if (chosen) selectShot(paragraph, chosen);
    };

    const crumb = 'rounded px-1 hover:bg-zinc-800 hover:text-zinc-100';
    return (
        <nav aria-label="位置" className="flex h-6 shrink-0 items-center gap-0.5 overflow-hidden border-b border-zinc-800 bg-zinc-950 px-2 text-[11px] whitespace-nowrap text-zinc-400">
            <span className="px-1 text-zinc-500">全曲</span>
            <ChevronRight size={12} className="shrink-0 text-zinc-600" />
            <button type="button" onClick={() => void pickParagraph()} className={crumb}>
                {paragraph.index + 1}. {PARAGRAPH_KIND_LABELS[paragraph.kind]} · {packShortLabel(paragraph.direction.pack)}
            </button>
            {shot && (
                <>
                    <ChevronRight size={12} className="shrink-0 text-zinc-600" />
                    <button type="button" onClick={() => void pickShot()} className={crumb}>
                        {getStyle(shot.style)?.kind ?? shot.style}
                    </button>
                    <span className="truncate pl-1 text-zinc-600">{shotText(program, shot)}</span>
                </>
            )}
        </nav>
    );
}
