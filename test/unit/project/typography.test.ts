// 字体设置：从旧工程的主题字段迁移、套到渲染主题上、字幕继承、进 .lumi 的资源列表。
import { describe, expect, it } from 'vitest';
import { callAgentTool } from '@/agent/tools';
import { resolveThemeFontStack } from '@/engine/shared/fontStacks';
import { projectAssetRefs } from '@/project/archive';
import { createProject, normalizeProject, renderFonts } from '@/project/defaults';
import { useProjectStore } from '@/project/store';
import { normalizeTypography } from '@/project/typography';

describe('project typography', () => {
    it('migrates font fields from the theme of older projects', () => {
        const base = createProject();
        const legacy = normalizeProject({
            ...base,
            typography: undefined,
            theme: { ...base.theme, dual: { ...base.theme.dual, dark: { ...base.theme.dual.dark, fontStyle: 'serif', fontFamily: 'Foo', fontFamilyStack: ['Bar', 'foo'], fontWeight: 650 } } },
        } as never);
        expect(legacy.typography.lyrics).toEqual({ style: 'serif', families: ['Foo', 'Bar'], weight: 650, scale: 1 });
        expect(legacy.typography.subtitles.inherit).toBe(true);
    });

    it('clamps and normalizes values', () => {
        const typography = normalizeTypography({
            lyrics: { style: 'weird' as never, families: [' "A" ', 'a', ''], weight: 1234, scale: 9 },
        });
        expect(typography.lyrics).toEqual({ style: 'sans', families: ['A'], weight: 900, scale: 1.6 });
    });

    it('applies lyric fonts to the render theme and subtitle fonts separately', () => {
        const project = createProject();
        project.typography = normalizeTypography({
            lyrics: { style: 'serif', families: ['My Font'], weight: 300, scale: 1.2 },
            subtitles: { style: 'mono', families: [], weight: null, inherit: false },
        });
        const fonts = renderFonts(project);
        expect(resolveThemeFontStack(fonts.theme).startsWith('"My Font", ')).toBe(true);
        expect(fonts.theme.fontWeight).toBe(300);
        expect(fonts.theme.backgroundColor).toBe(project.theme.dual.dark.backgroundColor);
        expect(fonts.lyricsFontScale).toBe(1.2);
        expect(fonts.subtitleTheme.fontStyle).toBe('mono');
        project.typography.subtitles.inherit = true;
        expect(renderFonts(project).subtitleTheme.fontFamilyStack).toEqual(['My Font']);
    });

    it('packs uploaded fonts into .lumi archives', () => {
        const project = createProject();
        const asset = { id: 'font-1', name: 'x.woff2', type: 'font/woff2', size: 10 };
        project.typography = { ...project.typography, fonts: [{ family: 'X', asset }] };
        expect(projectAssetRefs(project)).toContainEqual(asset);
    });

    it('lets an agent change fonts, keeping omitted fields', async () => {
        useProjectStore.getState().replace(createProject());
        const result = await callAgentTool('set_typography', { lyrics: { families: ['Noto Serif JP'], scale: 1.1 }, subtitles: { inherit: false } });
        expect(result.isError).toBeUndefined();
        const { typography } = useProjectStore.getState().project;
        expect(typography.lyrics).toMatchObject({ style: 'sans', families: ['Noto Serif JP'], scale: 1.1 });
        expect(typography.subtitles.inherit).toBe(false);
    });
});
