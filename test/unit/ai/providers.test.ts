// 浏览器直连的 AI：三类提供方的请求体、JSON 解析与清洗、跨域失败的提示、密钥的存放位置。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestSceneDirection, requestSegmentation, requestTheme, testAiConnection } from '@/ai/client';
import { sanitizeSceneDirection, type SceneDirectionRequest } from '@/ai/sceneDirection';
import {
    DEFAULT_AI_SETTINGS,
    patchAiConfig,
    setAiKey,
    setAiProvider,
    setRememberKeys,
    useAiSettings,
} from '@/ai/settings';

const geminiReply = (value: unknown) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }],
}), { status: 200 });

const openaiReply = (value: unknown) => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }],
}), { status: 200 });

const anthropicReply = (value: unknown) => new Response(JSON.stringify({
    content: [{ type: 'tool_use', name: 'x', input: value }],
    stop_reason: 'tool_use',
}), { status: 200 });

const theme = (bg: string) => ({
    name: '测试', backgroundColor: bg, primaryColor: '#111111', accentColor: '#ff0000', secondaryColor: '#555555',
    wordColors: [{ word: '光', color: '#ffcc00' }], lyricsIcons: ['Sun'],
});

const directionRequest: SceneDirectionRequest = {
    song: { title: 't', artist: 'a' },
    packs: [
        { id: 'tempera', label: '凝彩', description: 'd', families: [{ id: 'split', label: '分割', moods: ['loud'] }], transitions: [{ id: 'tempera/block-wipe', label: 'w' }] },
        { id: 'sonnet', label: '商籁', description: 'd', families: [{ id: 'typography', label: '排字', moods: ['neutral'] }], transitions: [{ id: 'sonnet/fast-blur', label: 'b' }] },
    ],
    paragraphs: [
        { index: 0, kind: 'verse', startTime: 0, endTime: 10, text: 'a', loudness: 0.3 },
        { index: 1, kind: 'chorus', startTime: 10, endTime: 20, text: 'b', loudness: 0.9 },
    ],
};

const sent = (mock: ReturnType<typeof vi.fn>, call = 0) => {
    const [url, init] = mock.mock.calls[call] as unknown as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
};

beforeEach(() => {
    useAiSettings.setState({ ...structuredClone(DEFAULT_AI_SETTINGS), keys: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('browser AI providers', () => {
    it('refuses to run without a configured provider', async () => {
        await expect(requestTheme('x', false, '')).rejects.toThrow(/还没有配置 AI/);
        setAiProvider('gemini');
        await expect(requestTheme('x', false, '')).rejects.toThrow(/还没有配置 AI/);
    });

    it('generates a sanitized dual theme through Gemini with the configured model', async () => {
        const fetchMock = vi.fn(async () => geminiReply({ light: theme('#fafafa'), dark: theme('not-a-color') }));
        vi.stubGlobal('fetch', fetchMock);
        setAiProvider('gemini');
        setAiKey('gemini', ' key ');
        patchAiConfig('gemini', { model: 'gemini-x' });
        const dual = await requestTheme('光と影', false, '');
        expect(dual.light).toMatchObject({ backgroundColor: '#fafafa', provider: 'Google Gemini' });
        expect(dual.dark.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i);
        const { url, headers, body } = sent(fetchMock);
        expect(url).toContain('/models/gemini-x:generateContent');
        expect(headers['x-goog-api-key']).toBe('key');
        expect(body.generationConfig.responseMimeType).toBe('application/json');
    });

    it('uses an OpenAI-compatible endpoint, normalizing its URL and picking the DeepSeek default model', async () => {
        const fetchMock = vi.fn(async () => openaiReply({ light: theme('#ffffff'), dark: theme('#000000') }));
        vi.stubGlobal('fetch', fetchMock);
        setAiProvider('openai');
        setAiKey('openai', 'k');
        patchAiConfig('openai', { baseUrl: 'https://api.deepseek.com/v1' });
        await requestTheme('x', false, '');
        const { url, headers, body } = sent(fetchMock);
        expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(headers.Authorization).toBe('Bearer k');
        expect(body.model).toBe('deepseek-v4-flash');
        expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('allows a keyless local OpenAI-compatible server', async () => {
        const fetchMock = vi.fn(async () => openaiReply({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        setAiProvider('openai');
        patchAiConfig('openai', { baseUrl: 'http://localhost:11434/v1', model: 'qwen3' });
        await testAiConnection();
        const { url, headers } = sent(fetchMock);
        expect(url).toBe('http://localhost:11434/v1/chat/completions');
        expect(headers.Authorization).toBeUndefined();
    });

    it('calls Anthropic with a forced tool and the browser-access header', async () => {
        const fetchMock = vi.fn(async () => anthropicReply({ light: theme('#ffffff'), dark: theme('#000000') }));
        vi.stubGlobal('fetch', fetchMock);
        setAiProvider('anthropic');
        setAiKey('anthropic', 'sk-ant');
        const dual = await requestTheme('x', false, '');
        expect(dual.light.provider).toBe('Anthropic Claude');
        const { url, headers, body } = sent(fetchMock);
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(headers['x-api-key']).toBe('sk-ant');
        expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
        expect(body.model).toBe('claude-sonnet-5');
        expect(body.tool_choice).toEqual({ type: 'tool', name: 'dual_theme' });
        expect(body.tools[0].input_schema.required).toEqual(['light', 'dark']);
    });

    it('explains network / CORS failures instead of surfacing "Failed to fetch"', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        setAiProvider('anthropic');
        setAiKey('anthropic', 'k');
        await expect(testAiConnection()).rejects.toThrow(/api\.anthropic\.com.*跨域/);
    });

    it('reports HTTP errors with the provider detail', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })));
        setAiProvider('gemini');
        setAiKey('gemini', 'k');
        await expect(testAiConnection()).rejects.toThrow(/Gemini 接口出错（401）.*bad key/);
    });

    it('segments lyrics through folia\'s service (Gemini) and through Claude', async () => {
        const lines = ['光と影', 'hello world'];
        const reply = { lines: [['光', 'と', '影'], ['hello ', 'world']] };
        const gemini = vi.fn(async () => geminiReply(reply));
        vi.stubGlobal('fetch', gemini);
        setAiProvider('gemini');
        setAiKey('gemini', 'k');
        const viaGemini = await requestSegmentation(lines);
        expect(viaGemini.lines.map(parts => parts.join(''))).toEqual(lines);
        expect(sent(gemini).url).toContain('gemini-3-flash-preview');

        const claude = vi.fn(async () => anthropicReply(reply));
        vi.stubGlobal('fetch', claude);
        setAiProvider('anthropic');
        setAiKey('anthropic', 'k');
        const viaClaude = await requestSegmentation(lines);
        expect(viaClaude.lines).toEqual(viaGemini.lines);
    });

    it('directs scenes and keeps only ids from the catalog', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => geminiReply({
            summary: '主歌冷静，副歌爆发',
            paragraphs: [
                { index: 0, pack: 'sonnet', energy: 0.2, families: ['typography', 'nope'], transition: 'tempera/block-wipe', reason: '叙述' },
                { index: 1, pack: 'tempera', energy: 3, families: ['split'], transition: 'made-up', reason: '副歌' },
                { index: 7, pack: 'tempera', energy: 1, families: [], transition: 'auto', reason: 'x' },
            ],
        })));
        setAiProvider('gemini');
        setAiKey('gemini', 'k');
        const body = await requestSceneDirection(directionRequest);
        expect(body.summary).toBe('主歌冷静，副歌爆发');
        expect(body.paragraphs).toEqual([
            { index: 0, pack: 'sonnet', energy: 0.2, families: ['typography'], transition: 'tempera/block-wipe', reason: '叙述' },
            { index: 1, pack: 'tempera', energy: 1, families: ['split'], transition: 'auto', reason: '副歌' },
        ]);
    });

    it('drops direction entries with unknown packs and duplicate indices', () => {
        const result = sanitizeSceneDirection({
            paragraphs: [
                { index: 0, pack: 'ghost', energy: 0.5, families: [], transition: 'auto' },
                { index: 1, pack: 'sonnet', energy: 0.5, families: [], transition: 'none' },
                { index: 1, pack: 'tempera', energy: 0.5, families: [], transition: 'auto' },
            ],
        }, directionRequest);
        expect(result.paragraphs.map(item => [item.index, item.pack, item.transition])).toEqual([[1, 'sonnet', 'none']]);
    });
});

describe('key storage', () => {
    const fakeStorage = () => {
        const map = new Map<string, string>();
        return {
            map,
            getItem: (key: string) => map.get(key) ?? null,
            setItem: (key: string, value: string) => { map.set(key, value); },
            removeItem: (key: string) => { map.delete(key); },
        };
    };

    it('keeps keys in localStorage when remembered, sessionStorage otherwise, never both', () => {
        const local = fakeStorage();
        const session = fakeStorage();
        vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
        setAiProvider('gemini');
        setAiKey('gemini', 'secret');
        expect(local.map.get('lumisynth:ai-keys')).toContain('secret');
        expect(local.map.get('lumisynth:ai')).not.toContain('secret');
        setRememberKeys(false);
        expect(local.map.has('lumisynth:ai-keys')).toBe(false);
        expect(session.map.get('lumisynth:ai-keys')).toContain('secret');
    });
});
