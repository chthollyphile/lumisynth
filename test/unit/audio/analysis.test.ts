import { describe, expect, it } from 'vitest';
import { analyzeAudio, averageEnergy, mixToMono, sampleAudioFrame } from '@/core/audio/analysis';
import { fft } from '@/core/audio/fft';

const sine = (hz: number, seconds: number, sampleRate: number, amplitude = 0.8) => {
    const samples = new Float32Array(Math.round(seconds * sampleRate));
    for (let i = 0; i < samples.length; i += 1) samples[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    return samples;
};

describe('fft', () => {
    it('finds the bin of a pure tone', () => {
        const n = 64;
        const re = new Float64Array(n);
        const im = new Float64Array(n);
        for (let i = 0; i < n; i += 1) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
        fft(re, im);
        const magnitudes = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
        expect(magnitudes.indexOf(Math.max(...magnitudes))).toBe(5);
        expect(magnitudes[5]).toBeCloseTo(n / 2, 6);
    });
});

describe('analyzeAudio', () => {
    const sampleRate = 48000;

    it('puts a 80 Hz tone in the bass band and a 2 kHz tone in the vocal band', () => {
        const low = analyzeAudio(sine(80, 1, sampleRate), sampleRate);
        const high = analyzeAudio(sine(2000, 1, sampleRate), sampleRate);
        const mid = (a: Float32Array) => a[Math.floor(a.length / 2)];
        expect(mid(low.bands.bass)).toBeGreaterThan(100);
        expect(mid(low.bands.vocal)).toBeLessThan(mid(low.bands.bass) / 4);
        expect(mid(high.bands.vocal)).toBeGreaterThan(5);
        expect(mid(high.bands.bass)).toBeLessThan(mid(high.bands.vocal) / 4);
        expect(mid(low.power)).toBeGreaterThan(mid(high.power));
    });

    it('is silent on silence and sized by fps and duration', () => {
        const analysis = analyzeAudio(new Float32Array(sampleRate * 2), sampleRate, { fps: 30 });
        expect(analysis.power.length).toBe(60);
        expect(Math.max(...analysis.power)).toBe(0);
        expect(analysis.peaks.length).toBe(2 * 200);
    });

    it('interpolates frames and averages energy', () => {
        const analysis = analyzeAudio(sine(100, 2, sampleRate), sampleRate, { fps: 10 });
        const a = sampleAudioFrame(analysis, 1.0);
        const b = sampleAudioFrame(analysis, 1.1);
        const between = sampleAudioFrame(analysis, 1.05);
        expect(between.bass).toBeCloseTo((a.bass + b.bass) / 2, 4);
        expect(sampleAudioFrame(null, 3).power).toBe(0);
        const energy = averageEnergy(analysis, 0.5, 1.5)!;
        expect(energy).toBeGreaterThan(0);
        expect(energy).toBeLessThanOrEqual(1);
    });

    it('mixes channels to mono', () => {
        expect(Array.from(mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
    });
});
