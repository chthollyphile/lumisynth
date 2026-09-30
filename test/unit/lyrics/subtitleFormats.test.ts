import { describe, expect, it } from 'vitest';
import {
    detectSubtitleFormat,
    parseASS,
    parseAssKaraoke,
    parseSRT,
} from '@/core/lyrics/subtitleFormats';

const lyricLines = (data: ReturnType<typeof parseSRT>) => data.lines.filter(line => line.fullText !== '......');

describe('parseSRT', () => {
    const srt = [
        '1',
        '00:00:01,000 --> 00:00:03,500',
        'Hello <i>world</i>',
        '',
        '2',
        '00:00:04,000 --> 00:00:06,000',
        'second line',
        'continues here',
        '',
    ].join('\r\n');

    it('parses cues with timings and strips markup', () => {
        const lines = lyricLines(parseSRT(srt));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ startTime: 1, endTime: 3.5, fullText: 'Hello world' });
        expect(lines[0].words.map(word => word.text)).toEqual(['Hello', 'world']);
        // Only one multi-line cue out of two: not bilingual, lines are joined.
        expect(lines[1].fullText).toBe('second line continues here');
        expect(lines[1].translation).toBeUndefined();
    });

    it('splits bilingual cues into text and translation', () => {
        const bilingual = [
            '1', '00:00:01,000 --> 00:00:02,000', '君の名は', 'Your name', '',
            '2', '00:00:02,500 --> 00:00:04,000', '夢を見た', 'I had a dream', '',
        ].join('\n');
        const lines = lyricLines(parseSRT(bilingual));
        expect(lines.map(line => [line.fullText, line.translation])).toEqual([
            ['君の名は', 'Your name'],
            ['夢を見た', 'I had a dream'],
        ]);
    });
});

describe('parseASS', () => {
    const header = [
        '[Script Info]',
        'Title: test',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize',
        'Style: Default,Arial,20',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];

    it('reads karaoke syllables as word timing', () => {
        const ass = [
            ...header,
            'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\k50}今{\\k30}日{\\kf40}は{\\b1}, 晴れ',
        ].join('\n');
        const data = parseASS(ass);
        const [line] = lyricLines(data);
        expect(data.isWordByWord).toBe(true);
        expect(line.fullText).toBe('今日は, 晴れ');
        expect(line.words.map(word => [word.text, word.startTime, Number(word.endTime.toFixed(2))])).toEqual([
            ['今', 1, 1.5],
            ['日', 1.5, 1.8],
            ['は, 晴れ', 1.8, 2.2],
        ]);
    });

    it('pairs a second style as translation and keeps commas in text', () => {
        const ass = [
            ...header,
            'Dialogue: 0,0:00:01.00,0:00:03.00,JP,,0,0,0,,あいうえお, かきくけこ',
            'Dialogue: 0,0:00:01.00,0:00:03.00,CN,,0,0,0,,{\\fs16}翻译一',
            'Dialogue: 0,0:00:04.00,0:00:05.00,JP,,0,0,0,,さしすせそ\\Nたちつてと',
            'Comment: 0,0:00:06.00,0:00:07.00,JP,,0,0,0,,ignored',
        ].join('\n');
        const lines = lyricLines(parseASS(ass));
        // JP has more entries, so it is the main track.
        expect(lines.map(line => [line.fullText, line.translation])).toEqual([
            ['あいうえお, かきくけこ', '翻译一'],
            ['さしすせそ たちつてと', undefined],
        ]);
    });

    it('handles text-only override blocks between syllables', () => {
        expect(parseAssKaraoke('{\\k20}a{\\i1}b{\\k10}c')).toEqual({
            text: 'abc',
            syllables: [
                { text: 'ab', offset: 0, duration: 0.2 },
                { text: 'c', offset: 0.2, duration: 0.1 },
            ],
        });
    });
});

describe('detectSubtitleFormat', () => {
    it('uses the extension first, then sniffs content', () => {
        expect(detectSubtitleFormat('a.SRT', '')).toBe('srt');
        expect(detectSubtitleFormat('a.ssa', '')).toBe('ass');
        expect(detectSubtitleFormat('a.txt', '[Script Info]\nTitle: x')).toBe('ass');
        expect(detectSubtitleFormat(undefined, '1\n00:00:01,000 --> 00:00:02,000\nx')).toBe('srt');
        expect(detectSubtitleFormat('a.lrc', '[00:01.00]x')).toBeNull();
    });
});
