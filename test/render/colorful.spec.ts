import { expect, test, type Page } from '@playwright/test';

const LYRICS = [
    '[00:02.00]色彩在夜空中绽放',
    '[00:05.00]让每个镜头拥有光芒',
    '[00:08.00]穿过明亮的星河',
    '[00:11.00]再看见新的颜色',
    '[00:14.00]把故事写进画面',
    '[00:17.00]让音乐继续流动',
].join('\n');

const settle = async (page: Page) => {
    await page.waitForTimeout(700);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

const frame = async (page: Page, time: number) => {
    await page.evaluate(t => { window.__lumi!.seek(t); window.__lumi!.renderOnce(); }, time);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    return page.getByTestId('stage').screenshot();
};

// Inspect the rendered pixels, so a palette that never reaches the scene fails this check.
const colorsOf = (page: Page, screenshot: Buffer) => page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const hues = Array<number>(12).fill(0);
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
        if (max < 70 || chroma / max < 0.35) continue;
        const hue = max === r ? ((g - b) / chroma + 6) % 6
            : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
        hues[Math.min(11, Math.floor(hue * 2))] += 1;
        colored += 1;
    }
    return { ratio: colored / (canvas.width * canvas.height), hues: hues.map(count => count / Math.max(1, colored)) };
}, screenshot.toString('base64'));

// Average patches along the bare card's edges, away from type. A flat fill has one colour;
// a real gradient has many intermediate colours even with postprocessing/decor disabled.
const fieldDistribution = (page: Page, screenshot: Buffer) => page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    image.close();
    const colors = [0.12, 0.88].flatMap(y => [0.1, 0.3, 0.5, 0.7, 0.9].map(x => {
        const pixels = context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 5, 5).data;
        return [0, 1, 2].map(channel => {
            let total = 0;
            for (let index = channel; index < pixels.length; index += 4) total += pixels[index];
            return total / 25;
        });
    }));
    return {
        spread: Math.max(...[0, 1, 2].map(channel => Math.max(...colors.map(color => color[channel])) - Math.min(...colors.map(color => color[channel])))),
        bins: new Set(colors.map(color => color.map(channel => Math.round(channel / 4)).join(','))).size,
    };
}, screenshot.toString('base64'));

test('colorful paints distinct shot palettes and keeps them stable across seeking and rebuilds', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0);
    await page.evaluate(text => {
        const api = window.__lumi!;
        api.setPack('tempera');
        api.setSeed('colorful-render');
        api.setDark(true);
        api.patchTheme({ backgroundColor: '#181818', primaryColor: '#f2f2f2', secondaryColor: '#888888', accentColor: '#999999', wordColors: [] });
        api.setPostProcess(false);
        api.setSubtitles('none');
        api.patchTuning('tempera', { colorMode: 'duo', cameraIntensity: 0, glyphMotion: 0 });
        api.loadLyrics('colorful.lrc', text);
    }, LYRICS);
    await settle(page);
    const targets = await page.evaluate(() => {
        const paragraphs = window.__lumi!.inspect().paragraphs;
        const index = paragraphs.findIndex(p => p.texts.length > 0 && p.shots.length >= 2);
        if (index < 0) throw new Error('Expected two lyric shots in one paragraph');
        return { index, times: paragraphs[index].shots.slice(0, 2).map(shot => (shot.startTime + shot.endTime) / 2) };
    });
    // Use the same composition so the change is attributable to the per-shot palette.
    await page.evaluate(index => {
        window.__lumi!.lockShot(index, 0, 'tempera/cloud-window');
        window.__lumi!.lockShot(index, 1, 'tempera/cloud-window');
    }, targets.index);
    await settle(page);
    const duo = await colorsOf(page, await frame(page, targets.times[0]));
    expect(duo.ratio).toBeLessThan(0.02);

    // Exercise the user-facing selection, including its explanatory copy.
    await page.keyboard.press('Control+Shift+L');
    await page.locator('section').getByRole('button', { name: '凝彩 tempera', exact: true }).click();
    await page.getByRole('button', { name: '多彩', exact: true }).click();
    await expect(page.getByText('每镜头自动选择协调渐变配色，可跳出主题色。', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+L');
    await settle(page);

    const first = await frame(page, targets.times[0]);
    const firstColors = await colorsOf(page, first);
    const secondColors = await colorsOf(page, await frame(page, targets.times[1]));
    expect(firstColors.ratio).toBeGreaterThan(0.15);
    expect(secondColors.ratio).toBeGreaterThan(0.15);
    const hueDistance = firstColors.hues.reduce((sum, value, index) => sum + Math.abs(value - secondColors.hues[index]), 0);
    expect(hueDistance).toBeGreaterThan(0.3);

    await frame(page, 16);
    expect(Buffer.compare(first, await frame(page, targets.times[0]))).toBe(0);
    await page.evaluate(() => window.__lumi!.rebuild());
    expect(Buffer.compare(first, await frame(page, targets.times[0]))).toBe(0);

    await page.evaluate(index => {
        const api = window.__lumi!;
        api.lockShot(index, 0, 'tempera/monogatari-card');
        api.patchTuning('tempera', { showDecor: false, showCornerMarks: false });
    }, targets.index);
    await settle(page);
    const gradientField = await fieldDistribution(page, await frame(page, targets.times[0]));
    expect(gradientField.spread).toBeGreaterThan(20);
    expect(gradientField.bins).toBeGreaterThanOrEqual(7);
    await page.evaluate(() => window.__lumi!.patchTuning('tempera', { colorMode: 'duo' }));
    await settle(page);
    const flatField = await fieldDistribution(page, await frame(page, targets.times[0]));
    expect(flatField.spread).toBeLessThan(3);
    expect(flatField.bins).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.__lumi!.patchTuning('tempera', { colorMode: 'colorful', colorSaturation: 0 }));
    await settle(page);
    expect((await colorsOf(page, await frame(page, targets.times[0]))).ratio).toBeLessThan(0.02);
    expect(errors).toEqual([]);
});
