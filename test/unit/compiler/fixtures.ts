// 编译器测试用的歌词：确定性的合成歌词（仓库内自带），外加 folia 的测试歌曲（FOLIA_ROOT 可用时）。
import fs from 'fs';
import path from 'path';
import type { Line, Word } from '@/core/types';
import { loadLyricFile } from '@/core/lyrics/load';

const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CJK = '春の風が吹いて君の声を思い出す夜空に光る星たち遠い街で夢を見た心の中に残る歌';
const LATIN = ['we', 'run', 'into', 'the', 'light', 'never', 'looking', 'back', 'tonight', 'hold', 'on', 'forever', 'again', 'falling'];

/**
 * 合成一首歌：段与段之间有长短不一的空隙，有逐字与逐行两种计时、中日英混排、标点、
 * 副歌标记（songPart），以及超过 6 行 / 18 秒需要切分的长段。
 */
export const syntheticSong = (seed: number, wordByWord: boolean): Line[] => {
    const random = mulberry32(seed);
    const lines: Line[] = [];
    let time = 2 + random() * 4;
    const paragraphCount = 7;
    for (let p = 0; p < paragraphCount; p += 1) {
        const count = 2 + Math.floor(random() * 7);
        const part = p % 3 === 2 ? 'Chorus' : 'Verse';
        for (let i = 0; i < count; i += 1) {
            const latin = random() < 0.35;
            const words: Word[] = [];
            let cursor = time;
            const wordCount = 2 + Math.floor(random() * 6);
            for (let w = 0; w < wordCount; w += 1) {
                const text = latin
                    ? `${LATIN[Math.floor(random() * LATIN.length)]}${w < wordCount - 1 ? ' ' : ''}`
                    : Array.from({ length: 1 + Math.floor(random() * 3) }, () => CJK[Math.floor(random() * CJK.length)]).join('');
                const duration = 0.15 + random() * 0.6;
                words.push({ text, startTime: cursor, endTime: cursor + duration });
                cursor += duration;
            }
            const punctuation = random() < 0.25 ? (latin ? '!' : '、') : '';
            if (punctuation) words[words.length - 1].text += punctuation;
            const fullText = words.map(word => word.text).join('');
            const endTime = cursor;
            lines.push({
                words: wordByWord ? words : [{ text: fullText, startTime: time, endTime }],
                startTime: time,
                endTime,
                fullText,
                songPart: part,
            });
            time = endTime + 0.05 + random() * 0.5;
        }
        time += 1 + random() * 7;
    }
    return lines;
};

export const FOLIA_ROOT = path.resolve(process.env.FOLIA_ROOT ?? path.join(__dirname, '../../../../folia-major'));

export const foliaSongs = (): Array<{ name: string; lines: Line[] }> => {
    const dir = path.join(FOLIA_ROOT, 'test/test-song');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(name => /\.(lrc|ttml|vtt)$/i.test(name))
        .map(name => ({
            name,
            lines: loadLyricFile({ fileName: name, content: fs.readFileSync(path.join(dir, name), 'utf-8') }).data.lines,
        }))
        .filter(song => song.lines.length > 0);
};
