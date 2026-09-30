// 绘光接进编译器与内核后的回归基线：全曲用绘光，挑段首开场（星落中）、段内镜头中段、光位交接、
// 段落转场中段几个时刻；另有确定性检查（同一时刻从不同播放历史渲染，逐字节相同）、片尾卡、
// 跨包借排版（两个方向）、主题带关键字与图标时的画面。
import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

const settle = async (page: Page) => {
    await page.waitForTimeout(700);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

const setup = async (page: Page, pack = 'lumiere', lumiereTuning: Record<string, unknown> = {}) => {
    await page.goto('/?resolution=1');
    await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });
    await page.evaluate(([text, direction, tuning]) => {
        const lumi = window.__lumi!;
        // Keep the existing duo baseline; colorful.spec.ts covers the new default palette.
        lumi.patchTuning('tempera', { colorMode: 'duo' });
        if (Object.keys(tuning).length > 0) lumi.patchTuning('lumiere', tuning);
        lumi.setDirection({ mode: 'single', pack: direction });
        lumi.setSeed('lumiere');
        lumi.setDark(true);
        lumi.setMeta({ title: '大正浪漫', artist: 'YOASOBI', album: '' });
        lumi.loadLyrics('lumiere.lrc', text);
    }, [lyricText!, pack, lumiereTuning] as const);
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
    // 全曲开头：星空点亮的开场（开场时长被压到段落的 40% 以内）。
    const first = paragraphs[0]!;
    times.push({ label: 'opening', time: first.startTime + (first.endTime - first.startTime) * 0.3 });
    // 挑镜头多的段落：镜头中段与光位交接。
    const busy = paragraphs.map((p, index) => ({ p, index })).filter(({ p }) => p.shots.length >= 2).slice(0, 2);
    busy.forEach(({ index }) => {
        const shot = paragraphs[index]?.shots[1] ?? paragraphs[index]?.shots[0];
        if (shot) times.push({ label: `p${index}-shot`, time: (shot.startTime + shot.endTime) / 2 });
        const next = paragraphs[index]?.shots[1];
        if (next) times.push({ label: `p${index}-handoff`, time: next.startTime + 0.45 });
    });
    const transition = paragraphs.find(p => p.transition)?.transition;
    if (transition) times.push({ label: 'transition', time: (transition.startTime + transition.endTime) / 2 });
    return times;
});

test('lumiere baselines', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page);
    const styles = await page.evaluate(() => window.__lumi!.inspect().paragraphs.flatMap(p => p.shots.map(s => s.style)));
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every(style => style.startsWith('lumiere/'))).toBe(true);
    const times = await pickTimes(page);
    expect(times.length).toBeGreaterThanOrEqual(4);
    for (const { label, time } of times) {
        await renderAt(page, time);
        await expect(page.getByTestId('stage'), `lumiere ${label} @ ${time.toFixed(2)}s`).toHaveScreenshot(`lumiere-${label}.png`);
    }
});

test('lumiere: same frame regardless of playback history', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page);
    const [target] = (await pickTimes(page)).filter(entry => entry.label.endsWith('handoff'));
    const stage = page.getByTestId('stage');

    await page.evaluate(() => window.__lumi!.rebuild());
    await renderAt(page, target!.time);
    const direct = await stage.screenshot();

    for (let t = 0; t < target!.time; t += 1.7) await renderAt(page, t);
    await renderAt(page, target!.time);
    const walked = await stage.screenshot();

    expect(Buffer.compare(direct, walked)).toBe(0);
});

// 轨迹过渡：段落之间都是「轨迹」，整首并成一个场景单元。段落交界处是光位交接（不是转场帧）；
// 长单元里背景碎片按需栅格化，同一时刻从不同播放历史渲染仍须逐字节相同。
test('lumiere seamless transitions: one unit, boundary handoff, history-independent', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page, 'lumiere', { seamlessTransitions: true });
    const paragraphs = await page.evaluate(() => window.__lumi!.inspect().paragraphs);
    expect(paragraphs.length).toBeGreaterThan(2);
    paragraphs.slice(0, -1).forEach(p => expect(p.transition?.id).toBe('lumiere/trajectory'));
    const boundary = paragraphs[2]!.startTime + 0.45;
    const stage = page.getByTestId('stage');

    await renderAt(page, boundary);
    await expect(stage).toHaveScreenshot('lumiere-seamless-boundary.png');

    await page.evaluate(() => window.__lumi!.rebuild());
    await renderAt(page, boundary);
    const direct = await stage.screenshot();
    for (let t = 0; t < boundary; t += 1.7) await renderAt(page, t);
    await renderAt(page, boundary);
    expect(Buffer.compare(direct, await stage.screenshot())).toBe(0);
});

test('lumiere: end credits card', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page);
    const end = await page.evaluate(() => window.__lumi!.inspect().paragraphs.at(-1)!.endTime);
    await renderAt(page, end + 5);
    await expect(page.getByTestId('stage')).toHaveScreenshot('lumiere-credits.png');
});

// 主题的关键字与图标（默认主题里没有，只有 AI 生成的主题会带）：点亮后的关键字带关键字色，
// Lucide 图标画成金色线稿散落在文字区外。「君と君と伝え合う想い」唱完时：君、想い都已点亮，镜头已过 6 秒，图标描完。
test('lumiere: theme keywords and icons', async ({ page }) => {
    test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
    await setup(page);
    await page.evaluate(() => window.__lumi!.patchTheme({
        wordColors: [
            { word: '君', color: '#ff5a6e' },
            { word: '想い', color: '#5aa8ff' },
            { word: '手紙', color: '#7be495' },
            { word: '言葉', color: '#c792ff' },
        ],
        lyricsIcons: ['Mail', 'Feather', 'Clock', 'Heart', 'Sparkles', 'Moon'],
    }));
    await settle(page);
    const time = await page.evaluate(() => {
        const paragraph = window.__lumi!.inspect().paragraphs.find(p => p.texts.some(text => text.startsWith('君と君と')))!;
        return paragraph.shots[0]!.startTime + 6.3;
    });
    await renderAt(page, time);
    await expect(page.getByTestId('stage')).toHaveScreenshot('lumiere-theme-keywords-icons.png');
});

for (const [host, value] of [['tempera', 'lumiere/crossed'], ['lumiere', 'sonnet/poster-blocks']] as const) {
    test(`lumiere borrowed typography: ${host} with ${value}`, async ({ page }) => {
        test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
        await setup(page, host);
        await page.evaluate(v => window.__lumi!.setComponent(3, 0, 'typography', v), value);
        await settle(page);
        const shot = await page.evaluate(() => window.__lumi!.inspect().paragraphs[3]!.shots[0]!);
        await renderAt(page, shot.startTime + (shot.endTime - shot.startTime) * 0.7);
        await expect(page.getByTestId('stage')).toHaveScreenshot(`lumiere-borrowed-${host}-${value.replace('/', '-')}.png`);
    });
}
