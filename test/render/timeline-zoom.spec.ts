// 时间轴原地缩放：按钮 / 滑块以播放头为锚点，Ctrl+滚轮以鼠标为锚点，缩放后锚点留在屏幕上同一个位置；
// 底部面板占满整个窗口宽度。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

const scroller = (page: Page) => page.getByTestId('timeline-scroller');
const state = (page: Page) => scroller(page).evaluate(element => ({ scrollLeft: element.scrollLeft, zoom: JSON.parse(localStorage.getItem('lumisynth:layout') ?? '{}').state.timelineZoom as number }));

test('the timeline zooms in place and the panel spans the whole window', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => window.__lumi!.loadLyrics('zoom.lrc', text), lyricText!);
    await page.waitForTimeout(400);

    const panel = page.getByRole('button', { name: '关闭面板' }).locator('xpath=ancestor::div[contains(@class, "flex-col")][1]');
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeLessThan(2);
    expect(panelBox.width).toBeGreaterThan(1270);

    // 滚到 60 秒附近，播放头放在视野里。
    await scroller(page).evaluate(element => { element.scrollLeft = 60 * 40; });
    await page.evaluate(() => window.__lumi!.seek(70));
    await page.waitForTimeout(200);
    const playhead = page.getByTestId('timeline-playhead');
    const before = (await playhead.boundingBox())!.x;
    await page.getByRole('button', { name: '放大' }).click();
    await page.waitForTimeout(200);
    expect(Math.abs((await playhead.boundingBox())!.x - before)).toBeLessThan(2);
    await page.getByRole('button', { name: '缩小' }).click();
    await page.getByRole('button', { name: '缩小' }).click();
    await page.waitForTimeout(200);
    expect(Math.abs((await playhead.boundingBox())!.x - before)).toBeLessThan(2);

    // Ctrl+滚轮：鼠标下的时刻不动。
    const box = (await scroller(page).boundingBox())!;
    const mouseX = box.x + 76 + 500;
    const timeUnder = async () => {
        const { scrollLeft, zoom } = await state(page);
        return (scrollLeft + 500) / zoom;
    };
    const t0 = await timeUnder();
    const zoomBefore = (await state(page)).zoom;
    await page.mouse.move(mouseX, box.y + 40);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const after = await state(page);
    expect(after.zoom).toBeGreaterThan(zoomBefore);
    expect(Math.abs((await timeUnder()) - t0)).toBeLessThan(0.1);

    // 滑块：拖到最大，视野不回到开头。
    await page.getByLabel('缩放').fill('400');
    await page.waitForTimeout(200);
    expect((await state(page)).scrollLeft).toBeGreaterThan(1000);
});
