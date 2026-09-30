// 界面字典：每种语言的键与中文（原文）一一对应，插值变量相同；复数形式（_one / _other……）算作同一个键。
import { describe, expect, it } from 'vitest';
import { i18next, LANGUAGES, resources } from '@/i18n';
import { APP_COMMANDS, APP_MENUS } from '@/app/appCommands';

type Tree = { [key: string]: string | Tree };

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** 键 → 这个键所有形式里出现过的插值变量。 */
const flatten = (tree: Tree, prefix = '', out = new Map<string, Set<string>>()) => {
    Object.entries(tree).forEach(([key, value]) => {
        const path = `${prefix}${key}`;
        if (typeof value !== 'string') {
            flatten(value, `${path}.`, out);
            return;
        }
        const base = path.replace(PLURAL, '');
        const variables = out.get(base) ?? new Set<string>();
        [...value.matchAll(/\{\{\s*(\w+)[^}]*\}\}/g)].forEach(match => variables.add(match[1]));
        out.set(base, variables);
    });
    return out;
};

const namespaces = Object.keys(resources.zh) as Array<keyof typeof resources.zh>;

describe('locales', () => {
    it('lists every language with a dictionary', () => {
        expect(LANGUAGES.map(language => language.code).sort()).toEqual(Object.keys(resources).sort());
    });

    LANGUAGES.filter(language => language.code !== 'zh').forEach(language => {
        it(`${language.code} has the same keys and interpolation variables as zh`, () => {
            const dictionary = resources[language.code] as unknown as Record<string, Tree>;
            expect(Object.keys(dictionary).sort()).toEqual([...namespaces].sort());
            namespaces.forEach(ns => {
                const source = flatten(resources.zh[ns] as unknown as Tree);
                const target = flatten(dictionary[ns]);
                expect([...target.keys()].sort(), `${language.code}/${ns}`).toEqual([...source.keys()].sort());
                source.forEach((variables, key) => {
                    // 复数形式里只有 count 可以省略（英文单数常把数字写成文字）。
                    const expected = [...variables].sort();
                    const actual = [...(target.get(key) ?? [])].sort();
                    expect(actual.filter(name => name !== 'count'), `${language.code}/${ns}:${key}`).toEqual(expected.filter(name => name !== 'count'));
                });
            });
        });
    });

    it('translates every command title, category and menu', async () => {
        for (const language of LANGUAGES) {
            await i18next.changeLanguage(language.code);
            APP_COMMANDS.forEach(command => {
                expect(command.title(), command.id).not.toMatch(/^(commands:)?titles\./);
                expect(command.category?.() ?? '', command.id).not.toMatch(/^(commands:)?categories\./);
            });
            APP_MENUS.forEach(menu => {
                expect(menu.label()).not.toMatch(/menus\./);
                menu.items.filter(item => item.startsWith('#')).forEach(item => {
                    expect(i18next.exists(`commands:groups.${item.slice(1)}`), item).toBe(true);
                });
            });
        }
        await i18next.changeLanguage('zh');
    });
});
