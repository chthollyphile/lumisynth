// 素材层级「场景之上、歌词之下」：盖在场景图形上，被歌词盖住；不跟随运镜时屏幕上的位置不受镜头影响。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;
const COLOR = '#ff00ff';

const centroid = async (page: Page, time: number) => {
    const result = await page.evaluate(([color, t]) => window.__lumi!.colorCentroid(color as string, t as number), [COLOR, time]);
    return result ?? { x: 0, y: 0, count: 0 };
};

for (const pack of ['tempera', 'sonnet', 'lumiere', 'hanabi'] as const) {
    test(`${pack}: the mid slot sits above the scene graphics and under the lyrics`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
        await page.goto('/?resolution=1');
        await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
        await page.evaluate(({ text, pack }) => {
            const lumi = window.__lumi!;
            lumi.setDirection({ mode: 'single', pack });
            lumi.setSeed('mid-slot');
            lumi.setPostProcess(false);
            lumi.patchTuning(pack, { cameraIntensity: 2 });
            lumi.loadLyrics('mid.lrc', text);
        }, { text: lyricText!, pack });
        const image = await page.evaluate(color => window.__lumi!.addTestImage('mark', color), COLOR);
        // 一大块盖住画面中间（歌词在那里），一小块放在角上（不和歌词重叠）。
        const big = await page.evaluate(id => window.__lumi!.addClip(id, {
            timing: { type: 'song' }, slot: 'front', x: 0.5, y: 0.75, scale: 3.2,
            enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 },
        }), image);
        await page.waitForTimeout(500);
        const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs
            .flatMap(paragraph => paragraph.shots)
            .find(item => item.startTime > 5 && item.endTime - item.startTime > 2.5)!);

        // 在镜头里取几个时刻（避开镜头边界的短转场）：每个时刻「歌词之下」都不比「歌词之上」多，
        // 有字的时刻严格更少（字盖住了它）；凝彩的色块不透明，「场景之下」被盖住得更多。
        const times = [0.2, 0.35, 0.5, 0.65, 0.8].map(k => shot.startTime + (shot.endTime - shot.startTime) * k);
        const counts: Record<string, number[]> = {};
        for (const slot of ['back', 'mid', 'front'] as const) {
            await page.evaluate(([id, s]) => window.__lumi!.updateClip(id, { slot: s }), [big, slot]);
            counts[slot] = [];
            for (const time of times) counts[slot].push((await centroid(page, time)).count);
        }
        counts.mid.forEach((count, i) => {
            expect(count).toBeGreaterThan(0);
            expect(count).toBeLessThanOrEqual(counts.front[i]);
        });
        expect(counts.mid.some((count, i) => count < counts.front[i])).toBe(true);
        if (pack === 'tempera') expect(counts.back.some((count, i) => count < counts.mid[i])).toBe(true);
        const late = times[3];

        // 小块放在角上：不跟随运镜时，放在镜头里面也和放在场景之上一样纹丝不动。
        await page.evaluate(id => window.__lumi!.updateClip(id, { x: 0.93, y: 0.1, scale: 0.08 }), big);
        for (const time of [shot.startTime + (shot.endTime - shot.startTime) * 0.3, late]) {
            await page.evaluate(id => window.__lumi!.updateClip(id, { slot: 'front' }), big);
            const front = await centroid(page, time);
            await page.evaluate(id => window.__lumi!.updateClip(id, { slot: 'mid' }), big);
            const mid = await centroid(page, time);
            expect(front.count).toBeGreaterThan(50);
            expect(Math.hypot(mid.x - front.x, mid.y - front.y), `t = ${time}`).toBeLessThan(1);
            expect(Math.abs(mid.count - front.count) / front.count).toBeLessThan(0.05);
        }
    });
}
