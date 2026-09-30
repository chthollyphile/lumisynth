// 分层导出：导出的各层按编号叠回去，与合成导出的同一帧一致（只差编码误差）；带透明的层确实透明。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

const exportOnce = async (page: Page, configure: (dialog: ReturnType<Page['getByTestId']>) => Promise<void>) => {
    await page.getByRole('button', { name: '导出视频' }).click();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('button', { name: '720p' }).click();
    await dialog.getByRole('button', { name: 'WebM' }).click();
    await dialog.getByRole('button', { name: '自定义' }).click();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill('24');
    await endInput.fill('25');
    await configure(dialog);
    const downloadPromise = page.waitForEvent('download', { timeout: 110_000 });
    await dialog.getByRole('button', { name: /开始导出|再导出一次/ }).click();
    const bytes = fs.readFileSync(await (await downloadPromise).path());
    await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
    return bytes.toString('base64');
};

const setup = async (page: Page, pack: 'tempera' | 'sonnet' | 'lumiere') => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(({ text, pack }) => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack });
        lumi.setSeed('layers');
        lumi.loadLyrics('layers.lrc', text);
    }, { text: lyricText!, pack });
    const image = await page.evaluate(() => window.__lumi!.addTestImage('logo', '#e11d48'));
    await page.evaluate(id => {
        const lumi = window.__lumi!;
        lumi.addBackground({ type: 'gradient', from: '#1e1b4b', to: '#115e59', angle: 40 }, { type: 'song' }, { dim: 0, kenBurns: 0, fadeIn: 0 });
        lumi.addClip(id, { timing: { type: 'song' }, slot: 'front', x: 0.82, y: 0.7, scale: 0.3, enter: { type: 'none', duration: 0 } });
    }, image);
    await page.waitForTimeout(500);
};

test('four layers stack back to the composite (tempera, no post-processing)', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    test.setTimeout(240_000);
    await setup(page, 'tempera');
    // 合成里关掉反色与后处理：分层导出时它们一个被关、一个只加在一层上，比较要在同样的条件下。
    await page.evaluate(() => {
        window.__lumi!.setPostProcess(false);
        window.__lumi!.patchTuning('tempera', { textInversion: false });
    });
    const composite = await exportOnce(page, async () => undefined);
    const layered = await exportOnce(page, async dialog => {
        await dialog.getByRole('button', { name: '分层（zip）' }).click();
        await dialog.getByRole('button', { name: '四层' }).click();
    });
    const result = await page.evaluate(({ zip, composite }) => window.__lumi!.compareLayers(zip, composite, 0.5), { zip: layered, composite });
    expect(result.files.filter(name => /\.(webm|mp4)$/.test(name))).toHaveLength(4);
    expect(result.files).toContain('说明.txt');
    // 最上面一层（字幕、片尾、最上层素材）大部分是透明的。
    expect(result.transparentRatio).toBeGreaterThan(0.5);
    expect(result.diff).toBeLessThan(6);
});

test('two layers plus a separate vignette layer stack back to the composite (sonnet)', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    test.setTimeout(240_000);
    await setup(page, 'sonnet');
    await page.evaluate(() => {
        window.__lumi!.setPostProcess(true);
        window.__lumi!.patchTuning('kernel', { postProcess: { enabled: true, grain: 0, contrast: 0, rgbShift: 0, halftone: 0, vignette: 1.5, lensDistortion: 0, lensDispersion: 0 } });
    });
    const composite = await exportOnce(page, async () => undefined);
    const layered = await exportOnce(page, async dialog => {
        await dialog.getByRole('button', { name: '分层（zip）' }).click();
        await dialog.getByRole('button', { name: '背景 / 歌词动画' }).click();
        await dialog.getByLabel('后处理加在').selectOption('none');
        await dialog.getByText('暗角单独导出一层（普通混合）').click();
    });
    const result = await page.evaluate(({ zip, composite }) => window.__lumi!.compareLayers(zip, composite, 0.5), { zip: layered, composite });
    expect(result.files.filter(name => /\.(webm|mp4)$/.test(name))).toHaveLength(3);
    expect(result.files.some(name => name.includes('暗角'))).toBe(true);
    expect(result.transparentRatio).toBeGreaterThan(0.1);
    expect(result.diff).toBeLessThan(6);
});

// 绘光的光层输出预乘颜色、alpha = 最大通道（近似 screen），分层时透明底上的光也要能叠回合成。
test('four layers stack back to the composite (lumiere, no post-processing)', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    test.setTimeout(240_000);
    await setup(page, 'lumiere');
    await page.evaluate(() => window.__lumi!.setPostProcess(false));
    const composite = await exportOnce(page, async () => undefined);
    const layered = await exportOnce(page, async dialog => {
        await dialog.getByRole('button', { name: '分层（zip）' }).click();
        await dialog.getByRole('button', { name: '四层' }).click();
    });
    const result = await page.evaluate(({ zip, composite }) => window.__lumi!.compareLayers(zip, composite, 0.5), { zip: layered, composite });
    expect(result.files.filter(name => /\.(webm|mp4)$/.test(name))).toHaveLength(4);
    expect(result.transparentRatio).toBeGreaterThan(0.5);
    expect(result.diff).toBeLessThan(6);
});
