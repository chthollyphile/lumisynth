// 光束公式的 TS / GLSL 对拍：字与浮尘的受光按 CPU 那一份算，光场按着色器那一份画，两边必须一致
// （光柱照到哪里、窗影挡在哪里，字就在哪里亮 / 暗）。在实验页里只画光场、读回像素比较。
import { expect, test } from '@playwright/test';

test('lumiere light field: GLSL matches the CPU beam formula', async ({ page }) => {
    await page.goto('/lab/lumiere.html');
    await page.waitForFunction(() => Boolean((window as unknown as { __lumiereLab?: unknown }).__lumiereLab), undefined, { timeout: 30_000 });
    const result = await page.evaluate(() => (window as unknown as {
        __lumiereLab: { parity: (samples: number) => { maxError: number; meanError: number; litSamples: number; samples: number } };
    }).__lumiereLab.parity(400));
    // 采样点里要有足够多落在光束里，否则对拍没有意义。
    expect(result.litSamples).toBeGreaterThan(60);
    // 8 位量化 + 抖动 ±0.5/255 + 单精度与双精度的差。实测（RTX 5070 Ti）最大 0.0033、平均 0.0004，
    // 即一个 8 位台阶以内；门限留一点余量给别的 GPU。
    expect(result.meanError).toBeLessThan(0.002);
    expect(result.maxError).toBeLessThan(0.012);
});
