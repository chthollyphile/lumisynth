// src/app/export/ExportDialog.tsx
// 导出视频对话框：分辨率、帧率、格式、画质、范围；进度与取消。
import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import {
    ExportCancelled,
    exportVideo,
    supportsWebCodecs,
    type ExportFormat,
    type ExportProgress,
    type ExportQuality,
    type ExportResult,
} from '@/export/exporter';
import { buildProjectExportInput, exportFileName, exportSizeFor } from '@/export/projectExport';
import { exportLayered, groupName, groupsFromSplits, LAYER_LABELS, LAYER_PRESETS, splitsFromGroups, type LayeredResult, type SeparateEffect } from '@/export/layered';
import { KERNEL_LAYERS } from '@/kernel/layerIds';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { isMobileLayoutNow } from '../mobile/uiMode';
import { downloadBlob } from '../download';
import { backdrop, overlay, popIn, popTransition, presence } from '../motion';
import { log } from '../output';
import { pause, usePlayback } from '../playback';
import { formatTime, useProjectDuration } from '../Transport';
import { Button, Field, inputClass, Segmented, Toggle } from '../ui';

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openExportDialog = () => {
    pause();
    useExportDialog.setState({ open: true });
};

const SHORT_SIDES = [720, 1080, 1440, 2160] as const;

/** 导出结果、错误提示出现时轻轻落下。 */
const resultIn = { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.2 } } as const;

const formatBytes = (bytes: number) => (bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`);

export function ExportDialog() {
    const open = useExportDialog(state => state.open);
    return <AnimatePresence>{open && <ExportDialogBody />}</AnimatePresence>;
}

function ExportDialogBody() {
    const project = useProjectStore(state => state.project);
    const program = useProgram();
    const session = useSession();
    const duration = useProjectDuration();
    const playheadTime = usePlayback(state => state.time);

    // 移动端默认 720p：编码器与内存都更吃紧。
    const [shortSide, setShortSide] = useState<number>(() => (isMobileLayoutNow() ? 720 : 1080));
    const [fps, setFps] = useState(30);
    const [format, setFormat] = useState<ExportFormat>('mp4');
    const [quality, setQuality] = useState<ExportQuality>('high');
    const [range, setRange] = useState<'all' | 'custom'>('all');
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(duration);
    const [progress, setProgress] = useState<ExportProgress | null>(null);
    const [result, setResult] = useState<ExportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const controller = useRef<AbortController | null>(null);
    // 分层导出
    const [mode, setMode] = useState<'single' | 'layered'>('single');
    const [preset, setPreset] = useState<'two' | 'four' | 'custom'>('two');
    const [splits, setSplits] = useState<Set<number>>(() => splitsFromGroups(LAYER_PRESETS.two));
    const [postTarget, setPostTarget] = useState<'top' | 'none' | number>('top');
    const [separate, setSeparate] = useState<Set<SeparateEffect>>(new Set());
    const [layeredResult, setLayeredResult] = useState<LayeredResult | null>(null);
    const groups = preset === 'custom' ? groupsFromSplits(splits) : LAYER_PRESETS[preset];
    const resolvedPostTarget = postTarget === 'none' ? null : postTarget === 'top' ? groups.length - 1 : Math.min(postTarget, groups.length - 1);
    const postProcess = project.tuning.kernel.postProcess;

    const { width, height } = exportSizeFor(project, shortSide);
    const from = range === 'all' ? 0 : Math.max(0, Math.min(start, duration));
    const to = range === 'all' ? duration : Math.max(from + 0.5, Math.min(end, duration));
    const running = progress !== null && result === null && layeredResult === null && error === null;

    useEffect(() => () => controller.current?.abort(), []);

    // Esc 关闭（导出进行中不关，免得误触丢掉进度）。
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !running) useExportDialog.setState({ open: false });
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running]);

    const close = () => {
        controller.current?.abort();
        useExportDialog.setState({ open: false });
    };

    const start_ = async () => {
        setError(null);
        setResult(null);
        setLayeredResult(null);
        const abort = new AbortController();
        controller.current = abort;
        setProgress({ phase: 'preparing', frame: 0, totalFrames: 1, elapsed: 0, remaining: null });
        try {
            if (mode === 'layered') {
                const output = await exportLayered(
                    buildProjectExportInput(project, program, session),
                    { width, height, fps, format, quality, start: from, end: to },
                    { groups, postTarget: resolvedPostTarget, separateEffects: [...separate] },
                    setProgress,
                    abort.signal,
                );
                setLayeredResult(output);
                downloadBlob(output.blob, exportFileName(project, 'layers.zip'));
                log(`分层导出完成：${groups.length} 层${separate.size ? ` + ${separate.size} 个效果层` : ''}，${formatBytes(output.blob.size)}${output.alphaMethod === 'png-sequence' ? '（透明层为 PNG 序列）' : ''}`);
                return;
            }
            const output = await exportVideo(
                buildProjectExportInput(project, program, session),
                { width, height, fps, format, quality, start: from, end: to },
                setProgress,
                abort.signal,
            );
            setResult(output);
            downloadBlob(output.blob, exportFileName(project, output.extension));
            log(`导出完成：${width}×${height} ${fps}fps ${output.videoCodec}${output.audioCodec ? ` + ${output.audioCodec}` : ''}，${formatBytes(output.blob.size)}`);
        } catch (reason) {
            if (reason instanceof ExportCancelled) {
                setProgress(null);
                log('导出已取消', 'warn');
                return;
            }
            const message = (reason as Error).message;
            setError(message);
            log(`导出失败：${message}`, 'error');
        }
    };

    const percent = progress ? Math.round((progress.frame / Math.max(1, progress.totalFrames)) * 100) : 0;

    return (
        <motion.div {...presence} variants={overlay} className="no-drag fixed inset-0 z-50 flex items-center justify-center">
            <motion.div variants={backdrop} transition={popTransition} className="absolute inset-0 bg-black/60" onMouseDown={() => { if (!running) close(); }} />
            <motion.div
                data-testid="export-dialog"
                role="dialog"
                aria-label="导出视频"
                variants={popIn}
                transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                className="relative flex max-h-[calc(100vh-32px)] w-[min(460px,calc(100vw-32px))] flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl"
            >
                <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2.5">
                    <h2 className="text-sm font-semibold text-zinc-100">导出视频</h2>
                    <button type="button" onClick={close} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="关闭"><X size={15} /></button>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                    {!supportsWebCodecs() && (
                        <div className="rounded-md bg-amber-950/50 px-2 py-1.5 text-xs text-amber-200">
                            这个浏览器不支持 WebCodecs，将实时播放一遍并录制（webm，耗时等于视频时长）。
                        </div>
                    )}
                    {isMobileLayoutNow() && shortSide > 1080 && (
                        <div className="rounded-md bg-amber-950/50 px-2 py-1.5 text-xs text-amber-200">
                            在手机或平板上导出 1440p 以上可能因为内存不足而失败，建议 720p 或 1080p。
                        </div>
                    )}
                    <Field label={`分辨率（${project.aspect}）`}>
                        <Segmented<string>
                            value={String(shortSide)}
                            onChange={value => setShortSide(Number(value))}
                            options={SHORT_SIDES.map(side => ({ value: String(side), label: side === 2160 ? '4K' : `${side}p` }))}
                        />
                        <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">{width} × {height}</div>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="帧率">
                            <Segmented<string> value={String(fps)} onChange={value => setFps(Number(value))} options={[24, 30, 60].map(value => ({ value: String(value), label: String(value) }))} />
                        </Field>
                        <Field label="格式">
                            <Segmented<ExportFormat> value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }]} />
                        </Field>
                    </div>
                    <Field label="画质">
                        <Segmented<ExportQuality> value={quality} onChange={setQuality} options={[{ value: 'medium', label: '标准' }, { value: 'high', label: '高' }, { value: 'very-high', label: '很高' }]} />
                    </Field>
                    <Field label="范围">
                        <Segmented<'all' | 'custom'> value={range} onChange={setRange} options={[{ value: 'all', label: `整首（${formatTime(duration)}）` }, { value: 'custom', label: '自定义' }]} />
                        {range === 'custom' && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="text-[11px] text-zinc-500">开始（秒）
                                    <input type="number" step={0.1} value={start} onChange={event => setStart(Number(event.target.value))} className={inputClass} />
                                </label>
                                <label className="text-[11px] text-zinc-500">结束（秒）
                                    <input type="number" step={0.1} value={end} onChange={event => setEnd(Number(event.target.value))} className={inputClass} />
                                </label>
                                <Button size="sm" variant="ghost" onClick={() => setStart(Number(playheadTime.toFixed(2)))}>开始 = 播放头</Button>
                                <Button size="sm" variant="ghost" onClick={() => setEnd(Number(playheadTime.toFixed(2)))}>结束 = 播放头</Button>
                            </div>
                        )}
                    </Field>
                    <Field label="输出">
                        <Segmented<'single' | 'layered'> value={mode} onChange={setMode} options={[{ value: 'single', label: '合成（一个文件）' }, { value: 'layered', label: '分层（zip）' }]} />
                    </Field>
                    {mode === 'layered' && (
                        <div className="space-y-2 rounded-md border border-zinc-800 p-2">
                            <Segmented<'two' | 'four' | 'custom'>
                                value={preset}
                                onChange={value => {
                                    setPreset(value);
                                    if (value !== 'custom') setSplits(splitsFromGroups(LAYER_PRESETS[value]));
                                }}
                                options={[{ value: 'two', label: '背景 / 歌词动画' }, { value: 'four', label: '四层' }, { value: 'custom', label: '自定义' }]}
                            />
                            {preset === 'custom' ? (
                                <div className="text-[11px]">
                                    {KERNEL_LAYERS.map((layer, index) => (
                                        <div key={layer}>
                                            <div className="text-zinc-300">{LAYER_LABELS[layer]}</div>
                                            {index < KERNEL_LAYERS.length - 1 && (
                                                <label className="flex cursor-pointer items-center gap-1.5 py-0.5 pl-3 text-zinc-500">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`在「${LAYER_LABELS[layer]}」之后分开`}
                                                        checked={splits.has(index)}
                                                        onChange={event => {
                                                            const next = new Set(splits);
                                                            if (event.target.checked) next.add(index);
                                                            else next.delete(index);
                                                            setSplits(next);
                                                        }}
                                                        className="accent-amber-400"
                                                    />
                                                    {splits.has(index) ? '——— 分开成下一个文件 ———' : '合在同一个文件'}
                                                </label>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            <ol className="space-y-0.5 text-[11px] text-zinc-400">
                                {groups.map((group, index) => (
                                    <li key={index}>{index + 1}. {groupName(group)}{index === 0 ? '（不透明）' : '（带透明）'}</li>
                                ))}
                            </ol>
                            {postProcess.enabled && (
                                <>
                                    <Field label="后处理（颗粒、暗角、镜头畸变…）加在">
                                        <select
                                            aria-label="后处理加在"
                                            value={postTarget === 'top' ? 'top' : postTarget === 'none' ? 'none' : String(postTarget)}
                                            onChange={event => setPostTarget(event.target.value === 'top' || event.target.value === 'none' ? event.target.value : Number(event.target.value))}
                                            className={inputClass}
                                        >
                                            <option value="top">最上面一层（{groupName(groups.at(-1)!)}）</option>
                                            {groups.slice(0, -1).map((group, index) => <option key={index} value={index}>第 {index + 1} 层（{groupName(group)}）</option>)}
                                            <option value="none">不加（留给剪辑软件）</option>
                                        </select>
                                    </Field>
                                    {(['vignette', 'grain'] as SeparateEffect[]).filter(effect => postProcess[effect] > 0).map(effect => (
                                        <Toggle
                                            key={effect}
                                            label={effect === 'vignette' ? '暗角单独导出一层（普通混合）' : '颗粒单独导出一层（线性光 50%）'}
                                            checked={separate.has(effect)}
                                            onChange={checked => {
                                                const next = new Set(separate);
                                                if (checked) next.add(effect);
                                                else next.delete(effect);
                                                setSeparate(next);
                                            }}
                                        />
                                    ))}
                                </>
                            )}
                            <div className="text-[11px] text-zinc-500">
                                每层一个文件，同尺寸、同时长，按编号从下到上叠放即可；另附整段音频（WAV）与说明。文字与场景图形分开时，凝彩的文字反色会关闭。
                            </div>
                        </div>
                    )}
                    {!session.audioBuffer && <div className="text-[11px] text-zinc-500">没有音频：导出的视频没有声音。</div>}

                    {progress && (
                        <div className="space-y-1">
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                                <div className="h-full bg-amber-400 transition-[width]" style={{ width: `${progress.phase === 'finalizing' ? 100 : percent}%` }} />
                            </div>
                            <div className="flex justify-between text-[11px] text-zinc-400 tabular-nums">
                                <span>
                                    {progress.phase === 'preparing' && '准备中…'}
                                    {progress.phase === 'rendering' && `渲染 ${progress.frame} / ${progress.totalFrames} 帧`}
                                    {progress.phase === 'finalizing' && '封装中…'}
                                </span>
                                <span>{progress.remaining !== null && progress.phase === 'rendering' ? `剩余约 ${formatTime(progress.remaining)}` : ''}</span>
                            </div>
                        </div>
                    )}
                    {layeredResult && (
                        <motion.div {...resultIn} className="rounded-md bg-emerald-950/50 px-2 py-1.5 text-xs text-emerald-200">
                            已导出 {formatBytes(layeredResult.blob.size)} 的 zip（{layeredResult.files.length} 个文件{layeredResult.alphaMethod === 'png-sequence' ? '，透明层为 PNG 序列' : ''}），浏览器已开始下载。
                        </motion.div>
                    )}
                    {result && (
                        <motion.div {...resultIn} className="rounded-md bg-emerald-950/50 px-2 py-1.5 text-xs text-emerald-200">
                            已导出 {formatBytes(result.blob.size)}（{result.videoCodec}{result.audioCodec ? ` + ${result.audioCodec}` : ''}），浏览器已开始下载。
                        </motion.div>
                    )}
                    {error && <motion.div {...resultIn} className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</motion.div>}
                </div>
                <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
                    {running
                        ? <Button variant="danger" onClick={() => controller.current?.abort()}>取消导出</Button>
                        : <Button onClick={close}>关闭</Button>}
                    <Button variant="primary" disabled={running} onClick={() => void start_()}>
                        <Download size={14} /> {result || layeredResult ? '再导出一次' : '开始导出'}
                    </Button>
                </footer>
            </motion.div>
        </motion.div>
    );
}
