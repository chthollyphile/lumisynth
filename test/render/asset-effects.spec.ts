// 素材的附加效果与持续运动：效果用和图片同形状的纯色剪影画在原图下面（重影扩张随时间扩散、循环；
// 外发光与投影静止），持续运动让图沿缓动的曲线移动。都只由时间决定。
import { expect, test, type Page } from '@playwright/test';

const IMAGE = '#ff00ff';
const EFFECT = '#00ff40';

const centroid = (page: Page, color: string, time: number) => page.evaluate(([c, t]) => window.__lumi!.colorCentroid(c as string, t as number), [color, time] as const);

/** 明显偏绿的像素（外发光是模糊后的半透明光晕，按精确颜色匹配找不到）：个数与重心。 */
const greenish = (page: Page, time: number) => page.evaluate(async t => {
    const { getPreviewKernel } = await import(/* @vite-ignore */ '/src/agent/host.ts' as string) as typeof import('../../src/agent/host');
    const kernel = getPreviewKernel()!;
    await kernel.prepareAt(t);
    kernel.renderAt(t);
    const canvas = kernel.canvas;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        if (g < 40 || g < r * 2 || g < b * 1.5) continue;
        const index = i / 4;
        sx += index % canvas.width;
        sy += canvas.height - 1 - Math.floor(index / canvas.width);
        count += 1;
    }
    // 与 colorCentroid 一样换算成逻辑像素（画布是逻辑尺寸 × 渲染倍率）。
    const scale = canvas.width / kernel.size.width;
    return { count, x: count ? sx / count / scale : 0, y: count ? sy / count / scale : 0 };
}, time);
const update = (page: Page, clip: string, patch: Record<string, unknown>) => page.evaluate(([id, p]) => window.__lumi!.updateClip(id as string, p as Record<string, unknown>), [clip, patch] as const);

test('clip effects draw a same-shaped silhouette under the image; motion moves it smoothly', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
        window.__lumi!.setPostProcess(false);
        window.__lumi!.patchTheme({ backgroundColor: '#000000' });
    });
    const image = await page.evaluate(color => window.__lumi!.addTestImage('figure', color), IMAGE);
    const clip = await page.evaluate(id => window.__lumi!.addClip(id, {
        timing: { type: 'absolute', start: 0, end: 30 }, slot: 'front', x: 0.5, y: 0.5, scale: 0.4,
        enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 },
    }), image);
    await page.waitForTimeout(400);

    // 没有效果：画面上没有效果色。
    const plain = (await centroid(page, IMAGE, 2))!;
    expect(plain.count).toBeGreaterThan(500);
    expect(await centroid(page, EFFECT, 2)).toBeNull();

    // 投影剪影：同形状、偏在右下。
    await update(page, clip, { effect: { type: 'shadow', color: EFFECT, size: 0.6, opacity: 1, period: 1.6 } });
    await expect.poll(async () => (await centroid(page, EFFECT, 2))?.count ?? 0).toBeGreaterThan(100);
    const shadow = (await centroid(page, EFFECT, 2))!;
    expect(shadow.x).toBeGreaterThan(plain.x);
    expect(shadow.y).toBeGreaterThan(plain.y);

    // 外发光：图的四周一圈，重心和原图差不多。
    await update(page, clip, { effect: { type: 'glow', color: EFFECT, size: 0.6, opacity: 1, period: 1.6 } });
    await expect.poll(async () => (await greenish(page, 2)).count).toBeGreaterThan(300);
    const glow = await greenish(page, 2);
    const shadowGreen = await (async () => {
        await update(page, clip, { effect: { type: 'shadow', color: EFFECT, size: 0.6, opacity: 1, period: 1.6 } });
        await page.waitForTimeout(300);
        return greenish(page, 2);
    })();
    // 光晕围着原图（重心几乎不偏），投影偏向右下。
    expect(Math.hypot(glow.x - plain.x, glow.y - plain.y)).toBeLessThan(Math.hypot(shadowGreen.x - plain.x, shadowGreen.y - plain.y));
    expect(shadowGreen.x).toBeGreaterThan(plain.x);

    // 重影扩张：随时间变化（扩散、淡出），按周期循环。
    await update(page, clip, { effect: { type: 'echo', color: EFFECT, size: 0.8, opacity: 1, period: 2 } });
    await expect.poll(async () => (await centroid(page, EFFECT, 2.3))?.count ?? 0).toBeGreaterThan(50);
    const echoA = (await centroid(page, EFFECT, 2.3))!.count;
    const echoB = (await centroid(page, EFFECT, 2.9))!.count;
    const echoLoop = (await centroid(page, EFFECT, 4.3))!.count;
    expect(echoA).not.toBe(echoB);
    expect(Math.abs(echoLoop - echoA)).toBeLessThan(echoA * 0.05 + 5);

    // 持续运动：横移沿曲线慢慢走，同一时刻渲染两次结果一样。
    await update(page, clip, { effect: { type: 'none', color: EFFECT, size: 0.5, opacity: 0.6, period: 1.6 }, x: 0.3, motion: { type: 'drift', amount: 1 } });
    await page.waitForTimeout(200);
    const early = (await centroid(page, IMAGE, 1))!;
    const late = (await centroid(page, IMAGE, 29))!;
    expect(late.x - early.x).toBeGreaterThan(20);
    const again = (await centroid(page, IMAGE, 29))!;
    expect(again.x).toBeCloseTo(late.x, 5);
});
