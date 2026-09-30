// test/unit/packs/styleNotes.test.ts
// 绘光、商籁、花火的风格目录带画面描述：每个风格有中文名、15–90 字的描述、至少 3 个关键词；每个族有描述；
// 组件槽与每个选项都有描述。给 AI 编排与 agent 的 list_styles 看。
import { describe, expect, it } from 'vitest';
import { getPack } from '@/packs/registry';

const PACKS = [
    { id: 'lumiere', styles: 100 },
    { id: 'sonnet', styles: 7 },
    { id: 'hanabi', styles: 50 },
];

describe.each(PACKS)('$id 的风格描述', ({ id, styles }) => {
    const pack = getPack(id);

    it('每个风格都有中文名、15–90 字的描述与至少 3 个关键词', () => {
        expect(pack.styles).toHaveLength(styles);
        const problems = pack.styles.flatMap(style => {
            const issues: string[] = [];
            if (!style.label?.trim()) issues.push('label 为空');
            const length = style.description?.length ?? 0;
            if (length < 15 || length > 90) issues.push(`description ${length} 字：${style.description ?? ''}`);
            const keywords = style.keywords ?? [];
            if (keywords.length < 3 || keywords.some(word => !word.trim())) issues.push(`keywords ${JSON.stringify(keywords)}`);
            if (new Set(keywords).size !== keywords.length) issues.push('keywords 有重复');
            return issues.map(issue => `${style.id}: ${issue}`);
        });
        expect(problems).toEqual([]);
    });

    it('描述互不相同', () => {
        const descriptions = pack.styles.map(style => style.description);
        expect(new Set(descriptions).size).toBe(descriptions.length);
    });

    it('每个族都有描述', () => {
        const used = new Set(pack.styles.map(style => style.family));
        expect(pack.families.filter(family => used.has(family.id)).length).toBe(used.size);
        pack.families.forEach(family => expect(family.description?.trim(), family.id).toBeTruthy());
    });

    it('组件槽与每个选项都有描述', () => {
        const slots = pack.componentSlots ?? [];
        expect(slots.length).toBeGreaterThan(0);
        slots.forEach(slot => {
            expect(slot.description?.trim(), slot.id).toBeTruthy();
            slot.options.forEach(option => expect(option.description?.trim(), `${slot.id}/${option.id}`).toBeTruthy());
        });
    });
});

describe('容易误解名字的风格', () => {
    it('绘光 stage-cross 写明交叉的是两道追光', () => {
        const style = getPack('lumiere').styles.find(item => item.kind === 'stage-cross')!;
        expect(style.label).toBe('交叉');
        expect(style.description).toContain('追光');
        expect(style.description).toContain('不是十字架');
    });

    it('声明了十字爆闪的光位在描述与关键词里都提到', () => {
        getPack('lumiere').styles
            .filter(style => ['zenith-crown', 'stage-cross', 'stage-strobe', 'botany-bloom'].includes(style.kind))
            .forEach(style => {
                expect(style.description, style.kind).toContain('十字爆闪');
                expect(style.keywords, style.kind).toContain('十字爆闪');
            });
    });
});
