import fs from 'fs';
import path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FOLIA_ROOT } from '../../playwright.config';

// 内核对照 folia：upstream 项目用 folia 原版的两个 runtime（?engine=legacy + LUMI_UPSTREAM），
// lumisynth 项目用内核。两边都关掉后处理——内核把后处理作用在含背景的整帧上，这是有意的差异。
// 渲染倍率固定为 1.5（经纹理池吸附），与原版 runtime 的默认值一致。
const LYRIC_FILE = path.join(FOLIA_ROOT, 'test/test-song/YOASOBI - 大正浪漫-lrc-format1.lrc');
const SEED = 'baseline';
const PACKS = ['tempera', 'sonnet'] as const;
const TIMES = [3, 18.5, 30, 47.25, 75, 120];

// 渲染路径里还有 Math.random（sonnet 的引导线等）。重建场景前把它换成同一个种子的 PRNG，
// 两边按相同的随机序列构建当前场景。
const installSeededRandom = () => {
    // lumisynth 的渲染路径默认用按单元播种的随机流（core/rng.ts）；对照时改回 Math.random。
    (globalThis as { __LUMI_NATIVE_RANDOM?: boolean }).__LUMI_NATIVE_RANDOM = true;
    (window as unknown as { __reseed: () => void }).__reseed = () => {
        let a = 0x9e3779b9;
        Math.random = () => {
            a = (a + 0x6d2b79f5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };
    (window as unknown as { __reseed: () => void }).__reseed();
};

const settle = async (page: Page) => {
    await page.waitForTimeout(800);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};

const lyricText = fs.existsSync(LYRIC_FILE) ? fs.readFileSync(LYRIC_FILE, 'utf-8') : null;

for (const pack of PACKS) {
    for (const time of TIMES) {
        test(`${pack} @ ${time}s`, async ({ page }, testInfo) => {
            test.skip(!lyricText, `找不到测试歌词：${LYRIC_FILE}（设置 FOLIA_ROOT）`);
            await page.addInitScript(installSeededRandom);
            await page.goto(testInfo.project.name === 'upstream' ? '/?engine=legacy' : '/?resolution=1.5');
            await page.waitForFunction(() => (window.__lumi?.runtimeGeneration ?? 0) > 0, undefined, { timeout: 30_000 });

            await page.evaluate(({ pack, seed, name, text }) => {
                const lumi = window.__lumi!;
                lumi.setFoliaCompatible();
                lumi.setPack(pack);
                lumi.setSeed(seed);
                lumi.setPostProcess(false);
                // folia 的译文字幕是 DOM 层，对照页里没有。
                lumi.setSubtitles('none');
                // 内核的背景画在 Pixi 里、不透明，反色 filter 读到的是真实底色；folia 的画布透明，
                // 读到的是半透明色块。接近中灰时两边会选出不同的 ink/paper，这是有意的行为变化，
                // 所以对照 folia 时关掉反色；反色由 kernel.spec.ts 的自回归基线锁住。
                // Keep the existing duo baseline for the folia comparison.
                lumi.patchTuning('tempera', { textInversion: false, colorMode: 'duo' });
                lumi.loadLyrics(name, text);
            }, { pack, seed: SEED, name: 'baseline.lrc', text: lyricText! });
            await settle(page);

            await page.evaluate(t => {
                window.__lumi!.seek(t);
                (window as unknown as { __reseed: () => void }).__reseed();
                window.__lumi!.rebuild();
            }, time);
            await settle(page);
            await page.evaluate(async () => {
                const frame = () => new Promise(r => requestAnimationFrame(() => r(null)));
                for (let i = 0; i < 3; i += 1) {
                    window.__lumi!.renderOnce();
                    await frame();
                }
            });

            await expect(page.getByTestId('stage')).toHaveScreenshot(`${pack}-${String(time).replace('.', '_')}s.png`);
        });
    }
}
