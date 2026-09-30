// 工作台交互：时间轴右键菜单 → 快速选择（上下键试看、Esc 恢复、回车提交）、大纲、面包屑、设置搜索。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

const setup = async (page: Page) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(text => {
        const lumi = window.__lumi!;
        lumi.setDirection({ mode: 'single', pack: 'tempera' });
        lumi.setSeed('workbench');
        lumi.loadLyrics('w.lrc', text);
    }, lyricText!);
    await page.waitForTimeout(700);
};

const shotStyle = (page: Page) => page.evaluate(() => window.__lumi!.inspect().paragraphs[2].shots[0].style);

test('context menu, quick pick with peek, outline and breadcrumbs', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const original = await shotStyle(page);
    // 第 3 段第 1 个镜头：大纲里点它，时间轴上的同一格随之选中。
    await page.getByRole('button', { name: '大纲' }).click();
    const outline = page.getByRole('tree', { name: '大纲' });
    await expect(outline).toBeVisible();
    const paragraphRow = outline.getByRole('treeitem').filter({ hasText: /^3\./ }).first();
    await paragraphRow.click();
    await expect(page.getByRole('navigation', { name: '位置' })).toContainText('3.');

    const shotId = await page.evaluate(() => window.__lumi!.inspect().paragraphs[2].shots[0].id);
    await outline.locator(`[data-outline-id="${shotId}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '更换风格…' }).click();
    const picker = page.getByRole('dialog', { name: /更换镜头风格/ });
    await expect(picker).toBeVisible();

    // 上下键：预览里试看（编排结果变了），但工程没变。
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => shotStyle(page)).not.toBe(original);
    const peeked = await shotStyle(page);
    expect(await page.evaluate(() => window.__lumi!.inspect().paragraphs[2].shots[0].locked)).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => shotStyle(page)).toBe(original);

    // 再来一次，回车提交。
    await outline.locator(`[data-outline-id="${shotId}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '更换风格…' }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => shotStyle(page)).toBe(peeked);
    await expect(page.getByTitle(`${peeked}（已锁定）`)).toBeVisible();
});

test('title bar layout toggles hide and show the side bar, panel and aux bar', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    const regions = [
        { toggle: '切换主侧栏', region: () => page.getByRole('button', { name: '选择音频' }) },
        { toggle: '切换面板', region: () => page.getByRole('button', { name: '关闭面板' }) },
        { toggle: '切换辅助栏', region: () => page.getByText('检查器', { exact: true }) },
    ];
    for (const { toggle, region } of regions) {
        const button = page.getByRole('button', { name: toggle });
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(region()).toBeVisible();
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await expect(region()).toHaveCount(0);
    }
    // 布局存在浏览器里：刷新后仍然收起，再点一次恢复。
    await page.reload();
    for (const { toggle, region } of regions) {
        const button = page.getByRole('button', { name: toggle });
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await button.click();
        await expect(region()).toBeVisible();
    }
});

test('preview volume and mute drive the audio element and persist', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    const audio = () => page.evaluate(() => {
        const element = document.querySelector('audio')!;
        return { volume: Math.round(element.volume * 100) / 100, muted: element.muted };
    });
    await page.getByRole('slider', { name: '预览音量' }).fill('0.3');
    await expect.poll(audio).toEqual({ volume: 0.3, muted: false });
    await page.keyboard.press('m');
    await expect.poll(audio).toEqual({ volume: 0.3, muted: true });
    await expect(page.getByRole('button', { name: '取消静音' })).toBeVisible();
    await page.reload();
    await expect.poll(audio).toEqual({ volume: 0.3, muted: true });
    await page.getByRole('button', { name: '取消静音' }).click();
    await expect.poll(audio).toEqual({ volume: 0.3, muted: false });
});

/** 在 selector 对应的元素上模拟一次拖放（dragenter → dragover → drop）。 */
const dropFiles = async (page: Page, selector: string, files: Array<{ name: string; type: string; base64: string }>) => {
    // 目标可能还在入场（向导换步骤要等上一步退场），先等它出现。
    await page.locator(selector).first().waitFor({ state: 'attached' });
    await page.evaluate(({ selector, files }) => {
        const target = document.querySelector(selector)!;
        const transfer = new DataTransfer();
        files.forEach(file => transfer.items.add(new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name, { type: file.type })));
        for (const type of ['dragenter', 'dragover', 'drop']) {
            target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
        }
    }, { selector, files });
};

const LRC = (text: string) => ({ name: `${text}.lrc`, type: '', base64: Buffer.from(`[00:01.00]${text} one\n[00:04.00]${text} two\n`).toString('base64') });
const project = (page: Page) => page.evaluate(async () => {
    const { project } = (await (window as any).__lumiDebug.store).useProjectStore.getState();
    return { lyrics: project.lyrics?.fileName ?? null, translation: project.translation?.fileName ?? null, cover: Boolean(project.cover), assets: project.assets.map((asset: { name: string }) => asset.name), clips: project.assetClips.length };
});

test('drag and drop: window, lyric cards, cover card, library and stage', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).__lumiDebug));
    const png = { name: 'drop.png', type: 'image/png', base64: (await makePng(40, 60)).toString('base64') };

    // 拖到窗口任意处：第一份歌词直接用，未知文件只记日志。
    await dropFiles(page, 'body', [LRC('first'), { name: 'notes.pdf', type: 'application/pdf', base64: 'JVBERg==' }]);
    await expect.poll(async () => (await project(page)).lyrics).toBe('first.lrc');

    // 已经有歌词时再拖到窗口：问替换还是译文。
    await dropFiles(page, 'body', [LRC('second')]);
    await page.getByRole('option', { name: /作为译文/ }).click();
    await expect.poll(async () => (await project(page)).translation).toBe('second.lrc');

    // 拖到歌词卡片上：直接替换，不再问。
    await dropFiles(page, '[data-drop-target="lyrics"]', [LRC('third')]);
    await expect.poll(async () => (await project(page)).lyrics).toBe('third.lrc');

    // 图片拖到封面卡片 = 封面；拖到窗口 = 素材库；拖到预览画面 = 素材库 + 放到画面上。
    await dropFiles(page, '[data-drop-target="cover"]', [png]);
    await expect.poll(async () => (await project(page)).cover).toBe(true);
    expect((await project(page)).assets).toEqual([]);
    await dropFiles(page, 'body', [png]);
    await expect.poll(async () => (await project(page)).assets).toEqual(['drop.png']);
    await dropFiles(page, '[data-drop-target="stage"]', [png]);
    await expect.poll(async () => (await project(page)).clips).toBe(1);
    expect((await project(page)).assets).toHaveLength(2);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
});

test('style thumbnails play their motion while hovered', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.getByRole('button', { name: '风格库', exact: true }).click();
    const thumb = page.locator('[data-style-thumb]').first();
    await expect(thumb.locator('img')).toBeVisible({ timeout: 20_000 });
    await thumb.hover();
    await expect(thumb).toHaveAttribute('data-playing', 'true');
    // 循环播放：隔一段时间取样，画面在变。
    const frames = await thumb.locator('canvas').evaluate(async (canvas: HTMLCanvasElement) => {
        const hash = () => {
            const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let value = 0;
            for (let i = 0; i < data.length; i += 97) value = (value * 31 + data[i]) | 0;
            return value;
        };
        const samples: number[] = [];
        for (let i = 0; i < 5; i += 1) {
            samples.push(hash());
            await new Promise(resolve => setTimeout(resolve, 350));
        }
        return new Set(samples).size;
    });
    expect(frames).toBeGreaterThan(2);
    // 移开就停，回到静态图。
    await page.mouse.move(700, 400);
    await expect(thumb).not.toHaveAttribute('data-playing', 'true');
    await expect(thumb.locator('canvas')).toHaveCount(0);
});

test('preview fullscreen: button, overlay controls, F toggles back', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    const stageBox = () => page.getByTestId('stage').evaluate(element => element.getBoundingClientRect().width);
    const before = await stageBox();
    await page.getByRole('button', { name: '预览全屏' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getAttribute('data-drop-target'))).toBe('stage');
    await expect(page.getByTestId('fullscreen-controls')).toBeVisible();
    // 全屏后画面按新尺寸重新贴合（不留边）。
    await expect.poll(stageBox).toBeGreaterThan(before);
    await page.getByTestId('fullscreen-controls').getByRole('button', { name: '播放' }).click();
    await expect(page.getByTestId('fullscreen-controls').getByRole('button', { name: '暂停' })).toBeVisible();
    await page.keyboard.press('Space');
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.getByTestId('fullscreen-controls')).toHaveCount(0);
    await expect.poll(stageBox).toBeCloseTo(before, 0);
});

test('theme park: the draft drives the preview, apply writes the project, content and JSON import', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).__lumiDebug));
    const theme = () => page.evaluate(async () => {
        const { project } = (await (window as any).__lumiDebug.store).useProjectStore.getState();
        return { source: project.theme.source, dark: project.theme.dual.dark, light: project.theme.dual.light };
    });
    const stageBackground = () => page.getByTestId('stage').evaluate(element => getComputedStyle(element).backgroundColor);
    const original = await theme();

    await page.getByRole('button', { name: '画面与编排' }).click();
    await page.getByRole('button', { name: '打开主题编辑器' }).click();
    const park = page.getByTestId('theme-park');
    await expect(park).toBeVisible();
    // 分栏：预览仍然可见。
    await expect(page.getByTestId('stage')).toBeVisible();

    // 改草稿：预览跟着变，工程不变。
    await park.getByRole('radio', { name: '背景' }).click();
    await park.getByLabel('HEX').fill('#123456');
    await expect.poll(stageBackground).toBe('rgb(18, 52, 86)');
    expect((await theme()).dark.backgroundColor).toBe(original.dark.backgroundColor);
    await expect(park).toContainText('有未应用的修改');

    // 放弃修改：回到工程里的主题。
    await park.getByRole('button', { name: '放弃修改' }).click();
    await expect.poll(stageBackground).not.toBe('rgb(18, 52, 86)');

    // 名字为空不能应用。
    await park.getByLabel('HEX').fill('#123456');
    await park.getByRole('tab', { name: '详情' }).click();
    await park.getByLabel('深色主题名字').fill('');
    await expect(park.getByRole('button', { name: '应用' })).toBeDisabled();
    await park.getByLabel('深色主题名字').fill('深海');

    // 关键字与图标：两边共用。
    await park.getByRole('tab', { name: '内容' }).click();
    await park.getByRole('button', { name: '添加' }).first().click();
    await park.getByRole('textbox', { name: '关键字 1' }).fill('雨');
    await park.getByLabel('图标名').fill('Moon');
    await park.getByLabel('图标名').press('Enter');
    await park.getByLabel('图标名').fill('NotAnIcon');
    await park.getByLabel('图标名').press('Enter');
    await expect(park).toContainText('没有这个图标名');

    await park.getByRole('button', { name: '应用' }).click();
    await expect.poll(async () => (await theme()).dark.backgroundColor).toBe('#123456');
    const applied = await theme();
    expect(applied.source).toBe('custom');
    expect(applied.dark.name).toBe('深海');
    expect(applied.light.lyricsIcons).toEqual(['Moon']);
    expect(applied.dark.wordColors?.map((entry: { word: string }) => entry.word)).toEqual(['雨']);

    // 一步撤销回到原来的主题，编辑器的草稿（没有新改动）跟着回去。
    // 撤销不在输入框里触发：先让编辑器的输入框失焦。
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await theme()).dark.backgroundColor).toBe(original.dark.backgroundColor);
    await expect(park).toContainText('工程主题');

    // AI 页：粘贴带说明文字的 JSON，进草稿不进工程。
    await park.getByRole('tab', { name: 'AI' }).click();
    const imported = { light: { name: '晴', backgroundColor: '#fafafa' }, dark: { name: '夜', backgroundColor: '#101820' } };
    await park.getByLabel('主题 JSON').fill(`这是结果：\n\`\`\`json\n${JSON.stringify(imported)}\n\`\`\``);
    await park.getByRole('button', { name: '导入到草稿' }).click();
    await expect.poll(stageBackground).toBe('rgb(16, 24, 32)');
    expect((await theme()).dark.backgroundColor).toBe(original.dark.backgroundColor);

    // 关掉标签页：草稿丢掉，预览回到工程主题。
    await page.getByRole('tab', { name: '主题' }).click({ button: 'middle' });
    await expect(park).toHaveCount(0);
    await expect.poll(stageBackground).not.toBe('rgb(16, 24, 32)');
});

test('wizard: from the empty stage to a finished PV in five steps', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => Boolean((window as any).__lumiDebug));
    const project = () => page.evaluate(async () => {
        const { project: p } = (await (window as any).__lumiDebug.store).useProjectStore.getState();
        return { title: p.meta.title, lyrics: p.lyrics?.fileName ?? null, cover: Boolean(p.cover), direction: p.direction, aspect: p.aspect, theme: p.theme };
    });

    // 空工程：预览上是引导卡片。
    await page.getByTestId('empty-stage').getByRole('button', { name: '开始制作' }).click();
    const wizard = page.getByTestId('wizard');
    await expect(wizard).toBeVisible();
    await expect(wizard.getByRole('button', { name: '下一步' })).toBeDisabled();

    // 1. 歌曲：歌词与封面拖到卡片上，填歌名。
    await expect(wizard.getByTestId('fia-tip')).toBeVisible();
    await dropFiles(page, '[data-testid=wizard] [data-drop-target="lyrics"]', [LRC('wizard')]);
    await expect(wizard.locator('[data-drop-target="lyrics"]')).toContainText('wizard.lrc');
    await expect(wizard.getByTestId('fia-tip')).toBeVisible();
    // folia 导出的 .fia：卡片标出无损格式，提示不再显示。
    const fia = await page.evaluate(async () => {
        // 浏览器里的模块路径（由 vite 提供），TypeScript 在测试这边解析不了：按路径字符串导入。
        const modulePath = '/src/core/lyrics/foliaLyricDocument.ts';
        const { buildFoliaLyricDocument } = await import(/* @vite-ignore */ modulePath) as typeof import('../../src/core/lyrics/foliaLyricDocument');
        const words = (text: string, start: number) => Array.from(text).map((char, i) => ({ text: char, startTime: start + i * 0.3, endTime: start + (i + 1) * 0.3 }));
        const lines = ['夜の街を歩いてた', '光る窓を数えてた'].map((text, i) => ({ startTime: 1 + i * 4, endTime: 4 + i * 4, fullText: text, words: words(text, 1 + i * 4) }));
        return JSON.stringify(buildFoliaLyricDocument({ lines, isWordByWord: true } as never));
    });
    await dropFiles(page, '[data-testid=wizard] [data-drop-target="lyrics"]', [{ name: 'wizard.fia', type: '', base64: Buffer.from(fia).toString('base64') }]);
    await expect(wizard.locator('[data-drop-target="lyrics"]')).toContainText('Folia 无损');
    await expect(wizard.getByTestId('fia-tip')).toHaveCount(0);
    await dropFiles(page, '[data-testid=wizard] [data-drop-target="cover"]', [{ name: 'cover.png', type: 'image/png', base64: (await makePng(64, 64)).toString('base64') }]);
    await expect.poll(async () => (await project()).cover).toBe(true);
    await wizard.getByLabel('歌名').fill('向导测试');
    await expect(page.getByTestId('empty-stage')).toHaveCount(0);
    await wizard.getByRole('button', { name: '下一步' }).click();

    // 2. 风格：选一个包、竖屏。
    const sonnet = wizard.getByRole('button', { name: /^风格：商籁/ });
    await sonnet.click();
    await expect(sonnet).toHaveAttribute('aria-pressed', 'true');
    await wizard.getByRole('button', { name: /竖屏 9:16/ }).click();
    await expect.poll(async () => (await project()).aspect).toBe('9:16');
    expect((await project()).direction).toMatchObject({ mode: 'single', pack: 'sonnet' });
    await wizard.getByRole('button', { name: '风格：按段落混用' }).click();
    await expect.poll(async () => (await project()).direction.mode).toBe('mix');
    await wizard.getByRole('button', { name: '下一步' }).click();

    // 素材（可选）：拖进两张图，自动以镜头为单位编排——场景之上、歌词之下，贴在场景上，带持续运动。
    const autoClips = () => page.evaluate(async () => (await (window as any).__lumiDebug.store).useProjectStore.getState().project.assetClips
        .filter((clip: { id: string }) => clip.id.startsWith('auto-')));
    await dropFiles(page, '[data-testid=wizard] [data-drop-target="library"]', [
        { name: 'a.png', type: 'image/png', base64: (await makePng(60, 120)).toString('base64') },
        { name: 'b.png', type: 'image/png', base64: (await makePng(60, 120)).toString('base64') },
    ]);
    await expect.poll(async () => (await autoClips()).length).toBeGreaterThan(0);
    for (const clip of await autoClips()) {
        expect(clip).toMatchObject({ slot: 'mid', follow: 'scene', motion: { type: 'float' } });
        expect(clip.timing.type).toBe('shot');
    }
    const before = (await autoClips()).length;
    await wizard.getByLabel('自动编排的效果').selectOption('echo');
    await expect.poll(async () => (await autoClips()).every((clip: { effect?: { type: string } }) => clip.effect?.type === 'echo')).toBe(true);
    expect((await autoClips()).length).toBe(before);
    await wizard.getByRole('button', { name: '下一步' }).click();

    // 3. 配色：从封面取色 + 浅色；没配 AI 时 AI 那张卡不能点。
    await expect(wizard.getByRole('button', { name: '配色：AI 按歌词生成' })).toBeDisabled();
    await wizard.getByRole('button', { name: '配色：从封面取色' }).click();
    await expect.poll(async () => (await project()).theme.dual.dark.provider).toBe('Cover');
    await wizard.getByRole('button', { name: '浅色' }).click();
    await expect.poll(async () => (await project()).theme.variant).toBe('light');
    await wizard.getByRole('button', { name: '配色：默认' }).click();
    await expect.poll(async () => (await project()).theme.source).toBe('preset');
    await wizard.getByRole('button', { name: '下一步' }).click();

    // 4. 完成：汇总这次的选择。
    await expect(wizard).toContainText('向导测试');
    await expect(wizard).toContainText('按段落混用');
    await expect(wizard).toContainText('9:16');
    await wizard.getByRole('button', { name: '继续精修' }).click();
    await expect(wizard).toHaveCount(0);

    // 从菜单再开一次：当前工程已经有歌，所以先新建一个空工程；什么都没放就取消，回到原来的工程，
    // 空工程被删掉，引导卡片也不会留下来。
    const projectCount = () => page.evaluate(async () => {
        const { listProjects } = await import(/* @vite-ignore */ '/src/project/db.ts' as string) as typeof import('../../src/project/db');
        return (await listProjects()).length;
    });
    const countBefore = await projectCount();
    const lyricsBefore = (await project()).lyrics;
    await page.getByRole('button', { name: '快速制作' }).click();
    await expect(wizard).toBeVisible();
    await expect.poll(async () => (await project()).lyrics).toBeNull();
    await expect(page.getByTestId('empty-stage')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(wizard).toHaveCount(0);
    await expect.poll(async () => (await project()).lyrics).toBe(lyricsBefore);
    await expect.poll(projectCount).toBe(countBefore);
    await expect(page.getByTestId('empty-stage')).toHaveCount(0);
});

test('asset library: multi-file import, selection, auto-arrange by shot that keeps manual clips', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.waitForFunction(() => Boolean((window as any).__lumiDebug));
    const clips = () => page.evaluate(async () => (await (window as any).__lumiDebug.store).useProjectStore.getState().project.assetClips as Array<{ id: string; assetId: string; timing: { type: string } }>);
    const assets = () => page.evaluate(async () => (await (window as any).__lumiDebug.store).useProjectStore.getState().project.assets as Array<{ id: string; name: string }>);

    await page.getByRole('button', { name: '素材库' }).click();
    const input = page.locator('input[type="file"][accept^="image/png"]').first();
    await expect(input).toHaveAttribute('multiple', '');
    await input.setInputFiles([
        { name: 'left.png', mimeType: 'image/png', buffer: await makePng(60, 120) },
        { name: 'right.png', mimeType: 'image/png', buffer: await makePng(60, 120) },
    ]);
    await expect.poll(async () => (await assets()).length).toBe(2);
    const [first] = await assets();

    // 手摆一个片段：自动编排不能动它。
    const manual = await page.evaluate(id => window.__lumi!.addClip(id, { timing: { type: 'song' }, slot: 'front' }), first.id);

    // 只选第一张，展开自动编排，用选中的图编排。
    await page.getByRole('checkbox', { name: `选择：${first.name}` }).check();
    await expect(page.getByText('已选 1 个')).toBeVisible();
    await page.getByRole('button', { name: '自动编排到画面上' }).click();
    await page.getByRole('button', { name: /自动编排（选中的 1 张）/ }).click();
    const auto = () => clips().then(list => list.filter(clip => clip.id.startsWith('auto-')));
    await expect.poll(async () => (await auto()).length).toBeGreaterThan(0);
    expect((await auto()).every(clip => clip.assetId === first.id && clip.timing.type === 'shot')).toBe(true);

    // 重新编排：抽签只看 seed 与镜头，数量不变；手摆的还在。
    const count = (await auto()).length;
    await page.getByRole('button', { name: /重新编排/ }).click();
    expect((await auto()).length).toBe(count);
    expect((await clips()).some(clip => clip.id === manual)).toBe(true);

    // 清除：只删自动编排的。
    await page.getByTitle(/删掉自动编排的/).click();
    await expect.poll(async () => (await auto()).length).toBe(0);
    expect((await clips()).map(clip => clip.id)).toEqual([manual]);

    // 删除选中：素材连同它的片段一起删掉。
    await page.getByRole('button', { name: '删除选中' }).click();
    await expect.poll(async () => (await assets()).map(asset => asset.name)).toEqual(['right.png']);
});

test('empty stage card: dismissible, and gone after the wizard is closed once', async ({ page }) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    const card = page.getByTestId('empty-stage');
    await card.getByRole('button', { name: '开始制作' }).click();
    await page.getByTestId('wizard').getByRole('button', { name: '关闭向导' }).click();
    await expect(page.getByTestId('wizard')).toHaveCount(0);
    await expect(card).toHaveCount(0);

    // 新建一个空工程：卡片又出现，点 × 关掉。
    await page.evaluate(async () => (await (window as any).__lumiDebug.actions).newProject());
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '关闭引导' }).click();
    await expect(card).toHaveCount(0);
});

test('settings editor filters groups by their content', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.keyboard.press('Control+,');
    const search = page.getByRole('textbox', { name: '搜索设置' });
    await expect(search).toBeVisible();
    await search.fill('颗粒');
    const visibleGroups = await page.locator('.mx-auto section:not(.hidden) > button').allInnerTexts();
    expect(visibleGroups.map(text => text.trim())).toEqual(['背景与后处理']);
    await page.getByRole('button', { name: '关闭设置' }).click();
});

test('settings editor shows the lumiere group and its switches write the pack tuning', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.keyboard.press('Control+,');
    const search = page.getByRole('textbox', { name: '搜索设置' });
    await search.fill('轨迹线');
    const visibleGroups = await page.locator('.mx-auto section:not(.hidden) > button').allInnerTexts();
    expect(visibleGroups.map(text => text.trim())).toEqual(['绘光 LUMIERE']);
    const group = page.locator('.mx-auto section:not(.hidden)');
    await expect(group.getByText('随音乐变亮')).toBeVisible();
    await expect(group.getByText('文字辉光')).toBeVisible();
    await group.getByText('所有换位都走轨迹线').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as {
        __lumiDebug: { store: { useProjectStore: { getState: () => { project: { tuning: { packs: Record<string, { trails?: boolean }> } } } } } };
    }).__lumiDebug.store.useProjectStore.getState().project.tuning.packs.lumiere?.trails)).toBe(true);
    await page.getByRole('button', { name: '关闭设置' }).click();
});

test('script tab: click selects, edits apply with Ctrl+S as one undo step', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.keyboard.press('Control+Shift+K');
    await expect(page.getByRole('tab', { name: '剧本' })).toBeVisible();
    const editor = page.getByTestId('script-editor');
    // 第 1 段第 2 个镜头（v2：shot N 写在它的段落块里，注释里是时间与风格）。
    const shotLine = editor.locator('.cm-line').filter({ hasText: /^\s*shot 2 / }).first();
    await shotLine.click();
    const style = await page.evaluate(() => window.__lumi!.inspect().paragraphs[0].shots[1].style);
    await expect(page.getByRole('navigation', { name: '位置' })).toContainText(style.split('/')[1]);

    // 第 1 段交给商籁：把写着自动选出的 pack tempera 改成 sonnet，Ctrl+S 应用。
    const packs = () => page.evaluate(() => window.__lumi!.inspect().paragraphs.map(p => p.pack));
    const before = await packs();
    await editor.locator('.cm-line').filter({ hasText: /^\s*pack tempera {2}# 自动$/ }).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.type('pack sonnet');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('script-view')).toContainText('已改动');
    await page.keyboard.press('Control+s');
    await expect.poll(packs).toEqual(before.map((pack, index) => (index === 0 ? 'sonnet' : pack)));
    // 应用后剧本重新载入：改过的值固定下来，标 locked。
    await expect(editor.locator('.cm-line').filter({ hasText: /^\s*pack sonnet locked$/ })).toHaveCount(1);
    await expect(page.getByTestId('script-view')).not.toContainText('已改动');

    // 写错的剧本不应用，错误标在编辑器里。
    await editor.locator('.cm-line').filter({ hasText: /^\s*pack sonnet locked$/ }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('energy 7');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+s');
    await expect(editor.locator('.cm-lintRange-error')).toHaveCount(1);
    await page.getByRole('button', { name: '重新载入' }).first().click();
    await expect(editor.locator('.cm-lintRange-error')).toHaveCount(0);

    // 一步撤销回到原来。
    await page.getByRole('navigation', { name: '位置' }).click();
    await page.keyboard.press('Control+z');
    await expect.poll(packs).toEqual(before);

    // 设置：JSON，改画幅并应用。
    await page.getByTestId('script-view').getByRole('button', { name: '设置', exact: true }).click();
    const aspectLine = editor.locator('.cm-line').filter({ hasText: /^\s*"aspect": "16:9",$/ });
    await expect(aspectLine).toHaveCount(1);
    await aspectLine.click();
    await page.keyboard.press('End');
    for (let i = 0; i < '16:9",'.length; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('9:16",');
    await page.keyboard.press('Control+s');
    await expect.poll(() => page.evaluate(async () => (await (window as any).__lumiDebug.store).useProjectStore.getState().project.aspect)).toBe('9:16');

    await page.getByRole('button', { name: 'JSON' }).click();
    await expect(page.locator('pre')).toContainText('"paragraphs"');
});

test('split at a lyric line, drag the boundary, merge back', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const paragraphs = () => page.evaluate(() => window.__lumi!.inspect().paragraphs.map(p => p.lines));
    const before = await paragraphs();
    const target = before.findIndex((lines, index) => index > 0 && lines.length >= 3);
    const line = before[target][1];

    // 歌词块右键 → 在这一行开新段。
    const block = page.locator(`[data-line-index="${line}"]`);
    await block.scrollIntoViewIfNeeded();
    await block.click({ button: 'right' });
    await page.getByRole('menuitem', { name: `在第 ${line + 1} 行开新段` }).click();
    await expect.poll(async () => (await paragraphs()).length).toBe(before.length + 1);
    expect((await paragraphs())[target + 1][0]).toBe(line);

    // 拖动新段落的开头到下一行。
    const separator = page.getByRole('separator', { name: `第 ${target + 2} 段的开头` });
    const from = (await separator.boundingBox())!;
    const next = (await page.locator(`[data-line-index="${line + 1}"]`).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(next.x + 2, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await paragraphs())[target + 1][0]).toBe(line + 1);

    // 段落块右键 → 与上一段合并，回到原来的分段。
    await page.locator(`[data-paragraph-index="${target + 1}"]`).click({ button: 'right' });
    await page.getByRole('menuitem', { name: '与上一段合并' }).click();
    await expect.poll(paragraphs).toEqual(before);
});

/** 生成一张带透明的 RGBA PNG（不依赖第三方库）。 */
const makePng = async (width: number, height: number) => {
    const { deflateSync, crc32 } = await import('node:zlib');
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y += 1) {
        rows[y * (width * 4 + 1)] = 0;
        for (let x = 0; x < width; x += 1) {
            const offset = y * (width * 4 + 1) + 1 + x * 4;
            const inside = Math.abs(x - width / 2) < (y / height) * (width / 2);
            rows.set(inside ? [250, 204, 21, 255] : [0, 0, 0, 0], offset);
        }
    }
    const chunk = (type: string, data: Buffer) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
};

test('asset library: upload, place on screen, drag on the preview', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.getByRole('button', { name: '素材库' }).click();
    await page.locator('input[type="file"][accept^="image/png"]').first().setInputFiles({ name: 'triangle.png', mimeType: 'image/png', buffer: await makePng(120, 160) });
    await expect(page.getByText('triangle.png')).toBeVisible();
    await expect(page.getByText('120×160')).toBeVisible();

    // 播放头移到第 3 段，放到画面上：挂在当前镜头上，检查器显示片段。
    const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[2].shots[0]);
    await page.evaluate(t => window.__lumi!.seek(t), (shot.startTime + shot.endTime) / 2);
    await page.getByRole('button', { name: '放到画面上：triangle.png' }).click({ force: true });
    await expect(page.getByText('跟随：镜头')).toBeVisible();
    const clip = page.locator('[data-clip-id]');
    await expect(clip).toHaveCount(1);

    const clips = () => page.evaluate(async () => (await (window as any).__lumiDebug.store).useProjectStore.getState().project.assetClips);
    const before = (await clips())[0];
    const handles = page.getByTestId('clip-handles');
    await expect(handles).toBeVisible();
    const box = (await handles.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 6 });
    await page.mouse.up();
    const after = (await clips())[0];
    expect(after.x).toBeGreaterThan(before.x + 0.02);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.timing.type).toBe('shot');

    // Delete 删除选中的片段。
    await clip.click();
    await page.keyboard.press('Delete');
    await expect(clip).toHaveCount(0);
});

test('background track: add from the look panel and from a library video', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[2].shots[0]);
    await page.evaluate(t => window.__lumi!.seek(t), shot.startTime + 0.2);

    await page.getByRole('button', { name: '画面与编排' }).click();
    await page.getByRole('button', { name: /背景与后处理/ }).click();
    await page.getByRole('button', { name: '当前段落换背景' }).click();
    await expect(page.getByLabel('背景来源')).toHaveValue('gradient');
    await expect(page.locator('[data-background-id]')).toHaveCount(1);
    await expect(page.getByText('跟随：段落')).toBeVisible();

    // 视频只能作背景：素材库卡片右键 → 设为背景：全曲。
    await page.evaluate(() => window.__lumi!.addTestVideo('loop', 2));
    await page.getByRole('button', { name: '素材库' }).click();
    const card = page.getByText('loop.webm').locator('xpath=ancestor::div[contains(@class, "group")]');
    await expect(card.getByText('视频 · 背景')).toBeVisible();
    await card.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: '放到画面上（播放头处）' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: '设为背景：全曲' }).click();
    await expect(page.locator('[data-background-id]')).toHaveCount(2);
    await expect(page.getByLabel('背景来源')).toHaveValue('video');
    await expect(page.getByRole('button', { name: /问题/ }).first()).not.toContainText(/[1-9]/);
});

test('storyboard: drag-select lyric lines into a new paragraph, set kind and pack, merge back', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}`);
    await setup(page);
    await page.keyboard.press('Control+Alt+O');
    const board = page.getByTestId('storyboard');
    await expect(board).toBeVisible();
    const paragraphs = () => page.evaluate(() => window.__lumi!.inspect().paragraphs.map(p => ({ start: p.lines[0], pack: p.pack })));
    const before = await paragraphs();
    const target = before.findIndex((_, index) => index > 0 && (before[index + 1]?.start ?? Infinity) - before[index].start >= 4);
    const from = before[target].start + 1;
    const to = from + 1;

    // 在歌词上从 from 拖到 to，切成新段落。
    const line = (index: number) => board.locator(`[data-storyboard-line="${index}"]`);
    await line(from).scrollIntoViewIfNeeded();
    const a = (await line(from).boundingBox())!;
    const b = (await line(to).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    const toolbar = page.getByRole('toolbar', { name: '选中的歌词' });
    await expect(toolbar).toContainText(`已选第 ${from + 1}–${to + 1} 行`);
    await toolbar.getByRole('button', { name: '切成新段落' }).click();
    await expect.poll(async () => (await paragraphs()).map(p => p.start)).toEqual(expect.arrayContaining([from, to + 1]));
    const index = (await paragraphs()).findIndex(p => p.start === from);

    // 左侧色条：性质、风格包。
    const band = board.getByRole('complementary', { name: `第 ${index + 1} 段` });
    await band.getByLabel(`第 ${index + 1} 段的性质`).selectOption('chorus');
    await band.getByLabel(`第 ${index + 1} 段的风格包`).selectOption('sonnet');
    await expect.poll(async () => (await paragraphs())[index]).toEqual({ start: from, pack: 'sonnet' });
    await expect(band.getByLabel(`第 ${index + 1} 段的性质`)).toHaveValue('chorus');

    // 展开这一段：镜头缩略图出现。
    await band.getByRole('button', { name: `展开第 ${index + 1} 段` }).click();
    await expect(board.locator('[data-storyboard-shot]').first()).toBeVisible();

    // 色条顶上的「合并」：并回上一段，再把后面那段也并回来，回到原来的分段。
    await band.hover();
    await band.getByRole('button', { name: '合并' }).click();
    const after = board.getByRole('complementary', { name: `第 ${index + 1} 段` });
    await after.hover();
    await after.getByRole('button', { name: '合并' }).click();
    await expect.poll(async () => (await paragraphs()).map(p => p.start)).toEqual(before.map(p => p.start));
});

test.describe('English interface', () => {
    test.use({ locale: 'en-US' });

    test('follows the browser language, switches to Chinese and remembers it', async ({ page }) => {
        await page.goto('/?resolution=1');
        await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        const titleBar = page.locator('header.titlebar');
        await expect(titleBar.getByRole('button', { name: 'File', exact: true })).toBeVisible();
        // 标题栏（菜单、按钮）里没有中文。
        expect(await titleBar.innerText()).not.toMatch(/[一-鿿]/);
        await titleBar.getByRole('button', { name: 'View', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Display Language…' })).toBeVisible();
        await page.keyboard.press('Escape');

        // 「设置」编辑器顶部的下拉框换成中文：界面立即切换，刷新后仍是中文。
        await page.keyboard.press('Control+,');
        await page.getByRole('combobox', { name: 'Display language' }).selectOption('zh');
        await expect(titleBar.getByRole('button', { name: '文件', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
        await page.reload();
        await expect(page.locator('header.titlebar').getByRole('button', { name: '文件', exact: true })).toBeVisible();
    });
});
