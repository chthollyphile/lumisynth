// src/app/views/LibraryView.tsx
// 主侧栏「素材库」：工程里的图片。可以摆到画面上（素材层，与风格包无关），也可以交给凝彩自动取用。
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ImagePlus, LayoutTemplate, Plus, Trash2, Wallpaper } from 'lucide-react';
import type { ClipTiming } from '@/core/assets/clips';
import type { BackgroundSource } from '@/core/assets/background';
import { addBackgroundAt } from '../backgroundActions';
import { addAssetClip, IMAGE_ACCEPT, importLibraryFile, isInTemperaPool, VIDEO_ACCEPT, removeLibraryAsset, renameLibraryAsset, setTemperaAuto, type LibraryAsset } from '@/project/assets';
import { setSession, useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { locateAt } from '../arrangeActions';
import { useProgram } from '../DerivedProvider';
import { DropZone } from '../DropZone';
import { log } from '../output';
import { clock } from '../playback';
import { cx, FileButton } from '../ui';
import { showContextMenu, type ContextMenuItem } from '../workbench/ContextMenu';
import { AutoArrangePanel } from '../autoArrange/AutoArrangePanel';
import { useAutoClipCount } from '../autoArrange/autoArrangeActions';

export function AssetThumb({ assetId, className }: { assetId: string; className?: string }) {
    const blob = useSession(state => state.assetBlobs.get(assetId));
    const isVideo = useProjectStore(state => state.project.assets.find(item => item.id === assetId)?.kind === 'video');
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!blob) return;
        const next = URL.createObjectURL(blob);
        setUrl(next);
        return () => URL.revokeObjectURL(next);
    }, [blob]);
    return (
        <div className={className ?? 'flex aspect-square items-center justify-center bg-[repeating-conic-gradient(#27272a_0_25%,#18181b_0_50%)] bg-[length:12px_12px]'}>
            {url && (isVideo
                ? <video src={`${url}#t=0.1`} muted preload="metadata" className="max-h-full max-w-full object-contain" />
                : <img src={url} alt="" draggable={false} className="max-h-full max-w-full object-contain" />)}
        </div>
    );
}

/** 在播放头处插入：挂在播放头所在的镜头上；没有镜头时用 4 秒的绝对时间。 */
export const insertAssetAtPlayhead = (asset: LibraryAsset, program: ReturnType<typeof useProgram>) => {
    const time = clock.get();
    const { shot } = locateAt(program, time);
    const timing: ClipTiming = shot && time < shot.endTime
        ? { type: 'shot', anchor: shot.anchor }
        : { type: 'absolute', start: time, end: time + 4 };
    const clip = addAssetClip(asset.id, timing);
    setSession({ selection: { type: 'clip', clipId: clip.id } });
    log(`已把「${asset.name}」放到画面上${timing.type === 'shot' ? '（跟随当前镜头）' : ''}`);
};

/** 一次导入多个文件：一个一个来（解码占内存），最后报个总数；坏文件单独报错，不影响其余的。 */
export const importLibraryFiles = async (files: File[]) => {
    let imported = 0;
    for (const file of files) {
        try {
            await importLibraryFile(file);
            imported += 1;
        } catch (reason) {
            log(`「${file.name}」没有导入：${(reason as Error).message}`, 'error');
        }
    }
    if (imported > 0) log(files.length === 1 ? `已加入素材库：${files[0].name}` : `已加入素材库：${imported} 个文件${imported < files.length ? `（${files.length - imported} 个失败）` : ''}`);
};

export function LibraryView() {
    const assets = useProjectStore(state => state.project.assets);
    const clips = useProjectStore(state => state.project.assetClips);
    const project = useProjectStore(state => state.project);
    const program = useProgram();
    const [renaming, setRenaming] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [arrangeOpen, setArrangeOpen] = useState(false);
    const autoCount = useAutoClipCount();
    const images = assets;
    // 选中的只算还在素材库里的图片（视频不能摆到画面上）。
    const selectedImages = assets.filter(asset => asset.kind === 'image' && selected.has(asset.id)).map(asset => asset.id);
    const imageCount = assets.filter(asset => asset.kind === 'image').length;
    // 选中的集合里可能留着已经删掉的素材：数量只算还在的。
    const selectedCount = assets.filter(asset => selected.has(asset.id)).length;
    const toggle = (id: string) => setSelected(current => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
    const backgroundSource = (asset: LibraryAsset): BackgroundSource => (asset.kind === 'video'
        ? { type: 'video', assetId: asset.id, offset: 0, loop: true }
        : { type: 'image', assetId: asset.id });

    const menu = (asset: LibraryAsset): ContextMenuItem[] => [
        ...(asset.kind === 'image' ? [
            { label: '放到画面上（播放头处）', run: () => insertAssetAtPlayhead(asset, program) },
            { label: '允许凝彩自动取用', checked: isInTemperaPool(project, asset.id), run: () => setTemperaAuto(asset.id, !isInTemperaPool(project, asset.id)) },
        ] : []),
        { label: '设为背景：播放头所在的段落', run: () => addBackgroundAt(backgroundSource(asset), 'paragraph') },
        { label: '设为背景：全曲', run: () => addBackgroundAt(backgroundSource(asset), 'song') },
        { label: '重命名', run: () => setRenaming(asset.id) },
        'separator',
        { label: `从素材库删除${clips.some(clip => clip.assetId === asset.id) ? '（连同画面上的片段）' : ''}`, run: () => removeLibraryAsset(asset.id) },
    ];

    return (
        <DropZone target="library" label="松开以加入素材库" className="min-h-full space-y-2 px-3 py-2">
            <FileButton
                accept={`${IMAGE_ACCEPT},${VIDEO_ACCEPT}`}
                className="w-full"
                multiple
                onFiles={files => void importLibraryFiles(files)}
            >
                <ImagePlus size={14} /> 添加图片或视频（可多选）
            </FileButton>
            <div className="rounded-md border border-zinc-800">
                <button
                    type="button"
                    aria-expanded={arrangeOpen}
                    onClick={() => setArrangeOpen(open => !open)}
                    className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800/60"
                >
                    {arrangeOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <LayoutTemplate size={13} className="text-amber-400" />
                    自动编排到画面上
                    {autoCount > 0 && <span className="ml-auto text-[11px] text-zinc-500">已放 {autoCount} 处</span>}
                </button>
                {arrangeOpen && (
                    <div className="border-t border-zinc-800 px-2.5 py-2.5">
                        <AutoArrangePanel
                            assetIds={selectedImages.length > 0 ? selectedImages : null}
                            imageCount={selectedImages.length > 0 ? selectedImages.length : imageCount}
                        />
                    </div>
                )}
            </div>
            {selectedCount > 0 && (
                <div className="flex items-center gap-1 rounded-md bg-zinc-800/70 px-2 py-1 text-[11px] text-zinc-300">
                    <span>已选 {selectedCount} 个</span>
                    <button type="button" className="ml-auto rounded px-1.5 py-0.5 hover:bg-zinc-700" onClick={() => setSelected(new Set(assets.map(asset => asset.id)))}>全选</button>
                    <button type="button" className="rounded px-1.5 py-0.5 hover:bg-zinc-700" onClick={() => setSelected(new Set())}>取消</button>
                    <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-red-300 hover:bg-red-950/60"
                        onClick={() => {
                            [...selected].forEach(id => removeLibraryAsset(id));
                            setSelected(new Set());
                        }}
                    >
                        删除选中
                    </button>
                </div>
            )}
            <div className="text-[11px] text-zinc-500">
                图片可以摆到画面上：在背景之上、场景之下 / 场景之上 / 最上层三种层级，时间可以跟着镜头、段落或歌词行走。带透明的 png 效果最好。
                视频只能用作背景（右键「设为背景」）。
            </div>
            {images.length === 0 && <div className="py-6 text-center text-xs text-zinc-600">素材库是空的</div>}
            <div className="grid grid-cols-2 gap-2">
                {images.map(asset => {
                    const used = clips.filter(clip => clip.assetId === asset.id).length;
                    const auto = isInTemperaPool(project, asset.id);
                    const checked = selected.has(asset.id);
                    return (
                        <div
                            key={asset.id}
                            data-asset-card={asset.id}
                            onContextMenu={event => showContextMenu(event, menu(asset))}
                            className={cx('group overflow-hidden rounded-md border bg-zinc-900', checked ? 'border-amber-400/80' : 'border-zinc-800')}
                        >
                            <div className="relative">
                                <AssetThumb assetId={asset.id} />
                                <input
                                    type="checkbox"
                                    aria-label={`选择：${asset.name}`}
                                    checked={checked}
                                    onChange={() => toggle(asset.id)}
                                    className={cx('absolute top-1 left-1 transition-opacity', checked || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                                />
                                {asset.kind === 'video' && <span className="absolute bottom-1 left-1 rounded bg-zinc-950/80 px-1 text-[10px] text-violet-200">视频 · 背景</span>}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    {asset.kind === 'image' && <button type="button" aria-label={`放到画面上：${asset.name}`} title="放到画面上（播放头处）" onClick={() => insertAssetAtPlayhead(asset, program)} className="rounded bg-zinc-950/80 p-1 text-zinc-200 hover:text-amber-300"><Plus size={12} /></button>}
                                    <button type="button" aria-label={`设为背景：${asset.name}`} title="设为播放头所在段落的背景" onClick={() => addBackgroundAt(backgroundSource(asset), 'paragraph')} className="rounded bg-zinc-950/80 p-1 text-zinc-200 hover:text-violet-300"><Wallpaper size={12} /></button>
                                    <button type="button" aria-label={`删除：${asset.name}`} title="从素材库删除" onClick={() => removeLibraryAsset(asset.id)} className="rounded bg-zinc-950/80 p-1 text-zinc-400 hover:text-red-300"><Trash2 size={12} /></button>
                                </div>
                            </div>
                            <div className="px-1.5 py-1 text-[11px]">
                                {renaming === asset.id ? (
                                    <input
                                        autoFocus
                                        defaultValue={asset.name}
                                        onBlur={event => { renameLibraryAsset(asset.id, event.target.value.trim() || asset.name); setRenaming(null); }}
                                        onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') (event.target as HTMLInputElement).blur(); }}
                                        className="w-full bg-zinc-800 px-1 text-zinc-100 outline-none select-text"
                                    />
                                ) : (
                                    <div className="truncate text-zinc-200" title={asset.name} onDoubleClick={() => setRenaming(asset.id)}>{asset.name}</div>
                                )}
                                <div className="flex items-center gap-1 text-zinc-500">
                                    {asset.width > 0 && <span>{asset.width}×{asset.height}</span>}
                                    {asset.kind === 'video' && asset.duration ? <span>· {asset.duration.toFixed(1)}s</span> : null}
                                    {used > 0 && <span>· 画面上 {used} 处</span>}
                                    {asset.kind === 'image' && <button
                                        type="button"
                                        onClick={() => setTemperaAuto(asset.id, !auto)}
                                        title="允许凝彩按镜头自动取用这张图"
                                        className={cx('ml-auto rounded px-1', auto ? 'bg-amber-400/15 text-amber-300' : 'text-zinc-600 hover:text-zinc-300')}
                                    >
                                        凝彩
                                    </button>}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </DropZone>
    );
}
