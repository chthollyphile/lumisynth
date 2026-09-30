// src/app/views/AgentPanel.tsx
// 主侧栏「Agent」：把用户自己的 agent（Claude Code 等支持 MCP 的工具）接到这个页面。
// 连接走本地桥 bridge/lumisynth-mcp.mjs：agent 启动它，页面填端口与配对码连上。
import { useState } from 'react';
import { Copy, Download, Plug, Unplug } from 'lucide-react';
import {
    connectAgentBridge,
    DEFAULT_BRIDGE_PORT,
    disconnectAgentBridge,
    useAgentBridge,
} from '@/agent/bridgeClient';
import { skillArchive, SKILL_ARCHIVE_NAME } from '@/agent/skill';
import { AGENT_PROMPTS, AGENT_TOOLS } from '@/agent/tools';
import { downloadBlob } from '../download';
import { log } from '../output';
import { Button, cx, Field, inputClass, Section } from '../ui';

const BRIDGE_FILE = 'lumisynth-mcp.mjs';
const SETUP_COMMAND = `claude mcp add lumisynth -- node <下载位置>/${BRIDGE_FILE}`;

const STATUS_LABELS = {
    disconnected: '未连接',
    connecting: '正在连接…',
    connected: '已连接',
    error: '连接失败',
} as const;

export function AgentPanel() {
    const { status, port, error, activity } = useAgentBridge();
    const [portDraft, setPortDraft] = useState(String(port || DEFAULT_BRIDGE_PORT));
    const [code, setCode] = useState('');
    const busy = status === 'connecting';

    const connect = () => {
        const value = Number.parseInt(portDraft, 10);
        void connectAgentBridge(Number.isFinite(value) ? value : DEFAULT_BRIDGE_PORT, code).then(() => setCode(''));
    };

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text).then(() => log('已复制到剪贴板'));
    };

    return (
        <>
            <Section title="连接">
                <div className="flex items-center gap-2 text-xs">
                    <span className={cx('h-2 w-2 rounded-full', status === 'connected' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : busy ? 'bg-amber-400' : 'bg-zinc-600')} />
                    <span className="text-zinc-300">{STATUS_LABELS[status]}</span>
                    {status === 'connected' && <span className="text-zinc-500">127.0.0.1:{port}</span>}
                </div>
                {status === 'connected' ? (
                    <>
                        <div className="text-[11px] text-zinc-500">agent 现在可以读取和修改这个工程。它的每一次修改都会记在下面和「输出」里，可以撤销。</div>
                        <Button size="sm" onClick={disconnectAgentBridge}><Unplug size={12} /> 断开</Button>
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-[5.5rem_1fr] gap-2">
                            <Field label="端口">
                                <input
                                    inputMode="numeric"
                                    value={portDraft}
                                    onChange={event => setPortDraft(event.target.value)}
                                    className={`${inputClass} select-text`}
                                />
                            </Field>
                            <Field label="配对码">
                                <input
                                    autoComplete="off"
                                    spellCheck={false}
                                    placeholder="6 位，agent 会告诉你"
                                    value={code}
                                    onChange={event => setCode(event.target.value.toUpperCase())}
                                    onKeyDown={event => { if (event.key === 'Enter' && code.trim()) connect(); }}
                                    className={`${inputClass} select-text font-mono tracking-widest`}
                                />
                            </Field>
                        </div>
                        <Button size="sm" variant="primary" disabled={busy || !code.trim()} onClick={connect}><Plug size={12} /> 连接</Button>
                        {error && <div className="rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200 select-text">{error}</div>}
                    </>
                )}
            </Section>

            {status !== 'connected' && (
                <Section title="第一次使用">
                    <ol className="list-decimal space-y-1.5 pl-4 text-[11px] text-zinc-400">
                        <li>
                            下载本地桥 <a href={`${import.meta.env.BASE_URL}${BRIDGE_FILE}`} download={BRIDGE_FILE} className="text-amber-300 underline">{BRIDGE_FILE}</a>（需要 Node.js 18 以上，没有其他依赖）。
                        </li>
                        <li>
                            在 agent 里把它添加为 MCP 服务器，例如 Claude Code：
                            <div className="mt-1 flex items-center gap-1">
                                <code className="min-w-0 flex-1 truncate rounded bg-zinc-800 px-1.5 py-1 text-[10px] text-zinc-200 select-text">{SETUP_COMMAND}</code>
                                <button type="button" aria-label="复制命令" onClick={() => copy(SETUP_COMMAND)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"><Copy size={12} /></button>
                            </div>
                        </li>
                        <li>让 agent 调用 <code className="select-text">lumisynth_connect</code>，它会给出配对码。</li>
                        <li>在上面填写端口与配对码，点「连接」。浏览器可能会询问是否允许访问本机网络。</li>
                    </ol>
                    <div className="text-[11px] text-zinc-500">
                        连上之后，「AI」面板的三个按钮（{AGENT_PROMPTS.map(prompt => prompt.title).join('、')}）会变成「复制指令」：粘贴给 agent，
                        它用和内置 AI 相同的提示词自己生成结果并写回，不需要另配 AI 密钥。
                    </div>
                </Section>
            )}

            <Section title="写剧本的 skill">
                <div className="text-[11px] text-zinc-400">
                    教 agent 写 LumiScript 剧本（场景编排）与设置：语法参考 + 工作流程。解压到 agent 的 skills 目录（Claude Code：<code className="select-text">~/.claude/skills/</code>）。
                    没连上这个页面的 agent 也能照着写 .lumiscript 文件，在「剧本」标签页导入。
                </div>
                <Button size="sm" onClick={() => downloadBlob(skillArchive(), SKILL_ARCHIVE_NAME)}><Download size={12} /> 下载 {SKILL_ARCHIVE_NAME}</Button>
            </Section>

            <Section title={`工具（${AGENT_TOOLS.length}）`}>
                <ul className="space-y-0.5 text-[11px]">
                    {AGENT_TOOLS.map(tool => (
                        <li key={tool.name} className="flex gap-2" title={tool.description}>
                            <code className="text-zinc-300">{tool.name}</code>
                            <span className="truncate text-zinc-500">{tool.title}{tool.readOnly ? '' : ' · 写'}</span>
                        </li>
                    ))}
                </ul>
            </Section>

            {activity.length > 0 && (
                <Section title="最近的操作">
                    <ul className="space-y-1 text-[11px]">
                        {activity.slice(0, 20).map(entry => (
                            <li key={`${entry.at}-${entry.tool}`} className={entry.ok ? 'text-zinc-300' : 'text-red-300'}>
                                <span className="text-zinc-500">{new Date(entry.at).toLocaleTimeString()}</span> {entry.tool} · {entry.summary}
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
        </>
    );
}
