// src/core/media/metadata.ts
// 从音频文件读标签：标题、歌手、专辑、封面、内嵌歌词（USLT / LYRICS）。
import { parseBlob, type IAudioMetadata, type ILyricsTag } from 'music-metadata';

export interface AudioFileMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
    duration: number | null;
    cover: Blob | null;
    /** 内嵌的歌词文本（可能是 LRC，也可能是纯文本）。 */
    embeddedLyrics: string | null;
}

const EMPTY: AudioFileMetadata = {
    title: null, artist: null, album: null, duration: null, cover: null, embeddedLyrics: null,
};

const TIMED_LYRICS_REGEX = /\[\d{1,3}:\d{1,2}[.:]\d{1,3}\]/;
// Vorbis (FLAC/Ogg), ID3, MP4, APE and ASF all carry lyrics under different ids.
const NATIVE_LYRICS_TAG_IDS = new Set([
    'lyrics', 'unsyncedlyrics', 'syncedlyrics', 'uslt', 'ult', 'sylt', '©lyr', 'wm/lyrics',
]);

const nativeLyricsValue = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const text = (value as { text?: unknown }).text;
        if (typeof text === 'string') return text;
    }
    return null;
};

// `common.lyrics` is lossy for timed tags: music-metadata parses LRC-style values and drops the
// line timestamp of every line, which breaks word-timed lyrics (and drops lines with a single
// timestamp). The native tag still holds the original text, so prefer it.
const readNativeLyrics = (native: IAudioMetadata['native']): string | null => {
    let untimed: string | null = null;
    for (const tags of Object.values(native)) {
        for (const tag of tags) {
            if (!NATIVE_LYRICS_TAG_IDS.has(tag.id.toLowerCase())) continue;
            const value = nativeLyricsValue(tag.value);
            if (!value?.trim()) continue;
            if (TIMED_LYRICS_REGEX.test(value)) return value;
            untimed ??= value;
        }
    }
    return untimed;
};

const formatLrcTimestamp = (milliseconds: number): string => {
    const total = Math.max(0, Math.round(milliseconds));
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}]`;
};

// Fallback when no raw native tag is available: rebuild LRC from the parsed sync entries so the
// line timestamps survive. `timeStampFormat` 2 means milliseconds.
const readCommonLyrics = (lyrics: ILyricsTag[] | undefined): string | null => {
    for (const tag of lyrics ?? []) {
        const synced = tag.timeStampFormat === 2
            ? tag.syncText?.filter(entry => entry.text.trim())
            : [];
        if (synced?.length) {
            return synced.map(entry => `${formatLrcTimestamp(entry.timestamp ?? 0)}${entry.text}`).join('\n');
        }
        if (tag.text?.trim()) return tag.text;
    }
    return null;
};

export const readAudioMetadata = async (file: Blob): Promise<AudioFileMetadata> => {
    try {
        const metadata = await parseBlob(file, { skipCovers: false, duration: false });
        const { common, format, native } = metadata;
        const picture = common.picture?.[0];
        const lyrics = readNativeLyrics(native) ?? readCommonLyrics(common.lyrics);
        return {
            title: common.title ?? null,
            artist: common.artist ?? common.artists?.join(' / ') ?? null,
            album: common.album ?? null,
            duration: format.duration ?? null,
            cover: picture ? new Blob([picture.data as BlobPart], { type: picture.format || 'image/jpeg' }) : null,
            embeddedLyrics: lyrics,
        };
    } catch {
        return EMPTY;
    }
};
