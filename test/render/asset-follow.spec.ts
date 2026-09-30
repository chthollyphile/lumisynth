// 素材跟随运镜：画出来的位置 = 包的运镜变换套在没有运镜时的位置上；motion 在镜头起点回到原位；
// 预览上的编辑框对得上、拖动按运镜反算；逐帧导出与预览一致。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;
const COLOR = '#ff00ff';

type Point = { x: number; y: number };
type Affine = { a: number; b: number; c: number; d: number; tx: number; ty: number };
const applyAffine = (m: Affine, p: Point): Point => ({ x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty });
const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

const centroid = async (page: Page, time: number) => {
    const result = await page.evaluate(([color, t]) => window.__lumi!.colorCentroid(color as string, t as number), [COLOR, time]);
    expect(result, `t = ${time}`).not.toBeNull();
    return result!;
};
const follow = (page: Page, clip: string, time: number) => page.evaluate(([id, t]) => window.__lumi!.clipFollow(id as string, t as number), [clip, time]);
const update = (page: Page, clip: string, patch: Record<string, unknown>) => page.evaluate(([id, p]) => window.__lumi!.updateClip(id as string, p as Record<string, unknown>), [clip, patch] as const);

test('assets follow the camera in preview, on-canvas editing and export', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    test.setTimeout(180_000);
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack: 'sonnet' });
        lumi.setSeed('follow');
        lumi.setPostProcess(false);
        lumi.patchTuning('sonnet', { cameraIntensity: 1.6 });
        lumi.loadLyrics('follow.lrc', text);
    }, lyricText!);
    const image = await page.evaluate(color => window.__lumi!.addTestImage('mark', color), COLOR);
    const clip = await page.evaluate(id => window.__lumi!.addClip(id, {
        timing: { type: 'song' }, slot: 'front', x: 0.3, y: 0.32, scale: 0.12, rotation: 0.4,
        enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 },
    }), image);
    await page.waitForTimeout(500);

    // 一个足够长、镜头会动起来的镜头。
    const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs
        .flatMap(paragraph => paragraph.shots)
        .find(item => item.startTime > 5 && item.endTime - item.startTime > 2.5)!);
    const start = shot.startTime + 0.001;
    const mid = shot.startTime + (shot.endTime - shot.startTime) * 0.7;

    // 不跟随：没有运镜时的位置。
    const restStart = await centroid(page, start);
    const restMid = await centroid(page, mid);

    // scene：画出来的位置就是运镜变换套在原位上；而且镜头确实动了。
    await update(page, clip, { follow: 'scene', followAmount: 1 });
    const scene = await centroid(page, mid);
    const sceneMatrix = (await follow(page, clip, mid))!;
    expect(distance(scene, applyAffine(sceneMatrix, restMid))).toBeLessThan(1.5);
    expect(distance(scene, restMid)).toBeGreaterThan(3);

    // motion：镜头起点回到原位，之后跟着镜头内的运动。
    await update(page, clip, { follow: 'motion' });
    expect(distance(await centroid(page, start), restStart)).toBeLessThan(1.5);
    const motion = await centroid(page, mid);
    expect(distance(motion, applyAffine((await follow(page, clip, mid))!, restMid))).toBeLessThan(1.5);

    // 程度一半：套的是按中心减半的变换。
    await update(page, clip, { follow: 'scene', followAmount: 0.5 });
    const half = await centroid(page, mid);
    expect(distance(half, applyAffine((await follow(page, clip, mid))!, restMid))).toBeLessThan(1.5);
    await update(page, clip, { followAmount: 1 });

    // 预览上的编辑框：中心在画出来的素材上；拖动按运镜反算，拖多少画面上就动多少。
    await page.evaluate(t => window.__lumi!.seek(t), mid);
    await page.locator(`[data-clip-id="${clip}"]`).click();
    const handles = page.getByTestId('clip-handles');
    await expect(handles).toBeVisible();
    const canvasBox = (await page.locator('canvas').first().boundingBox())!;
    const displayScale = canvasBox.width / 1280;
    const before = await centroid(page, mid);
    const imageCenter = async () => {
        const box = (await handles.boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    // 编辑框的外接框中心就是旋转后图片的中心；图片的色块重心相对中心的偏移随运镜旋转，所以只比较位移。
    const handleBefore = await imageCenter();
    await page.mouse.move(handleBefore.x, handleBefore.y);
    await page.mouse.down();
    await page.mouse.move(handleBefore.x + 60, handleBefore.y + 24, { steps: 6 });
    await page.mouse.up();
    const after = await centroid(page, mid);
    expect(after.x - before.x).toBeCloseTo(60 / displayScale, 0);
    expect(after.y - before.y).toBeCloseTo(24 / displayScale, 0);
    const handleAfter = await imageCenter();
    expect(handleAfter.x - handleBefore.x).toBeCloseTo(60, 0);
    expect(handleAfter.y - handleBefore.y).toBeCloseTo(24, 0);

    // 逐帧导出与预览一致：导出的第 k 帧就是 起点 + k / 30 这一刻的画面（先在预览里量好，导出时预览会暂停）。
    const exportStart = Math.floor(shot.startTime * 100) / 100;
    const frames = [start + 0.1, (start + mid) / 2, mid].map(t => Math.floor((t - exportStart) * 30 + 1e-6));
    const expected: Array<{ x: number; y: number }> = [];
    for (const frame of frames) expected.push(await centroid(page, exportStart + frame / 30));
    await page.getByRole('button', { name: '导出视频' }).click();
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('button', { name: '720p' }).click();
    await dialog.getByRole('button', { name: 'WebM' }).click();
    await dialog.getByRole('button', { name: '自定义' }).click();
    const [startInput, endInput] = await dialog.locator('input[type="number"]').all();
    await startInput.fill(exportStart.toFixed(2));
    await endInput.fill((mid + 0.3).toFixed(2));
    const downloadPromise = page.waitForEvent('download', { timeout: 110_000 });
    await dialog.getByRole('button', { name: /开始导出/ }).click();
    const bytes = fs.readFileSync(await (await downloadPromise).path());
    // 取每一帧的中间，避开帧边界。
    const exported = await page.evaluate(([base64, at, color]) => window.__lumi!.videoCentroids(base64 as string, at as number[], color as string),
        [bytes.toString('base64'), frames.map(frame => (frame + 0.5) / 30), COLOR] as const);
    exported.forEach((point, index) => {
        expect(point, `frame ${frames[index]}`).not.toBeNull();
        expect(distance(point!, expected[index]), `frame ${frames[index]}`).toBeLessThan(2.5);
    });
});

test('tempera: scene follows the shot camera, motion starts from rest', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack: 'tempera' });
        lumi.setSeed('follow');
        lumi.setPostProcess(false);
        lumi.patchTuning('tempera', { cameraIntensity: 2 });
        lumi.loadLyrics('follow.lrc', text);
    }, lyricText!);
    const image = await page.evaluate(color => window.__lumi!.addTestImage('mark', color), COLOR);
    const clip = await page.evaluate(id => window.__lumi!.addClip(id, {
        timing: { type: 'song' }, slot: 'overlay', x: 0.7, y: 0.3, scale: 0.12, rotation: -0.3,
        enter: { type: 'none', duration: 0 }, exit: { type: 'none', duration: 0 },
    }), image);
    await page.waitForTimeout(500);
    const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs
        .flatMap(paragraph => paragraph.shots)
        .find(item => item.startTime > 5 && item.endTime - item.startTime > 2.5)!);
    const start = shot.startTime + 0.001;
    const late = shot.endTime - 0.05;
    const restStart = await centroid(page, start);
    const restLate = await centroid(page, late);
    await update(page, clip, { follow: 'scene' });
    const scene = await centroid(page, late);
    expect(distance(scene, applyAffine((await follow(page, clip, late))!, restLate))).toBeLessThan(1.5);
    expect(distance(scene, restLate)).toBeGreaterThan(2);
    await update(page, clip, { follow: 'motion' });
    expect(distance(await centroid(page, start), restStart)).toBeLessThan(1.5);
    expect(distance(await centroid(page, late), applyAffine((await follow(page, clip, late))!, restLate))).toBeLessThan(1.5);
});
