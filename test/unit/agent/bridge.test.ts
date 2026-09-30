// 本地 MCP 桥的端到端测试：真的启动 public/lumisynth-mcp.mjs，一边用 stdio 扮演 agent（MCP 客户端），
// 一边用 HTTP 扮演 lumisynth 页面（配对、上报工具、长轮询、回传结果）。
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 47000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcessWithoutNullStreams;
const inbox: Array<Record<string, unknown>> = [];
const waiters: Array<() => void> = [];
let nextId = 1;

const send = (method: string, params?: unknown) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return waitFor(message => message.id === id);
};

const waitFor = async (match: (message: Record<string, unknown>) => boolean, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
        const index = inbox.findIndex(match);
        if (index >= 0) return inbox.splice(index, 1)[0] as { result?: any; error?: any; method?: string };
        if (Date.now() > deadline) throw new Error('timeout waiting for MCP message');
        await new Promise<void>(resolve => {
            waiters.push(resolve);
            setTimeout(resolve, 50);
        });
    }
};

const page = (route: string, init: RequestInit & { token?: string } = {}) => {
    const { token, ...rest } = init;
    return fetch(`${BASE}${route}`, {
        ...rest,
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3100', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
};

beforeAll(async () => {
    child = spawn(process.execPath, [path.resolve('public/lumisynth-mcp.mjs'), '--port', String(PORT)], { stdio: 'pipe' });
    createInterface({ input: child.stdout }).on('line', line => {
        inbox.push(JSON.parse(line));
        waiters.splice(0).forEach(resolve => resolve());
    });
    const ready = new Promise<void>(resolve => child.stderr.on('data', chunk => { if (String(chunk).includes('配对码')) resolve(); }));
    await ready;
});

afterAll(() => {
    child.stdin.end();
    child.kill();
});

describe('lumisynth-mcp bridge', () => {
    let token = '';

    it('initializes and exposes only the connect tool before a page pairs', async () => {
        const init = await send('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
        expect(init.result.serverInfo.name).toBe('lumisynth');
        expect(init.result.capabilities.tools.listChanged).toBe(true);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const list = await send('tools/list');
        expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['lumisynth_connect']);
        const call = await send('tools/call', { name: 'get_project', arguments: {} });
        expect(call.result.isError).toBe(true);
        expect((await send('nope/method')).error.code).toBe(-32601);
    });

    it('pairs with the code the agent relays, rejecting wrong codes and missing tokens', async () => {
        const status = await send('tools/call', { name: 'lumisynth_connect', arguments: {} });
        const code = /配对码 ([A-Z0-9]{6})/.exec(status.result.content[0].text)![1];
        expect((await page('/pair', { method: 'POST', body: JSON.stringify({ code: 'WRONG1' }) })).status).toBe(403);
        expect((await page('/poll')).status).toBe(401);
        const preflight = await fetch(`${BASE}/pair`, { method: 'OPTIONS', headers: { Origin: 'https://example.com' } });
        expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
        const paired = await page('/pair', { method: 'POST', body: JSON.stringify({ code: code.toLowerCase() }) });
        expect(paired.status).toBe(200);
        expect(paired.headers.get('access-control-allow-origin')).toBe('http://localhost:3100');
        token = (await paired.json() as { token: string }).token;
        // 配对码只能用一次。
        expect((await page('/pair', { method: 'POST', body: JSON.stringify({ code }) })).status).toBe(403);
    });

    it('forwards tool calls and prompts to the page and relays the results', async () => {
        const hello = await page('/hello', {
            method: 'POST',
            token,
            body: JSON.stringify({
                tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }],
                prompts: [{ name: 'theme', description: 'Theme' }],
            }),
        });
        expect(hello.status).toBe(200);
        await waitFor(message => message.method === 'notifications/tools/list_changed');
        const list = await send('tools/list');
        expect(list.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['lumisynth_connect', 'echo']);

        // 页面：取一个请求，回传。
        const servePage = async () => {
            const polled = await page('/poll', { token });
            expect(polled.status).toBe(200);
            const request = await polled.json() as { id: number; method: string; params: { name: string; arguments: { value?: string } } };
            const result = request.method === 'tools/call'
                ? { content: [{ type: 'text', text: `echo:${request.params.arguments.value}` }], structuredContent: { value: request.params.arguments.value, version: 'abc' } }
                : { messages: [{ role: 'user', content: { type: 'text', text: `prompt:${request.params.name}` } }] };
            await page('/reply', { method: 'POST', token, body: JSON.stringify({ id: request.id, result }) });
        };
        const [call] = await Promise.all([send('tools/call', { name: 'echo', arguments: { value: '光' } }), servePage()]);
        expect(call.result.content[0].text).toBe('echo:光');
        // 结构化结果原样转发。
        expect(call.result.structuredContent).toEqual({ value: '光', version: 'abc' });
        const [prompt] = await Promise.all([send('prompts/get', { name: 'theme' }), servePage()]);
        expect(prompt.result.messages[0].content.text).toBe('prompt:theme');
        expect((await send('prompts/list')).result.prompts).toEqual([{ name: 'theme', description: 'Theme' }]);
    });

    it('drops the page on bye and asks for a fresh code', async () => {
        await page('/bye', { method: 'POST', token });
        const list = await send('tools/list');
        expect(list.result.tools).toHaveLength(1);
        expect((await page('/poll', { token })).status).toBe(401);
    });
});
