// test/unit/packs/temperaStyleNotes.test.ts
// 凝彩的风格描述：每个风格都有中文名、画面描述（25–70 个汉字）与 3–6 个关键词，每个族与组件选项都有描述，
// 且合进 pack 后风格的 id 与顺序不变。
import { describe, expect, it } from 'vitest';
import { temperaPack } from '@/packs/tempera/pack';
import { TEMPERA_SHOT_KINDS } from '@/packs/tempera/types';
import { TEMPERA_STYLE_NOTES } from '@/packs/tempera/temperaStyleNotes';

const hanCount = (text: string) => (text.match(/[一-鿿]/g) ?? []).length;

describe('凝彩的风格描述', () => {
    it('风格顺序与 id 保持 TEMPERA_SHOT_KINDS 的顺序', () => {
        expect(temperaPack.styles.map(style => style.id)).toEqual(TEMPERA_SHOT_KINDS.map(kind => `tempera/${kind}`));
    });

    it('每个风格都有中文名、25–70 个汉字的描述与 3–6 个关键词', () => {
        const problems = temperaPack.styles.flatMap(style => {
            const issues: string[] = [];
            if (!style.label?.trim()) issues.push('label');
            const description = style.description?.trim() ?? '';
            const han = hanCount(description);
            if (han < 25 || han > 70) issues.push(`description ${han}`);
            const keywords = style.keywords ?? [];
            if (keywords.length < 3 || keywords.length > 6) issues.push(`keywords ${keywords.length}`);
            if (keywords.some(keyword => !keyword.trim())) issues.push('empty keyword');
            if (new Set(keywords).size !== keywords.length) issues.push('duplicate keyword');
            return issues.length > 0 ? [`${style.kind}: ${issues.join(', ')}`] : [];
        });
        expect(problems).toEqual([]);
    });

    it('中文名互不相同，描述不只是复述英文名', () => {
        const labels = temperaPack.styles.map(style => style.label);
        expect(new Set(labels).size).toBe(labels.length);
        // 描述里不出现 kind 本身（英文名），写的是画面。
        const echoing = temperaPack.styles.filter(style => style.description?.includes(style.kind));
        expect(echoing.map(style => style.kind)).toEqual([]);
    });

    it('描述表没有多余或缺失的 kind', () => {
        expect(Object.keys(TEMPERA_STYLE_NOTES).sort()).toEqual([...TEMPERA_SHOT_KINDS].sort());
    });

    it('每个族都有描述', () => {
        expect(temperaPack.families).toHaveLength(13);
        const missing = temperaPack.families.filter(family => !family.description?.trim()).map(family => family.id);
        expect(missing).toEqual([]);
    });

    it('组件槽与每个选项都有描述', () => {
        const slots = temperaPack.componentSlots ?? [];
        expect(slots.map(slot => slot.id)).toEqual(['typography', 'accent']);
        expect(slots.find(slot => slot.id === 'typography')?.options).toHaveLength(4);
        expect(slots.find(slot => slot.id === 'accent')?.options).toHaveLength(6);
        const missing = slots.flatMap(slot => [
            ...(slot.description?.trim() ? [] : [slot.id]),
            ...slot.options.filter(option => !option.description?.trim()).map(option => `${slot.id}/${option.id}`),
        ]);
        expect(missing).toEqual([]);
    });
});
