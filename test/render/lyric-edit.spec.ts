// 改字之后两个包都照常渲染：改过的行拆成新的计时单元，逐帧画得出来、没有报错，挂在行上的编排不失效。
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

for (const pack of ['tempera', 'sonnet'] as const) {
    test(`edited lyric lines render in ${pack}`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('/?resolution=1');
        await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
        await page.evaluate(({ text, pack }) => {
            const lumi = window.__lumi!;
            lumi.setDirection({ mode: 'single', pack });
            lumi.setSeed('lyric-edit');
            lumi.loadLyrics('edit.lrc', text);
        }, { text: lyricText!, pack });
        await page.waitForTimeout(500);
        const before = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3]);

        // 第 4 段每一行都改字（加字、换字），并把这一段交给另一个包（挂在段首行上）。
        await page.evaluate(async ({ lines, other }) => {
            const debug = (window as unknown as { __lumiDebug: { store: Promise<{ useProjectStore: { getState: () => { update: (recipe: (project: any) => any) => void; project: any } } }> } }).__lumiDebug;
            const { useProjectStore } = await debug.store;
            const project = useProjectStore.getState().project;
            const hash = (text: string) => {
                let value = 0x811c9dc5;
                for (let i = 0; i < text.length; i += 1) {
                    value ^= text.charCodeAt(i);
                    value = Math.imul(value, 16777619);
                }
                return (value >>> 0).toString(16).padStart(8, '0');
            };
            useProjectStore.getState().update(current => ({
                ...current,
                paragraphDirections: [{ anchor: { line: { index: lines[0].index, hash: hash(lines[0].text) } }, pack: other, source: 'user' }],
                lyricEdits: {
                    ...project.lyricEdits,
                    lines: lines.map(line => ({ anchor: { index: line.index, hash: hash(line.text) }, text: `新${line.text.slice(1)}ですね` })),
                },
            }));
        }, { lines: before.lines.map((index, i) => ({ index, text: before.texts[i] })), other: pack === 'tempera' ? 'sonnet' : 'tempera' });
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3]);
        expect(after.lines).toEqual(before.lines);
        expect(after.texts).toEqual(before.texts.map(text => `新${text.slice(1)}ですね`));
        expect(after.pack).toBe(pack === 'tempera' ? 'sonnet' : 'tempera');

        // 逐帧走一遍这一段。
        for (let t = after.startTime; t < after.endTime; t += (after.endTime - after.startTime) / 12) {
            await page.evaluate(time => { window.__lumi!.seek(time); window.__lumi!.renderOnce(); }, t);
        }
        expect(errors).toEqual([]);
    });
}
