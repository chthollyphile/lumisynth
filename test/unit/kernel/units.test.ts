import { describe, expect, it } from 'vitest';
import { compileLumiProgram } from '@/compiler/compile';
import { buildUnits } from '@/kernel/units';
import { syntheticSong } from '../compiler/fixtures';

describe('scene unit cache keys', () => {
    it('change exactly for the unit whose content changed (e.g. a manual segmentation)', () => {
        const lines = syntheticSong(41, true);
        const before = buildUnits(compileLumiProgram({ lines, seed: 'units', direction: { mode: 'single', pack: 'sonnet', shotMixing: false } }));
        const target = before[2].paragraph.lineIndices[0];
        const text = lines[target].fullText;
        const edited = lines.map((line, index) => (index === target
            ? { ...line, wordSegments: [text.slice(0, 1), text.slice(1)] }
            : line));
        const after = buildUnits(compileLumiProgram({ lines: edited, seed: 'units', direction: { mode: 'single', pack: 'sonnet', shotMixing: false } }));
        expect(after.length).toBe(before.length);
        after.forEach((unit, index) => {
            if (index === 2) expect(unit.key).not.toBe(before[index].key);
            else expect(unit.key).toBe(before[index].key);
        });
    });
});
