// 内核的回归基线：默认观感全开（后处理、tempera 反色、译文字幕、转场、片尾），
// 时间点从编译结果里挑——shot 中段、段落转场中段、片尾。另有一条确定性检查：
// 同一时刻从不同的播放历史渲染，画面逐字节相同（导出与预览一致的前提）。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;
const SEED = 'kernel';

type Mode = { name: string; mode: 'single' | 'mix'; pack: 'tempera' | 'sonnet' };
const MODES: Mode[] = [
    { name: 'tempera', mode: 'single', pack: 'tempera' },
    { name: 'sonnet', mode: 'single', pack: 'sonnet' },
    { name: 'mix', mode: 'mix', pack: 'tempera' },
];

const settle = async (page: Page) => {
    await page.waitForTimeout(700);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

const setup = async (page: Page, mode: Mode) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(({ mode, seed, text }) => {
        const lumi = window.__lumi!;
        // Keep the existing duo baseline; colorful.spec.ts covers the new default palette.
        lumi.patchTuning('tempera', { colorMode: 'duo' });
        lumi.setDirection({ mode: mode.mode, pack: mode.pack });
        lumi.setSeed(seed);
        lumi.setMeta({ title: '大正浪漫', artist: 'YOASOBI', album: '' });
        lumi.loadLyrics('kernel.lrc', text);
    }, { mode, seed: SEED, text: lyricText! });
    await settle(page);
};

const renderAt = async (page: Page, time: number) => {
    await page.evaluate(t => {
        window.__lumi!.seek(t);
        window.__lumi!.renderOnce();
    }, time);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
};

const pickTimes = async (page: Page) => page.evaluate(() => {
    const { paragraphs } = window.__lumi!.inspect();
    const times: Array<{ label: string; time: number }> = [];
    [1, 3, 5].forEach(index => {
        const shot = paragraphs[index]?.shots[1] ?? paragraphs[index]?.shots[0];
        if (shot) times.push({ label: `p${index}-shot`, time: (shot.startTime + shot.endTime) / 2 });
    });
    paragraphs.filter(p => p.transition).slice(0, 3).forEach((p, index) => {
        times.push({ label: `transition${index}`, time: (p.transition!.startTime + p.transition!.endTime) / 2 });
    });
    const last = paragraphs.at(-1);
    if (last) times.push({ label: 'credits', time: last.endTime + 2.5 });
    return times;
});

for (const mode of MODES) {
    test(`${mode.name} baselines`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
        await setup(page, mode);
        const times = await pickTimes(page);
        expect(times.length).toBeGreaterThanOrEqual(6);
        for (const { label, time } of times) {
            await renderAt(page, time);
            await expect(page.getByTestId('stage'), `${mode.name} ${label} @ ${time.toFixed(2)}s`)
                .toHaveScreenshot(`${mode.name}-${label}.png`);
        }
    });
}

test('same frame regardless of playback history', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[2]);
    const [target] = (await pickTimes(page)).filter(entry => entry.label.startsWith('transition'));
    const stage = page.getByTestId('stage');

    // 直接跳到目标时刻，场景现建。
    await page.evaluate(() => window.__lumi!.rebuild());
    await renderAt(page, target.time);
    const direct = await stage.screenshot();

    // 从开头一路走过来：邻段预构建、缓存淘汰都发生过。
    for (let t = 0; t < target.time; t += 1.7) await renderAt(page, t);
    await renderAt(page, target.time);
    const walked = await stage.screenshot();

    expect(Buffer.compare(direct, walked)).toBe(0);
});

test('shot mixing: a sonnet shot inside a tempera paragraph', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[0]);
    await page.evaluate(() => {
        window.__lumi!.setDirection({ shotMixing: true });
        window.__lumi!.lockShot(3, 1, 'sonnet/type-impact');
    });
    await settle(page);
    const shots = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots);
    expect(shots[1].style).toBe('sonnet/type-impact');
    const middle = (shots[1].startTime + shots[1].endTime) / 2;
    await renderAt(page, middle);
    await expect(page.getByTestId('stage')).toHaveScreenshot('mixing-sonnet-shot.png');
    // 跨包边界：进入 sonnet 镜头的短转场中段。
    await renderAt(page, shots[1].startTime - 0.1);
    await expect(page.getByTestId('stage')).toHaveScreenshot('mixing-boundary.png');
});

test('components: stacked typography without accents on one shot', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[0]);
    const shots = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots);
    const middle = Math.min(shots[1].endTime - 0.05, (shots[1].startTime + shots[1].endTime) / 2 + 0.4);
    await renderAt(page, middle);
    const before = await page.getByTestId('stage').screenshot();
    await page.evaluate(() => {
        window.__lumi!.setComponent(3, 1, 'typography', 'stack');
        window.__lumi!.setComponent(3, 1, 'accent', 'none');
    });
    await settle(page);
    await renderAt(page, middle);
    const after = await page.getByTestId('stage').screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expect(page.getByTestId('stage')).toHaveScreenshot('components-stack-none.png');
});

test('components: sonnet shot borrows poster typography and drops accents', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[1]);
    const shots = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots);
    const target = shots[0];
    const middle = (target.startTime + target.endTime) / 2;
    await renderAt(page, middle);
    const before = await page.getByTestId('stage').screenshot();
    const typography = target.style === 'sonnet/poster-blocks' ? 'quiet-tableau' : 'poster-blocks';
    await page.evaluate(value => {
        window.__lumi!.setComponent(3, 0, 'typography', value);
        window.__lumi!.setComponent(3, 0, 'accent', 'none');
    }, typography);
    await settle(page);
    await renderAt(page, middle);
    const after = await page.getByTestId('stage').screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expect(page.getByTestId('stage')).toHaveScreenshot('components-sonnet-typography-none.png');
});

for (const [host, value] of [[MODES[0], 'sonnet/type-impact'], [MODES[1], 'tempera/stack']] as const) {
    test(`borrowed typography: ${host.name} composition with ${value}`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
        await setup(page, host);
        await page.evaluate(v => window.__lumi!.setComponent(3, 0, 'typography', v), value);
        await settle(page);
        const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots[0]);
        const late = Math.min(shot.endTime - 0.05, shot.startTime + (shot.endTime - shot.startTime) * 0.7);
        await renderAt(page, late);
        await expect(page.getByTestId('stage')).toHaveScreenshot(`borrowed-${host.name}-${value.replace('/', '-')}.png`);
        // 确定性：重建后同一时刻逐字节相同。
        const first = await page.getByTestId('stage').screenshot();
        await page.evaluate(() => window.__lumi!.rebuild());
        await renderAt(page, late);
        expect(Buffer.compare(first, await page.getByTestId('stage').screenshot())).toBe(0);
    });
}

for (const mode of [MODES[0], MODES[1]]) {
    test(`typography: ${mode.name} with serif, bold and larger lyrics`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
        await setup(page, mode);
        const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots[0]);
        const time = Math.min(shot.endTime - 0.05, shot.startTime + (shot.endTime - shot.startTime) * 0.7);
        await renderAt(page, time);
        const before = await page.getByTestId('stage').screenshot();
        await page.evaluate(() => window.__lumi!.setTypography({ lyrics: { style: 'serif', weight: 800, scale: 1.3 } }));
        await settle(page);
        await renderAt(page, time);
        const after = await page.getByTestId('stage').screenshot();
        expect(Buffer.compare(before, after)).not.toBe(0);
        await expect(page.getByTestId('stage')).toHaveScreenshot(`typography-${mode.name}.png`);
    });
}

test('asset layer: images in back and front slots, anchored to a shot, with entry animation', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[0]);
    const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3].shots[0]);
    const shotAnchor = await page.evaluate(() => {
        const p = window.__lumi!.inspect().paragraphs[3];
        return p.lines[0];
    });
    expect(shotAnchor).toBeGreaterThanOrEqual(0);
    await page.evaluate(async ({ start, end }) => {
        const lumi = window.__lumi!;
        const back = await lumi.addTestImage('back', '#e11d48');
        const front = await lumi.addTestImage('front', '#22d3ee');
        lumi.addClip(back, { timing: { type: 'absolute', start, end }, slot: 'back', x: 0.25, y: 0.55, scale: 0.8, enter: { type: 'none', duration: 0 } });
        lumi.addClip(front, { timing: { type: 'absolute', start, end }, slot: 'front', x: 0.8, y: 0.6, scale: 0.4, rotation: 0.2, enter: { type: 'slide-up', duration: 0.6 } });
    }, { start: shot.startTime, end: shot.endTime + 2 });
    await settle(page);
    const middle = (shot.startTime + shot.endTime) / 2;
    await renderAt(page, middle);
    await expect(page.getByTestId('stage')).toHaveScreenshot('assets-back-front.png');
    // 入场动画中段与确定性。
    await renderAt(page, shot.startTime + 0.3);
    const entering = await page.getByTestId('stage').screenshot();
    await page.evaluate(() => window.__lumi!.rebuild());
    await renderAt(page, shot.startTime + 0.3);
    expect(Buffer.compare(entering, await page.getByTestId('stage').screenshot())).toBe(0);
});

const renderPrepared = async (page: Page, time: number) => {
    await page.evaluate(async t => {
        window.__lumi!.seek(t);
        await window.__lumi!.prepareFrame(t);
        window.__lumi!.renderOnce();
    }, time);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(null))));
};

test('background track: gradient per paragraph and a looping video background', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, MODES[1]);
    const paragraphs = await page.evaluate(() => window.__lumi!.inspect().paragraphs);
    const video = await page.evaluate(() => window.__lumi!.addTestVideo('bar', 2));
    await page.evaluate(({ start, videoId, split }) => {
        const lumi = window.__lumi!;
        lumi.addBackground({ type: 'gradient', from: '#0f766e', to: '#1e1b4b', angle: 30 }, { type: 'absolute', start, end: split }, { dim: 0, kenBurns: 0, fadeIn: 0, fadeOut: 0 });
        lumi.addBackground({ type: 'video', assetId: videoId, offset: 0, loop: true }, { type: 'absolute', start: split, end: split + 30 }, { dim: 0.2, kenBurns: 0, fadeIn: 0, fadeOut: 0 });
    }, { start: paragraphs[3].startTime, split: paragraphs[4].startTime, videoId: video });
    await settle(page);
    await renderPrepared(page, paragraphs[3].startTime + 1);
    await expect(page.getByTestId('stage')).toHaveScreenshot('background-gradient.png');
    // 视频：两个时刻色条位置不同；同一时刻重建后逐字节相同。
    const t1 = paragraphs[4].startTime + 0.5;
    await renderPrepared(page, t1);
    const first = await page.getByTestId('stage').screenshot();
    await renderPrepared(page, t1 + 1);
    expect(Buffer.compare(first, await page.getByTestId('stage').screenshot())).not.toBe(0);
    await page.evaluate(() => window.__lumi!.rebuild());
    await renderPrepared(page, t1);
    expect(Buffer.compare(first, await page.getByTestId('stage').screenshot())).toBe(0);
    await expect(page.getByTestId('stage')).toHaveScreenshot('background-video.png');
});
