// 端到端导出：打开导出对话框，按 720p / 30fps 导出前 3 秒，解析产物核对时长、尺寸与轨道。
import fs from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

test('exports a clip with the dialog', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    test.setTimeout(120_000);
    await page.goto('/');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        window.__lumi!.loadLyrics('export.lrc', text);
        window.__lumi!.setMeta({ title: 'export-test' });
    }, lyricText!);
    // 合成 20 秒的音频，走真实的导入 → 解码 → 分析流程（开发模式的调试句柄）。
    await page.waitForFunction(() => Boolean((window as unknown as { __lumiDebug?: unknown }).__lumiDebug));
    await page.evaluate(async () => {
        const sampleRate = 48000;
        const seconds = 20;
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

    await page.getByRole('button', { name: '导出视频' }).click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '720p' }).click();
    await dialog.getByRole('button', { name: '自定义' }).click();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill('10');
    await endInput.fill('13');

    const downloadPromise = page.waitForEvent('download', { timeout: 110_000 });
    await dialog.getByRole('button', { name: '开始导出' }).click();
    const download = await downloadPromise;
    const file = await download.path();
    const bytes = fs.readFileSync(file);
    expect(bytes.length).toBeGreaterThan(10_000);

    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    expect(video).not.toBeNull();
    expect(await video!.getDisplayWidth()).toBe(1280);
    expect(await video!.getDisplayHeight()).toBe(720);
    const audio = await input.getPrimaryAudioTrack();
    expect(audio).not.toBeNull();
    expect(await audio!.getSampleRate()).toBe(48000);
    const duration = await input.computeDuration();
    expect(duration).toBeGreaterThan(2.9);
    expect(duration).toBeLessThan(3.2);
    await expect(dialog.getByText('已导出')).toBeVisible();
});
