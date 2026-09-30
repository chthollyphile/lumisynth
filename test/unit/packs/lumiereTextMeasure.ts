// test/unit/packs/lumiereTextMeasure.ts
// 绘光折行测试共用：给 pretext 一个假的 OffscreenCanvas（node 里没有 canvas）。
/**
 * 给 pretext 一个假的 OffscreenCanvas：node 里没有 canvas，歌词窗口的折行要量字宽。
 * 宽度模型与各测试里假的字形条一致：中日文一个字号，空格 0.3 个字号，其余 0.55 个字号（按字体串里的 px）。
 */
export const installFakeTextMeasure = () => {
    const UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]/u;
    class FakeContext {
        font = '10px sans-serif';
        measureText(text: string) {
            const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
            let width = 0;
            for (const char of Array.from(text)) width += px * (char.trim() === '' ? 0.3 : UPRIGHT.test(char) ? 1 : 0.55);
            return { width };
        }
    }
    class FakeOffscreenCanvas {
        constructor(public width: number, public height: number) {}
        getContext() { return new FakeContext(); }
    }
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeOffscreenCanvas;
};
