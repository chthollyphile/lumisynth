// 移动布局的冒烟测试（生产构建，手机视口 + 触控）：上传 → 自动编排 → 改一段的风格包 → 导出。
import fs from 'fs';
import { expect, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

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
        const sample = Math.round(Math.sin((2 * Math.PI * 330 * i) / sampleRate) * 6000);
        buffer.writeInt16LE(sample, 44 + i * 4);
        buffer.writeInt16LE(sample, 46 + i * 4);
    }
    return buffer;
};

const LRC = [
    '[00:00.50]光と影のあいだで',
    '[00:02.40]夢を見ていた',
    '[00:04.60]君の声を探して',
    '[00:09.00]夜空に消えた星',
    '[00:11.50]もう一度だけ',
].join('\n');

test('mobile: upload, arrange, change a paragraph pack, export', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: '功能' });
    await expect(nav).toBeVisible();
    await expect(page.locator('[data-testid="stage"] canvas')).toHaveCount(1, { timeout: 30_000 });

    // 素材
    await nav.getByRole('button', { name: '素材' }).tap();
    const sheet = page.getByRole('dialog', { name: '素材' });
    await expect(sheet).toBeVisible();
    await sheet.locator('input[type="file"][accept*=".lrc"]').first().setInputFiles({ name: 'm.lrc', mimeType: 'text/plain', buffer: Buffer.from(LRC, 'utf-8') });
    await sheet.locator('input[type="file"][accept="audio/*"]').first().setInputFiles({ name: 'm.wav', mimeType: 'audio/wav', buffer: makeWav(14) });
    await expect(sheet.getByText(/0:14\.0/)).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole('button', { name: '关闭' }).tap();

    // 镜头：大纲里点第 1 段，切到「当前选中」，改成商籁。
    await nav.getByRole('button', { name: '镜头' }).tap();
    const shotSheet = page.getByRole('dialog', { name: '镜头' });
    await shotSheet.getByRole('button', { name: '全曲大纲' }).tap();
    const rows = shotSheet.getByRole('treeitem').filter({ hasText: /1\. / });
    await rows.first().tap();
    await shotSheet.getByRole('button', { name: '当前选中' }).tap();
    await shotSheet.getByRole('group', { name: '风格包' }).getByRole('button', { name: '商籁' }).tap();
    await expect.poll(() => page.evaluate(() => window.__lumi!.inspect().paragraphs[0].shots.every(shot => shot.style.startsWith('sonnet/')))).toBe(true);
    const box = await shotSheet.getByRole('button', { name: '关闭' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await shotSheet.getByRole('button', { name: '关闭' }).tap();

    // 导出：移动端默认 720p。
    await nav.getByRole('button', { name: '导出' }).tap();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('button', { name: '自定义' }).tap();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill('9');
    await endInput.fill('11');
    const downloadPromise = page.waitForEvent('download', { timeout: 100_000 });
    await dialog.getByRole('button', { name: '开始导出' }).tap();
    const bytes = fs.readFileSync(await (await downloadPromise).path());
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    expect(await (await input.getPrimaryVideoTrack())!.getDisplayHeight()).toBe(720);
    expect(errors).toEqual([]);
});
