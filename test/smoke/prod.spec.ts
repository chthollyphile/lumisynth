// 生产构建的冒烟测试：通过真实的文件输入框上传字幕与音频（音频走 Worker 解码与分析），
// 预览能渲染、能导出、导出的文件能被解析。
import fs from 'fs';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

const makeWav = (seconds: number, sampleRate = 44100) => {
    const frames = seconds * sampleRate;
    const buffer = Buffer.alloc(44 + frames * 4);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + frames * 4, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(2, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 4, 28);
    buffer.writeUInt16LE(4, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(frames * 4, 40);
    for (let i = 0; i < frames; i += 1) {
        const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 8000);
        buffer.writeInt16LE(sample, 44 + i * 4);
        buffer.writeInt16LE(sample, 46 + i * 4);
    }
    return buffer;
};

const LRC = [
    '[ti:smoke]',
    '[00:00.50]光と影のあいだで',
    '[00:02.40]夢を見ていた',
    '[00:04.60]君の声を探して',
    '[00:07.00]夜空に消えた星',
    '[00:09.50]もう一度だけ',
].join('\n');

test('upload, preview and export with the production build', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByText('lumisynth').first()).toBeVisible();
    await expect(page.locator('[data-testid="stage"] canvas')).toHaveCount(1, { timeout: 30_000 });

    await page.locator('input[type="file"][accept*=".lrc"]').first().setInputFiles({
        name: 'smoke.lrc', mimeType: 'text/plain', buffer: Buffer.from(LRC, 'utf-8'),
    });
    await expect(page.getByText('smoke.lrc')).toBeVisible();
    await expect(page.getByText(/LRC · 5 行/)).toBeVisible();

    await page.locator('input[type="file"][accept="audio/*"]').first().setInputFiles({
        name: 'tone.wav', mimeType: 'audio/wav', buffer: makeWav(12),
    });
    // 解码后显示时长与采样率；分析在 Worker 里跑完后「分析中」消失。
    await expect(page.getByText(/0:12\.0 · 48 kHz/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/分析中/)).toHaveCount(0, { timeout: 30_000 });

    await page.getByRole('button', { name: '导出视频' }).click();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('button', { name: '720p' }).click();
    await dialog.getByRole('button', { name: '自定义' }).click();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill('1');
    await endInput.fill('3');
    const downloadPromise = page.waitForEvent('download', { timeout: 100_000 });
    await dialog.getByRole('button', { name: '开始导出' }).click();
    const bytes = fs.readFileSync(await (await downloadPromise).path());
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    expect(await (await input.getPrimaryVideoTrack())!.getDisplayWidth()).toBe(1280);
    expect(await input.getPrimaryAudioTrack()).not.toBeNull();
    const duration = await input.computeDuration();
    expect(duration).toBeGreaterThan(1.9);
    expect(duration).toBeLessThan(2.2);

    expect(errors).toEqual([]);
});
