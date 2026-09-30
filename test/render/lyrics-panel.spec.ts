// 歌词面板：双击改字、拖逐字边（一步撤销）、键盘微调、打点、分词失效的提示与自动修复、慢速试听。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

type Edit = { anchor: { index: number; hash: string }; text?: string; startTime?: number; endTime?: number; words?: Array<{ text: string; startTime: number; endTime: number }> };

const debug = (page: Page) => ({
    lineEdit: (index: number) => page.evaluate(i => (window as any).__lumiDebug.store.useProjectStore.getState().project.lyricEdits.lines.find((edit: Edit) => edit.anchor.index === i) as Edit | undefined, index),
    historyLength: () => page.evaluate(() => (window as any).__lumiDebug.store.useProjectStore.getState().past.length as number),
    undo: () => page.evaluate(() => (window as any).__lumiDebug.store.useProjectStore.getState().undo()),
});

const setup = async (page: Page) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack: 'tempera' });
        lumi.setSeed('lyrics-panel');
        lumi.loadLyrics('panel.lrc', text);
    }, lyricText!);
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+Shift+Y');
    await expect(page.getByTestId('lyrics-view')).toBeVisible();
};

/** 一行里中间的那一行（有好几个字），点它选中。 */
const pickLine = async (page: Page) => {
    const index = await page.evaluate(() => {
        const paragraphs = window.__lumi!.inspect().paragraphs;
        const paragraph = paragraphs[3];
        return paragraph.lines[paragraph.texts.findIndex(text => [...text].length >= 6)];
    });
    await page.locator(`[data-line-row="${index}"]`).click();
    await expect(page.locator(`[data-line-row="${index}"]`)).toHaveAttribute('aria-selected', 'true');
    return index;
};

test('edit text by double click, drag a word edge as one undo step, nudge with the keyboard', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const d = debug(page);
    const index = await pickLine(page);
    const row = page.locator(`[data-line-row="${index}"]`);
    const original = (await row.innerText()).split('\n').at(-1)!.trim();

    // 双击改字：在末尾加两个字，回车。
    await row.getByTitle('双击改字').dblclick();
    const input = page.getByLabel('改这一行的字');
    await input.press('End');
    await input.type('ですね');
    await input.press('Enter');
    await expect(row).toContainText(`${original}ですね`);
    await expect(row.getByTitle('改过')).toBeVisible();
    const afterText = (await d.lineEdit(index))!;
    expect(afterText.text).toBe(`${original}ですね`);
    expect(afterText.words!.map(word => word.text).join('')).toBe(`${original}ですね`.replace(/\s+/g, ''));

    // 拖第 2 个字的结束往右：一次拖动 = 一步撤销。
    const strip = page.getByTestId('word-strip');
    const second = strip.locator('[data-unit-index="1"]');
    const box = (await second.boundingBox())!;
    const before = (await d.lineEdit(index))!.words![1];
    const history = await d.historyLength();
    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) await page.mouse.move(box.x + box.width - 2 + step * 5, box.y + box.height / 2);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const dragged = (await d.lineEdit(index))!.words![1];
    expect(dragged.endTime).toBeGreaterThan(before.endTime + 0.01);
    expect(dragged.startTime).toBeCloseTo(before.startTime, 5);
    expect(await d.historyLength()).toBe(history + 1);
    await expect(page.getByTestId('unit-readout')).toBeVisible();

    // 键盘：选中的字的开始往后挪 10ms，再往前 50ms。
    await page.keyboard.press('BracketRight');
    const nudged = (await d.lineEdit(index))!.words![1];
    expect(nudged.startTime).toBeCloseTo(dragged.startTime + 0.01, 4);
    await page.keyboard.press('Shift+BracketLeft');
    expect((await d.lineEdit(index))!.words![1].startTime).toBeCloseTo(dragged.startTime - 0.04, 4);

    // 撤销回到拖动之前。
    await d.undo();
    await d.undo();
    await d.undo();
    expect((await d.lineEdit(index))!.words![1].endTime).toBeCloseTo(before.endTime, 5);
});

test('tap mode sets each word start with Space; slow playback halves the clock', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const d = debug(page);
    const index = await pickLine(page);
    const count = await page.getByTestId('word-strip').locator('[data-unit-index]').count();

    await page.getByRole('button', { name: '打点' }).click();
    await expect(page.getByRole('status')).toContainText('打点中');
    // 没有音频时时钟按墙钟走：每隔一小会儿按一下空格。
    await page.waitForTimeout(1100);
    for (let k = 0; k <= count; k += 1) {
        await page.keyboard.press('Space');
        await page.waitForTimeout(120);
    }
    await expect(page.getByRole('status')).toHaveCount(0);
    const words = (await d.lineEdit(index))!.words!;
    expect(words).toHaveLength(count);
    words.forEach((word, k) => {
        expect(word.endTime).toBeGreaterThan(word.startTime);
        if (k > 0) expect(word.startTime).toBeCloseTo(words[k - 1].endTime, 5);
    });
    // 相邻两下隔 120ms 左右。
    expect(words[1].startTime - words[0].startTime).toBeGreaterThan(0.08);
    expect(words[1].startTime - words[0].startTime).toBeLessThan(0.4);

    await page.getByRole('button', { name: '0.5×' }).click();
    const elapsed = await page.evaluate(async () => {
        const playback = (window as any).__lumiDebug.playback;
        playback.play();
        const start = playback.clock.get();
        await new Promise(resolve => setTimeout(resolve, 600));
        const end = playback.clock.get();
        playback.pause();
        return end - start;
    });
    expect(elapsed).toBeGreaterThan(0.2);
    expect(elapsed).toBeLessThan(0.45);
});

test('a text edit that breaks manual segmentation offers repair', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const index = await pickLine(page);
    const row = page.locator(`[data-line-row="${index}"]`);
    const original = await page.evaluate(i => {
        const paragraph = window.__lumi!.inspect().paragraphs.find(item => item.lines.includes(i))!;
        return paragraph.texts[paragraph.lines.indexOf(i)];
    }, index);
    // 先给这一行存一个手动分词（前两个字一段，其余一段）。
    await page.evaluate(({ i, text }) => {
        const store = (window as any).__lumiDebug.store.useProjectStore;
        const hash = (value: string) => {
            let h = 0x811c9dc5;
            for (let k = 0; k < value.length; k += 1) {
                h ^= value.charCodeAt(k);
                h = Math.imul(h, 16777619);
            }
            return (h >>> 0).toString(16).padStart(8, '0');
        };
        store.getState().update((project: any) => ({
            ...project,
            lyricEdits: { ...project.lyricEdits, segments: [{ anchor: { index: i, hash: hash(text) }, parts: [text.slice(0, 2), text.slice(2)] }] },
        }));
    }, { i: index, text: original });
    await expect(page.getByTestId('segmentation-prompt')).toHaveCount(0);

    await row.getByTitle('双击改字').dblclick();
    const input = page.getByLabel('改这一行的字');
    await input.press('End');
    await input.type('ね');
    await input.press('Enter');
    const prompt = page.getByTestId('segmentation-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(`自动修复后：${original.slice(0, 2)}|`);
    await prompt.getByRole('button', { name: '自动修复' }).click();
    await expect(prompt).toHaveCount(0);
    const parts = await page.evaluate(i => (window as any).__lumiDebug.store.useProjectStore.getState().project.lyricEdits.segments.find((item: { anchor: { index: number } }) => item.anchor.index === i).parts as string[], index);
    expect(parts.join('')).toBe(`${original}ね`);
    expect(parts[0]).toBe(original.slice(0, 2));
});

test('timeline precise mode shows and drags word timing in sync with the lyric panel', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const d = debug(page);
    // 缩得太小时提示放大；点提示放大到能看清逐字。
    await page.getByRole('button', { name: '逐字' }).click();
    const zoomIn = page.getByRole('button', { name: '放大后显示逐字' });
    if (await zoomIn.count()) await zoomIn.click();
    const line = page.locator('[data-word-line]').filter({ has: page.locator('[data-word-unit="1"]') }).first();
    await expect(line).toBeVisible();
    const index = Number(await line.getAttribute('data-word-line'));
    const unit = line.locator('[data-word-unit="1"]');
    const box = (await unit.boundingBox())!;
    const before = await unit.getAttribute('title');

    await page.keyboard.down('Alt');
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 5; step += 1) await page.mouse.move(box.x + box.width - 1 + step * 4, box.y + box.height / 2);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const edit = (await d.lineEdit(index))!;
    expect(edit.words).toBeTruthy();
    const after = await unit.getAttribute('title');
    expect(after).not.toBe(before);

    // 歌词面板选中同一行，逐字条上同一个字的时间一样。
    await expect(page.locator(`[data-line-row="${index}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('word-strip').locator('[data-unit-index="1"]')).toHaveAttribute('title', after!);

    // 模式记住了。
    await page.reload();
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: '逐字' })).toHaveAttribute('aria-pressed', 'true');
});

test('whole lines can be dragged: timeline line blocks, the lyric strip and precise mode', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const d = debug(page);
    const drag = async (box: { x: number; y: number; width: number; height: number }, dx: number, y = box.y + box.height / 2) => {
        // 靠左一点按下：放大后行框可能比可见区域还宽，中点会落到屏幕外。
        const x = box.x + Math.min(box.width / 2, 40);
        await page.keyboard.down('Alt');
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 5; step += 1) await page.mouse.move(x + (dx * step) / 5, y);
        await page.mouse.up();
        await page.keyboard.up('Alt');
    };

    // 时间轴整行模式：按住行块中间拖。
    const block = page.locator('[data-line-index]').nth(2);
    const index = Number(await block.getAttribute('data-line-index'));
    const history = await d.historyLength();
    const box = (await block.boundingBox())!;
    // 只是点一下：选中，不改。
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await d.lineEdit(index)).toBeUndefined();
    await drag(box, 30);
    const moved = (await d.lineEdit(index))!;
    expect(moved.startTime).toBeDefined();
    // 一次拖动一步撤销；整行移：开始与结束移了同样多，逐字跟着。
    expect(await d.historyLength()).toBe(history + 1);
    const source = await page.evaluate(i => {
        const store = (window as any).__lumiDebug.store.useProjectStore.getState();
        return store.past.at(-1).lyricEdits.lines.length;
    }, index);
    expect(source).toBe(0);
    const words = moved.words!;
    expect(words[0].startTime).toBeGreaterThanOrEqual(moved.startTime! - 1e-6);
    expect(words.at(-1)!.endTime).toBeLessThanOrEqual(moved.endTime! + 1e-6);

    // 歌词面板的逐字条：按住行的范围拖。
    await page.locator(`[data-line-row="${index}"]`).click();
    const region = page.getByTestId('word-strip').getByLabel('整行');
    const regionBox = (await region.boundingBox())!;
    const beforeStrip = (await d.lineEdit(index))!;
    // 上一步可能已经把这一行推到了下一行的限位上，这里往回（往左）拖。
    await drag(regionBox, -25, regionBox.y + 20);
    const afterStrip = (await d.lineEdit(index))!;
    expect(afterStrip.startTime!).toBeLessThan(beforeStrip.startTime! - 0.01);
    expect(afterStrip.endTime! - afterStrip.startTime!).toBeCloseTo(beforeStrip.endTime! - beforeStrip.startTime!, 4);

    // 逐字模式：按住框顶上那一条拖（换一行没动过的：上面那行已经被推得和下一行重叠了）。
    await page.getByRole('button', { name: '逐字' }).click();
    const zoomIn = page.getByRole('button', { name: '放大后显示逐字' });
    if (await zoomIn.count()) await zoomIn.click();
    const other = index + 3;
    const frame = page.locator(`[data-word-line="${other}"]`);
    await frame.scrollIntoViewIfNeeded();
    const frameBox = (await frame.boundingBox())!;
    const beforePrecise = await page.evaluate(i => window.__lumi!.inspect().paragraphs.flatMap(p => p.lines).includes(i), other);
    expect(beforePrecise).toBe(true);
    await drag(frameBox, 20, frameBox.y + 4);
    const afterPrecise = (await d.lineEdit(other))!;
    expect(afterPrecise).toBeDefined();
    expect(afterPrecise.words!.length).toBeGreaterThan(0);
    expect(afterPrecise.words![0].startTime).toBeGreaterThanOrEqual(afterPrecise.startTime! - 1e-6);
});
