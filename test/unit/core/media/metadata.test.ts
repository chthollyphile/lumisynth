import { describe, expect, it, vi } from 'vitest';
import type { IAudioMetadata } from 'music-metadata';
import { parseBlob } from 'music-metadata';

vi.mock('music-metadata', () => ({ parseBlob: vi.fn() }));

const { readAudioMetadata } = await import('@/core/media/metadata');
const { loadLyricFile } = await import('@/core/lyrics/load');

const mockedParseBlob = vi.mocked(parseBlob);

const metadataWith = (overrides: {
    native?: IAudioMetadata['native'];
    lyrics?: IAudioMetadata['common']['lyrics'];
}): IAudioMetadata => ({
    format: {},
    native: overrides.native ?? {},
    quality: { warnings: [] },
    common: { lyrics: overrides.lyrics },
} as unknown as IAudioMetadata);

// Mirrors the word-timed LYRICS tag found in the reported FLAC file: the line timestamp comes
// first, then every character is followed by the next character's timestamp.
const RAW_TIMED_LYRICS = [
    '[ti:永遠に違うよ。]',
    '[ar:アメリカ民謡研究会]',
    '[offset:0]',
    '',
    '[00:00.000]永[00:00.063]遠[00:00.126][00:00.127]に[00:00.158]違[00:00.221]う[00:00.253]。[00:00.316]',
    '[00:00.000]TME享有本翻译作品的著作权[00:00.790]',
    '[00:00.791]词[00:00.822]：[00:00.854]AMK',
].join('\n');

// What music-metadata's lossy LRC parser puts in common.lyrics.text: line timestamps removed.
const MANGLED_LYRICS = [
    '永[00:00.063]遠[00:00.126][00:00.127]に[00:00.158]違[00:00.221]う[00:00.253]。[00:00.316]',
    'TME享有本翻译作品的著作权[00:00.790]',
    '词[00:00.822]：[00:00.854]AMK',
].join('\n');

describe('readAudioMetadata embedded lyrics', () => {
    it('keeps the raw native timed lyrics instead of the lossy common text', async () => {
        mockedParseBlob.mockResolvedValue(metadataWith({
            native: { vorbis: [{ id: 'LYRICS', value: RAW_TIMED_LYRICS }] },
            lyrics: [{
                contentType: 1,
                timeStampFormat: 2,
                text: MANGLED_LYRICS,
                syncText: MANGLED_LYRICS.split('\n').map(text => ({ timestamp: 0, text })),
            }],
        }));

        const metadata = await readAudioMetadata(new Blob(['audio']));

        expect(metadata.embeddedLyrics).toBe(RAW_TIMED_LYRICS);
    });

    it('rebuilds line timestamps from synced entries when no raw tag exists', async () => {
        mockedParseBlob.mockResolvedValue(metadataWith({
            lyrics: [{
                contentType: 1,
                timeStampFormat: 2,
                text: MANGLED_LYRICS,
                syncText: [
                    { timestamp: 0, text: '永[00:00.063]遠[00:00.126]' },
                    { timestamp: 791, text: '词[00:00.822]：[00:00.854]AMK' },
                ],
            }],
        }));

        const metadata = await readAudioMetadata(new Blob(['audio']));

        expect(metadata.embeddedLyrics).toBe(
            '[00:00.000]永[00:00.063]遠[00:00.126]\n[00:00.791]词[00:00.822]：[00:00.854]AMK'
        );
    });

    it('keeps plain unsynced lyrics as-is', async () => {
        mockedParseBlob.mockResolvedValue(metadataWith({
            lyrics: [{ contentType: 1, timeStampFormat: 0, text: 'first line\nsecond line', syncText: [] }],
        }));

        const metadata = await readAudioMetadata(new Blob(['audio']));

        expect(metadata.embeddedLyrics).toBe('first line\nsecond line');
    });

    it('parses the recovered lyrics without dropping the first character of a line', async () => {
        mockedParseBlob.mockResolvedValue(metadataWith({
            native: { vorbis: [{ id: 'LYRICS', value: RAW_TIMED_LYRICS }] },
            lyrics: [{ contentType: 1, timeStampFormat: 2, text: MANGLED_LYRICS, syncText: [] }],
        }));

        const metadata = await readAudioMetadata(new Blob(['audio']));
        const loaded = loadLyricFile({
            fileName: 'song.flac.embedded.lrc',
            content: metadata.embeddedLyrics ?? '',
        });

        const lyrics = loaded.data.lines.filter(line => line.fullText !== '......');
        expect(loaded.format).toBe('enhanced-lrc');
        expect(lyrics[0].fullText).toBe('永遠に違う。');
        expect(lyrics[0].words[0]).toMatchObject({ text: '永', startTime: 0, endTime: 0.063 });
        // The single-timestamp translation line used to be dropped entirely.
        expect(lyrics[0].translation).toBe('TME享有本翻译作品的著作权');
    });
});
