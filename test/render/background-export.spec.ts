// 背景视频的导出是逐帧精确解码的：导出后在浏览器里解码成片，色条的位置与视频时间严格对应。
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

test('exports a video background frame-accurately', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    test.setTimeout(120_000);
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack: 'sonnet' });
        // 新项目的 seed 是随机的：不固定的话每次运行的镜头、装饰都不同，成片不可复现。
        lumi.setSeed('background-video');
        // 后处理（暗角、镜头畸变）会改变画面边缘的亮度与位置，这里只验证视频帧的时间对应。
        lumi.setPostProcess(false);
        lumi.loadLyrics('bg.lrc', text);
    }, lyricText!);
    const video = await page.evaluate(() => window.__lumi!.addTestVideo('bar', 2));
    await page.evaluate(id => window.__lumi!.addBackground({ type: 'video', assetId: id, offset: 0, loop: true }, { type: 'song' }, { dim: 0, kenBurns: 0, fadeIn: 0, fadeOut: 0, blur: 0 }), video);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '导出视频' }).click();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('button', { name: '720p' }).click();
    await dialog.getByRole('button', { name: 'WebM' }).click().catch(() => undefined);
    await dialog.getByRole('button', { name: '自定义' }).click();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill('10');
    await endInput.fill('11');
    const downloadPromise = page.waitForEvent('download', { timeout: 100_000 });
    await dialog.getByRole('button', { name: '开始导出' }).click();
    const bytes = fs.readFileSync(await (await downloadPromise).path());

    // 成片的第 t 秒 = 歌曲第 10 + t 秒 = 视频第 t 秒（2 秒一循环，60 帧，色条 40px 宽、每帧右移 280 / 60 px，画面 320px 宽）。
    const expected = (t: number) => ((Math.floor(t * 30 + 1e-6) / 60) * 280 + 20) / 320;
    const times = [0.01, 0.045, 0.078, 0.111, 0.145, 0.178, 0.3, 0.55, 0.8];
    const positions = await page.evaluate(({ base64, at }) => window.__lumi!.probeBar(base64, at), { base64: bytes.toString('base64'), at: times });
    positions.forEach((position, index) => {
        expect(position, `t = ${times[index]}`).not.toBeNull();
        expect(Math.abs(position! - expected(times[index])), `t = ${times[index]}：${position}`).toBeLessThan(0.01);
    });
});
