// 绘光的光位目录：100 种、与设计文档第二节的表格逐条一致，每族排版 4 横 / 3 竖 / 3 纵横，每个光位都画得出来。
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { createRng } from '@/core/rng';
import { LUMIERE_FAMILY_LABELS, LUMIERE_PROFILES } from '@/packs/lumiere/catalog';
import { MAX_BEAMS, resolveBeams } from '@/packs/lumiere/light/rig';

const MOOD_CODE = { quiet: 'q', neutral: 'n', loud: 'l' } as const;

/** 从 docs/LUMIERE.md 第二节的表格里读出 kind → mood（设计文档只在 dev 分支，main 上没有就跳过对表）。 */
const DESIGN_DOC = path.resolve('docs/LUMIERE.md');
const documented = (() => {
    if (!fs.existsSync(DESIGN_DOC)) return new Map<string, { label: string; mood: string }>();
    const text = fs.readFileSync(DESIGN_DOC, 'utf-8');
    const rows = [...text.matchAll(/^\| ([a-z]+-[a-z-]+) \| (.+?) \| ([qnl]) \|/gm)];
    return new Map(rows.map(([, kind, label, mood]) => [kind!, { label: label!, mood: mood! }]));
})();

describe('绘光光位目录', () => {
    it('10 族 × 10 种，kind 不重复', () => {
        expect(LUMIERE_PROFILES).toHaveLength(100);
        expect(new Set(LUMIERE_PROFILES.map(profile => profile.kind)).size).toBe(100);
        for (const family of Object.keys(LUMIERE_FAMILY_LABELS)) {
            expect(LUMIERE_PROFILES.filter(profile => profile.family === family), family).toHaveLength(10);
        }
    });

    it.skipIf(!fs.existsSync(DESIGN_DOC))('与设计文档的表格逐条一致（kind、名字、mood）', () => {
        expect(documented.size).toBe(100);
        for (const profile of LUMIERE_PROFILES) {
            const row = documented.get(profile.kind);
            expect(row, profile.kind).toBeDefined();
            expect(row!.label, profile.kind).toBe(profile.label);
            expect(row!.mood, profile.kind).toBe(MOOD_CODE[profile.mood]);
        }
    });

    it('每族排版 4 横 / 3 竖 / 3 纵横', () => {
        for (const family of Object.keys(LUMIERE_FAMILY_LABELS)) {
            const members = LUMIERE_PROFILES.filter(profile => profile.family === family);
            const count = (typography: string) => members.filter(profile => profile.typography === typography).length;
            expect([count('horizontal'), count('vertical'), count('crossed')], family).toEqual([4, 3, 3]);
        }
    });

    it.each(LUMIERE_PROFILES.map(profile => [profile.kind, profile] as const))('%s：光束合法、文字区在画内、线稿有限', (_kind, profile) => {
        const aspect = 16 / 9;
        const context = { aspect, random: createRng(`catalog:${profile.kind}`) };
        const light = profile.light(context);
        expect(light.beams.length).toBeGreaterThan(0);
        expect(light.beams.length).toBeLessThanOrEqual(MAX_BEAMS);
        const beams = resolveBeams(light, 3, aspect, { intensity: 1, bass: 0, color: [1, 1, 1], local: 2 });
        beams.forEach(beam => {
            expect([beam.ox, beam.oy, beam.dx, beam.dy, beam.halfWidth, beam.length, beam.intensity].every(Number.isFinite)).toBe(true);
            expect(beam.length).toBeGreaterThan(0);
        });
        const { cx, cy, w, h } = profile.region;
        expect(cx - w / 2).toBeGreaterThanOrEqual(0);
        expect(cx + w / 2).toBeLessThanOrEqual(1);
        expect(cy - h / 2).toBeGreaterThanOrEqual(0);
        expect(cy + h / 2).toBeLessThanOrEqual(1);
        const art = profile.lineArt(context);
        expect(art.paths.length + art.nodes.length).toBeGreaterThan(0);
        expect(art.paths.every(p => p.points.length > 1 && p.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))).toBe(true);
        expect(art.nodes.every(n => Number.isFinite(n.at[0]) && Number.isFinite(n.at[1]))).toBe(true);
    });
});
