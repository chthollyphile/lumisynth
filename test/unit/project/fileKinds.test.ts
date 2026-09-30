import { describe, expect, it } from 'vitest';
import { classifyFile } from '@/project/fileKinds';

const file = (name: string, type = '') => ({ name, type });

describe('classifyFile', () => {
    it('trusts lyric extensions even when the browser reports no or a generic type', () => {
        expect(classifyFile(file('song.lrc'))).toBe('lyrics');
        expect(classifyFile(file('song.ttml', 'application/xml'))).toBe('lyrics');
        expect(classifyFile(file('song.srt', 'application/x-subrip'))).toBe('lyrics');
        expect(classifyFile(file('SONG.YRC'))).toBe('lyrics');
    });

    it('recognises audio by MIME type or extension', () => {
        expect(classifyFile(file('a.mp3', 'audio/mpeg'))).toBe('audio');
        expect(classifyFile(file('a.flac'))).toBe('audio');
        expect(classifyFile(file('a.m4a', 'audio/x-m4a'))).toBe('audio');
    });

    it('splits images and videos by the types the library accepts', () => {
        expect(classifyFile(file('a.png', 'image/png'))).toBe('image');
        expect(classifyFile(file('a.webm', 'video/webm'))).toBe('video');
        expect(classifyFile(file('a.mov', 'video/quicktime'))).toBe('video');
        expect(classifyFile(file('a.bmp', 'image/bmp'))).toBe('unknown');
    });

    it('recognises projects and fonts', () => {
        expect(classifyFile(file('work.lumi', 'application/zip'))).toBe('project');
        expect(classifyFile(file('Noto.woff2'))).toBe('font');
        expect(classifyFile(file('x.otf', 'font/otf'))).toBe('font');
    });

    it('leaves everything else unknown', () => {
        expect(classifyFile(file('notes.pdf', 'application/pdf'))).toBe('unknown');
        expect(classifyFile(file('README'))).toBe('unknown');
    });
});
