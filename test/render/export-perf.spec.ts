// 导出速度记录（平时跳过；LUMI_PERF=1 时跑）：走导出对话框，把同一段 5 秒按 4K / 1080p、30fps 导出，
// 记录各包的耗时与实时倍率。用真实 GPU（覆盖默认的 swiftshader），结果写进 test-results/export-perf.json。
//   LUMI_PERF=1 npx playwright test test/render/export-perf.spec.ts --project=lumisynth
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;
const START = 20;
const SECONDS = 5;

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] } });

const importTone = (page: Page) => page.evaluate(async () => {
    const sampleRate = 48000;
    const seconds = 40;
    const context = new OfflineAudioContext(2, sampleRate * seconds, sampleRate);
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 110;
    oscillator.connect(context.destination);
    oscillator.start();
    const rendered = await context.startRendering();
    const data = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + data.length * 4);
    const view = new DataView(buffer);
    const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + data.length * 4, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); write(36, 'data');
    view.setUint32(40, data.length * 4, true);
    data.forEach((value, i) => {
        const sample = Math.max(-1, Math.min(1, value)) * 32767 * 0.3;
        view.setInt16(44 + i * 4, sample, true);
        view.setInt16(46 + i * 4, sample, true);
    });
    const debug = (window as unknown as { __lumiDebug: { actions: { importAudioFile: (file: File) => Promise<void> } } }).__lumiDebug;
    await debug.actions.importAudioFile(new File([buffer], 'tone.wav', { type: 'audio/wav' }));
});

test('export speed per pack at 4K and 1080p', async ({ page }) => {
    test.skip(!process.env.LUMI_PERF, '只在 LUMI_PERF=1 时跑');
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    test.setTimeout(900_000);
    await page.goto('/');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    const gpu = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
    });
    await page.evaluate(text => {
        window.__lumi!.loadLyrics('perf.lrc', text);
        window.__lumi!.setMeta({ title: 'perf' });
    }, lyricText!);
    await page.waitForFunction(() => Boolean((window as unknown as { __lumiDebug?: unknown }).__lumiDebug));
    await importTone(page);

    const results: Array<{ pack: string; resolution: string; seconds: number; realtime: number; size: string; megabytes: number; duration: number }> = [];
    for (const pack of ['lumiere', 'tempera', 'sonnet']) {
        await page.evaluate(id => window.__lumi!.setDirection({ mode: 'single', pack: id }), pack);
        await page.waitForTimeout(800);
        for (const resolution of ['4K', '1080p']) {
            const dialog = page.getByTestId('export-dialog');
            if (!(await dialog.isVisible())) await page.getByRole('button', { name: '导出视频' }).click();
            await expect(dialog).toBeVisible();
            await dialog.getByRole('button', { name: resolution, exact: true }).click();
            await dialog.getByRole('button', { name: '自定义' }).click();
            const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
            await startInput!.fill(String(START));
            await endInput!.fill(String(START + SECONDS));
            const downloadPromise = page.waitForEvent('download', { timeout: 850_000 });
            const begin = Date.now();
            await dialog.getByRole('button', { name: '开始导出' }).click();
            const download = await downloadPromise;
            const seconds = (Date.now() - begin) / 1000;
            // 核对产物：确实是整段、确实是这个分辨率（不是提前结束）。
            const bytes = fs.readFileSync(await download.path());
            const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
            const video = (await input.getPrimaryVideoTrack())!;
            const size = `${await video.getDisplayWidth()}x${await video.getDisplayHeight()}`;
            const duration = await input.computeDuration();
            expect(duration).toBeGreaterThan(SECONDS - 0.1);
            await download.delete();
            results.push({ pack, resolution, seconds, realtime: SECONDS / seconds, size, megabytes: bytes.length / 2 ** 20, duration });
            await expect(dialog.getByText('已导出')).toBeVisible();
            // 换包要关掉对话框（它盖住了预览）。
            await page.keyboard.press('Escape');
        }
    }
    const report = { gpu, clip: `${START}s–${START + SECONDS}s @ 30fps`, results };
    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/export-perf.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
});
