// src/app/AssetsPanel.tsx
// 左栏「歌曲」：音频、歌词、译文、封面、歌曲信息。
import { ImageOff, Music, Subtitles, X } from 'lucide-react';
import { LYRIC_FILE_ACCEPT } from '@/core/lyrics/load';
import { clearCover, clearLyrics, importAudioFile, importCoverFile, importLyricsFile } from '@/project/actions';
import { useSession } from '@/project/session';
import { updateProject, useProjectStore } from '@/project/store';
import { useEffectiveLyrics } from './DerivedProvider';
import { DropZone } from './DropZone';
import { formatTime } from './Transport';
import { Button, Field, FileButton, inputClass, Section } from './ui';

const FORMAT_LABELS: Record<string, string> = {
    lrc: 'LRC', 'enhanced-lrc': '逐字 LRC', vtt: 'WebVTT', ttml: 'TTML', yrc: 'YRC', qrc: 'QRC', krc: 'KRC',
    awlrc: 'AWLRC', srt: 'SRT', ass: 'ASS', fia: 'Folia',
};

function FileRow({ icon, name, detail, onClear }: { icon: React.ReactNode; name: string; detail?: string; onClear?: () => void }) {
    return (
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
            <span className="text-zinc-500">{icon}</span>
            <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-zinc-200">{name}</div>
                {detail && <div className="truncate text-[11px] text-zinc-500">{detail}</div>}
            </div>
            {onClear && (
                <button type="button" onClick={onClear} className="text-zinc-500 hover:text-zinc-200" aria-label="移除">
                    <X size={14} />
                </button>
            )}
        </div>
    );
}

export function AssetsPanel() {
    const audio = useProjectStore(state => state.project.audio);
    const lyrics = useProjectStore(state => state.project.lyrics);
    const translation = useProjectStore(state => state.project.translation);
    const meta = useProjectStore(state => state.project.meta);
    const coverUrl = useSession(state => state.coverUrl);
    const audioBuffer = useSession(state => state.audioBuffer);
    const progress = useSession(state => state.analysisProgress);
    const error = useSession(state => state.error);
    const effective = useEffectiveLyrics();
    const lineCount = effective.data?.lines.filter(line => line.fullText !== '......').length ?? 0;

    return (
        <>
            <Section title="音频与歌词">
                <DropZone target="audio" label={audio ? '松开以替换音频' : '松开以导入音频'} className="space-y-2">
                {audio ? (
                    <FileRow
                        icon={<Music size={15} />}
                        name={audio.name}
                        detail={progress !== null
                            ? `分析中 ${Math.round(progress * 100)}%`
                            : audioBuffer ? `${formatTime(audioBuffer.duration)} · ${audioBuffer.sampleRate / 1000} kHz` : '解码中…'}
                    />
                ) : (
                    <div className="text-xs text-zinc-500">还没有音频。只放字幕也可以预览。</div>
                )}
                <FileButton accept="audio/*" onFile={file => void importAudioFile(file)} className="w-full">
                    <Music size={14} /> {audio ? '替换音频' : '选择音频'}
                </FileButton>
                </DropZone>

                <DropZone target="lyrics" label={lyrics ? '松开以替换歌词' : '松开以导入歌词'} className="space-y-2">
                {lyrics ? (
                    <FileRow
                        icon={<Subtitles size={15} />}
                        name={lyrics.fileName}
                        detail={effective.error
                            ? `解析失败：${effective.error}`
                            : `${FORMAT_LABELS[effective.format ?? ''] ?? effective.format} · ${lineCount} 行${effective.data?.isWordByWord ? ' · 逐字' : ''}`}
                        onClear={() => clearLyrics('lyrics')}
                    />
                ) : (
                    <div className="text-xs text-zinc-500">没有字幕时按纯音乐处理（♪）。</div>
                )}
                <FileButton accept={LYRIC_FILE_ACCEPT} onFile={file => void importLyricsFile(file)} className="w-full">
                    <Subtitles size={14} /> {lyrics ? '替换字幕' : '选择字幕'}
                </FileButton>
                </DropZone>
                {lyrics && (
                    <DropZone target="translation" label="松开以导入译文">
                    {translation ? (
                        <FileRow icon={<Subtitles size={15} />} name={translation.fileName} detail="译文" onClear={() => clearLyrics('translation')} />
                    ) : (
                        <FileButton
                            variant="ghost"
                            size="sm"
                            accept={LYRIC_FILE_ACCEPT}
                            onFile={file => void importLyricsFile(file, 'translation')}
                            className="w-full"
                        >
                            + 单独的译文文件
                        </FileButton>
                    )}
                    </DropZone>
                )}
                {effective.invalidEdits.length > 0 && (
                    <div className="rounded-md border border-amber-900/60 bg-amber-950/40 px-2 py-1.5 text-xs text-amber-200">
                        {effective.invalidEdits.length} 条歌词修改已失效（对应的行不存在或文本已变）。
                    </div>
                )}
                {error && <div className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</div>}
            </Section>

            <Section title="歌曲信息">
                <DropZone target="cover" label="松开以设为封面" className="flex gap-3">
                    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
                        {coverUrl ? (
                            <img src={coverUrl} alt="封面" className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full items-center justify-center text-zinc-600"><ImageOff size={20} /></div>
                        )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5">
                        <FileButton size="sm" accept="image/*" onFile={file => void importCoverFile(file)}>
                            {coverUrl ? '替换封面' : '选择封面'}
                        </FileButton>
                        {coverUrl && <Button size="sm" variant="ghost" onClick={clearCover}>移除封面</Button>}
                    </div>
                </DropZone>
                {(['title', 'artist', 'album'] as const).map(key => (
                    <Field key={key} label={{ title: '标题', artist: '歌手', album: '专辑' }[key]}>
                        <input
                            value={meta[key]}
                            onChange={event => updateProject(
                                p => ({ ...p, meta: { ...p.meta, [key]: event.target.value } }),
                                { coalesce: `meta.${key}` },
                            )}
                            className={inputClass}
                        />
                    </Field>
                ))}
            </Section>
        </>
    );
}
