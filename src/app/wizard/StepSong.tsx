// src/app/wizard/StepSong.tsx
// 向导第 1 步：歌曲。音频、歌词、封面（都可以拖进来），以及歌名 / 歌手（导入音频时从文件信息里带出）。
import type { ReactNode } from 'react';
import { Check, ImageIcon, Lightbulb, Music, Subtitles } from 'lucide-react';
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import { importAudioFile, importCoverFile, importLyricsFile } from '@/project/actions';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { useEffectiveLyrics } from '../DerivedProvider';
import { DropZone } from '../DropZone';
import { formatTime } from '../Transport';
import { cx, FileButton, inputClass } from '../ui';
import type { DropTarget } from '../dropImport';

function SourceCard({ target, icon, title, status, done, accept, onFile, action, dropLabel, optional }: {
    target: DropTarget;
    icon: ReactNode;
    title: string;
    status: ReactNode;
    done: boolean;
    accept: string;
    onFile: (file: File) => void;
    action: string;
    dropLabel: string;
    optional?: string;
}) {
    return (
        <DropZone target={target} label={dropLabel} className={cx('rounded-lg border p-3', done ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-dashed border-zinc-700 bg-zinc-900/40')}>
            <div className="flex items-center gap-3">
                <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', done ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>
                    {done ? <Check size={16} /> : icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 text-sm text-zinc-100">
                        {title}
                        {optional && <span className="text-[11px] text-zinc-500">{optional}</span>}
                    </div>
                    <div className="truncate text-xs text-zinc-400">{status}</div>
                </div>
                <FileButton size="sm" accept={accept} onFile={onFile}>{action}</FileButton>
            </div>
        </DropZone>
    );
}

export function StepSong() {
    const audio = useProjectStore(state => state.project.audio);
    const lyrics = useProjectStore(state => state.project.lyrics);
    const cover = useProjectStore(state => state.project.cover);
    const meta = useProjectStore(state => state.project.meta);
    const audioBuffer = useSession(state => state.audioBuffer);
    const progress = useSession(state => state.analysisProgress);
    const coverUrl = useSession(state => state.coverUrl);
    const effective = useEffectiveLyrics();
    const lineCount = effective.data?.lines.filter(line => line.fullText !== '......').length ?? 0;

    return (
        <div className="space-y-5">
            <p className="text-sm leading-relaxed text-zinc-400">
                把歌曲和歌词拖进来就行，也可以直接把两个文件一起拖到窗口任意处。只有歌词也能先做出来，之后再补音频。
            </p>
            <div className="space-y-2.5">
                <SourceCard
                    target="audio"
                    icon={<Music size={16} />}
                    title="音频"
                    done={audio !== null}
                    status={audio
                        ? `${audio.name}${progress !== null ? ` · 分析中 ${Math.round(progress * 100)}%` : audioBuffer ? ` · ${formatTime(audioBuffer.duration)}` : ''}`
                        : 'mp3 / flac / wav / m4a…'}
                    accept="audio/*"
                    onFile={file => void importAudioFile(file)}
                    action={audio ? '替换' : '选择'}
                    dropLabel="松开以导入音频"
                />
                <SourceCard
                    target="lyrics"
                    icon={<Subtitles size={16} />}
                    title="歌词"
                    done={lyrics !== null && !effective.error}
                    status={lyrics
                        ? (effective.error ? `解析失败：${effective.error}` : `${lyrics.fileName} · ${lineCount} 行${effective.data?.isWordByWord ? ' · 逐字' : ''}${effective.format === 'fia' ? ' · Folia 无损' : ''}`)
                        : '.fia / lrc / 逐字 lrc / ttml / srt…'}
                    accept={LYRIC_FILE_ACCEPT}
                    onFile={file => void importLyricsFile(file)}
                    action={lyrics ? '替换' : '选择'}
                    dropLabel="松开以导入歌词"
                />
                {effective.format !== 'fia' && (
                    <div data-testid="fia-tip" className="flex gap-2 rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
                        <Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-400" />
                        <span>
                            在 folia 里听过这首歌？用 folia 的「导入 / 导出歌词」（或命令面板里的「导出当前歌词为 .fia」）导出
                            <span className="mx-0.5 font-mono text-zinc-200">.fia</span>
                            再拖进来：这是 folia 的无损格式，逐字时间、译文和你在 folia 里保存的分词都会原样带过来。
                        </span>
                    </div>
                )}
                <SourceCard
                    target="cover"
                    icon={coverUrl ? <img src={coverUrl} alt="" className="h-9 w-9 rounded-md object-cover" /> : <ImageIcon size={16} />}
                    title="封面"
                    optional="可选"
                    done={cover !== null}
                    status={cover ? '可以用来取主题色、做背景' : '音频里带封面会自动用上'}
                    accept="image/*"
                    onFile={file => void importCoverFile(file)}
                    action={cover ? '替换' : '选择'}
                    dropLabel="松开以设为封面"
                />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
                {(['title', 'artist'] as const).map(key => (
                    <label key={key} className="space-y-1">
                        <span className="text-xs text-zinc-400">{key === 'title' ? '歌名' : '歌手'}</span>
                        <input
                            aria-label={key === 'title' ? '歌名' : '歌手'}
                            value={meta[key]}
                            placeholder={key === 'title' ? '片头与片尾会用到' : '可选'}
                            onChange={event => updateProject(p => ({ ...p, meta: { ...p.meta, [key]: event.target.value } }), { coalesce: `meta.${key}` })}
                            className={cx(inputClass, 'select-text')}
                        />
                    </label>
                ))}
            </div>
        </div>
    );
}
