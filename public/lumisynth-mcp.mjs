#!/usr/bin/env node
// public/lumisynth-mcp.mjs（随站点一起发布，页面「Agent」面板提供下载）
// lumisynth 的本地 MCP 桥：对 agent 是一个 stdio MCP 服务器，对浏览器里的 lumisynth 页面是一个只监听
// 127.0.0.1 的 HTTP 服务（页面长轮询取请求、回传结果）。工具本身都在页面里执行（src/agent/tools.ts），
// 这里只转发。没有依赖，Node 18+ 可直接运行：
//
//   node lumisynth-mcp.mjs [--port 47863] [--origin https://your.site]
//
// 配对：页面「Agent」面板里填这里给出的一次性配对码（agent 可以调用 lumisynth_connect 拿到它并告诉用户）。
// 配对成功后页面拿到一个随机令牌，之后每个请求都要带它；再配对会让旧令牌失效并换一个新配对码。
import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';

const VERSION = '0.1.0';
const PROTOCOL_VERSION = '2025-06-18';
const POLL_WAIT_MS = 25_000;
const PAGE_TIMEOUT_MS = 45_000;
const CALL_TIMEOUT_MS = 30 * 60_000;

const argValue = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const PORT = Number(argValue('--port', process.env.LUMISYNTH_MCP_PORT ?? '47863'));
const ALLOWED_ORIGIN = argValue('--origin', process.env.LUMISYNTH_MCP_ORIGIN ?? '');

const log = (...parts) => process.stderr.write(`[lumisynth-mcp] ${parts.join(' ')}\n`);

// ---------------------------------------------------------------------------------------------
// 页面会话

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const state = {
    code: newCode(),
    token: null,
    origin: null,
    lastSeen: 0,
    tools: [],
    prompts: [],
    queue: [],
    waiting: null,
    pending: new Map(),
    nextId: 1,
};

const connected = () => Boolean(state.token) && Date.now() - state.lastSeen < PAGE_TIMEOUT_MS;

const disconnect = (reason) => {
    if (!state.token) return;
    log(`页面断开（${reason}）。新的配对码：${state.code}`);
    state.token = null;
    state.tools = [];
    state.prompts = [];
    for (const [, pending] of state.pending) pending.reject(new Error('lumisynth 页面断开了'));
    state.pending.clear();
    state.queue = [];
    notify('notifications/tools/list_changed');
    notify('notifications/prompts/list_changed');
};

setInterval(() => {
    if (state.token && !connected()) disconnect('超时');
}, 5_000).unref();

/** 把一个请求交给页面执行，等它回传。 */
const forward = (method, params, timeout = CALL_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (!connected()) {
        reject(new Error('lumisynth 页面没有连接'));
        return;
    }
    const id = state.nextId++;
    const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error('lumisynth 页面没有在限定时间内回应'));
    }, timeout);
    state.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
    });
    state.queue.push({ id, method, params });
    flushQueue();
});

const flushQueue = () => {
    if (!state.waiting || state.queue.length === 0) return;
    const { res, timer } = state.waiting;
    state.waiting = null;
    clearTimeout(timer);
    sendJson(res, 200, state.queue.shift());
};

// ---------------------------------------------------------------------------------------------
// HTTP（页面一侧）

const corsHeaders = (req) => {
    const origin = req.headers.origin;
    return {
        'Access-Control-Allow-Origin': origin && (!ALLOWED_ORIGIN || origin === ALLOWED_ORIGIN) ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        // Chrome 访问本机地址前的预检（Private / Local Network Access）。
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
    };
};

let currentReq = null;
const sendJson = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(res.req ?? currentReq ?? { headers: {} }) });
    res.end(body === undefined ? '' : JSON.stringify(body));
};

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) {
            reject(new Error('请求体过大'));
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => {
        try {
            resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch (error) {
            reject(error);
        }
    });
    req.on('error', reject);
});

const authorized = (req) => {
    const header = req.headers.authorization ?? '';
    return Boolean(state.token) && header === `Bearer ${state.token}`;
};

const server = createServer(async (req, res) => {
    currentReq = req;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
    }
    if (ALLOWED_ORIGIN && req.headers.origin && req.headers.origin !== ALLOWED_ORIGIN) {
        sendJson(res, 403, { error: '这个网页不允许连接' });
        return;
    }
    try {
        if (req.method === 'GET' && url.pathname === '/status') {
            sendJson(res, 200, { name: 'lumisynth-mcp', version: VERSION, paired: connected() });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/pair') {
            const body = await readBody(req);
            if (String(body.code ?? '').trim().toUpperCase() !== state.code) {
                sendJson(res, 403, { error: '配对码不对' });
                return;
            }
            if (state.token) disconnect('被新的页面替换');
            state.token = randomBytes(24).toString('hex');
            state.origin = req.headers.origin ?? null;
            state.lastSeen = Date.now();
            state.code = newCode();
            log(`页面已配对（${state.origin ?? '未知来源'}）`);
            sendJson(res, 200, { token: state.token, version: VERSION });
            return;
        }
        if (!authorized(req)) {
            sendJson(res, 401, { error: '没有配对或令牌已失效' });
            return;
        }
        state.lastSeen = Date.now();
        if (req.method === 'POST' && url.pathname === '/hello') {
            const body = await readBody(req);
            state.tools = Array.isArray(body.tools) ? body.tools : [];
            state.prompts = Array.isArray(body.prompts) ? body.prompts : [];
            notify('notifications/tools/list_changed');
            notify('notifications/prompts/list_changed');
            sendJson(res, 200, { ok: true });
            return;
        }
        if (req.method === 'GET' && url.pathname === '/poll') {
            if (state.queue.length > 0) {
                sendJson(res, 200, state.queue.shift());
                return;
            }
            if (state.waiting) {
                // 同一时刻只保留一个长轮询。
                const previous = state.waiting;
                clearTimeout(previous.timer);
                sendJson(previous.res, 204);
            }
            const timer = setTimeout(() => {
                if (state.waiting?.res === res) state.waiting = null;
                sendJson(res, 204);
            }, POLL_WAIT_MS);
            state.waiting = { res, timer };
            req.on('close', () => {
                if (state.waiting?.res === res) {
                    clearTimeout(timer);
                    state.waiting = null;
                }
            });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/reply') {
            const body = await readBody(req);
            const pending = state.pending.get(body.id);
            if (pending) {
                state.pending.delete(body.id);
                if (body.error) pending.reject(new Error(String(body.error)));
                else pending.resolve(body.result);
            }
            sendJson(res, 200, { ok: true });
            return;
        }
        if (req.method === 'POST' && url.pathname === '/bye') {
            disconnect('页面主动断开');
            sendJson(res, 200, { ok: true });
            return;
        }
        sendJson(res, 404, { error: 'not found' });
    } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
});

server.on('error', error => {
    log(`无法监听 127.0.0.1:${PORT}：${error.message}`);
    process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
    log(`在 http://127.0.0.1:${PORT} 等待 lumisynth 页面。配对码：${state.code}`);
});

// ---------------------------------------------------------------------------------------------
// stdio MCP（agent 一侧）

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let initialized = false;
const notify = (method, params) => {
    if (initialized) write({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
};

const CONNECT_TOOL = {
    name: 'lumisynth_connect',
    title: '连接 lumisynth 页面',
    description: 'Connection status of the lumisynth page. When not connected it returns a one-time pairing code: tell the user to open lumisynth in the browser, go to the "Agent" side view and enter the code (port shown too). Call again to check; the page tools appear once connected.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
};

const connectStatus = () => (connected()
    ? { content: [{ type: 'text', text: `已连接 lumisynth 页面（${state.origin ?? '未知来源'}），可用工具 ${state.tools.length} 个。` }] }
    : { content: [{ type: 'text', text: `还没有连接。请用户打开 lumisynth，在左侧「Agent」面板里填写端口 ${PORT} 和配对码 ${state.code}，然后点「连接」。` }] });

const handlers = {
    initialize: (params) => {
        initialized = true;
        return {
            protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: true }, prompts: { listChanged: true } },
            serverInfo: { name: 'lumisynth', title: 'lumisynth 光合', version: VERSION },
            instructions: 'Tools operate on the lumisynth lyric-video editor open in the user\'s browser. If no page is connected, call lumisynth_connect and relay the pairing code to the user. Start with get_project, then get_arrangement / list_styles. To generate a theme, a word segmentation or a whole-song scene direction, first read the brief (get_theme_brief / get_segmentation_brief / get_scene_direction_brief: the same instructions as lumisynth\'s built-in AI plus the project data and the output JSON Schema), produce the JSON yourself and write it back with set_theme / set_segmentation / apply_scene_direction. The same briefs are also offered as the prompts theme, segmentation and scene_direction. Every edit is undoable in the page.',
        };
    },
    ping: () => ({}),
    'tools/list': () => ({ tools: [CONNECT_TOOL, ...(connected() ? state.tools : [])] }),
    'tools/call': async (params) => {
        if (params?.name === CONNECT_TOOL.name) return connectStatus();
        if (!connected()) {
            return { content: [{ type: 'text', text: `lumisynth 页面没有连接。${connectStatus().content[0].text}` }], isError: true };
        }
        try {
            return await forward('tools/call', { name: params?.name, arguments: params?.arguments ?? {} });
        } catch (error) {
            return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
        }
    },
    'prompts/list': () => ({ prompts: connected() ? state.prompts : [] }),
    'prompts/get': async (params) => {
        if (!connected()) throw Object.assign(new Error('lumisynth 页面没有连接'), { code: -32002 });
        return forward('prompts/get', { name: params?.name, arguments: params?.arguments ?? {} }, 60_000);
    },
};

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
    if (!line.trim()) return;
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
    }
    if (message.id === undefined || message.id === null) return; // 通知
    const handler = handlers[message.method];
    if (!handler) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
        return;
    }
    try {
        write({ jsonrpc: '2.0', id: message.id, result: await handler(message.params) });
    } catch (error) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error instanceof Error ? error.message : String(error) } });
    }
});
rl.on('close', () => {
    server.close();
    process.exit(0);
});
