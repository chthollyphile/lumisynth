// src/app/views/AiPanel.tsx
// 主侧栏「AI」：主题配色、分词、场景编排。结果直接写进工程，可以撤销；
// 场景编排不会覆盖用户手动设置过的段落与转场。
// 连上 agent（MCP 桥）后三个按钮改为「复制指令」：用户粘贴给 agent，由它取同样的提示词、生成并写回，不需要 AI 密钥。
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Palette, Scissors, Sparkles, Trash2 } from 'lucide-react';
import { useAgentBridge } from '@/agent/bridgeClient';
import { agentTaskInstruction, type AgentTask } from '@/agent/tools';
import { applySceneDirection, clearSceneDirection, generateAiSegmentation, generateAiTheme, generateSceneDirection } from '@/ai/actions';
import { resolveAiProvider, useAiSettings, AI_PROVIDER_LABELS } from '@/ai/settings';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import type { SceneDirectionResponse } from '@/ai/sceneDirection';
import { useProgram } from '../DerivedProvider';
import { log } from '../output';
import { packShortLabel } from '../StylePanel';
import { Button, Section, Toggle } from '../ui';
import { AiProviderSettings } from './AiProviderSettings';

type Task = 'theme' | 'segment' | 'direct';

const AGENT_TASKS: Record<Task, AgentTask> = { theme: 'theme', segment: 'segmentation', direct: 'scene_direction' };

const KIND_LABELS: Record<string, string> = {
    breath: '换气', verse: '主歌', lift: '上扬', chorus: '副歌', break: '间奏', outro: '尾声',
};

export function AiPanel() {
    const program = useProgram();
    const project = useProjectStore(state => state.project);
    const analysis = useSession(state => state.analysis);
    const provider = useAiSettings(state => resolveAiProvider(state)?.kind ?? null);
    const [busy, setBusy] = useState<Task | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [keepManual, setKeepManual] = useState(true);
    const [direction, setDirection] = useState<(SceneDirectionResponse & { provider?: string }) | null>(null);
    const abort = useRef<AbortController | null>(null);
    const bridged = useAgentBridge(state => state.status === 'connected');
    const [copied, setCopied] = useState<Task | null>(null);
    const copiedTimer = useRef<number | undefined>(undefined);

    useEffect(() => () => {
        abort.current?.abort();
        window.clearTimeout(copiedTimer.current);
    }, []);

    const copyInstruction = (task: Task) => {
        const instruction = agentTaskInstruction(AGENT_TASKS[task], { skipManual: keepManual });
        setError(null);
        void navigator.clipboard.writeText(instruction).then(() => {
            setCopied(task);
            log(`已复制给 agent 的指令：${instruction}`);
            window.clearTimeout(copiedTimer.current);
            copiedTimer.current = window.setTimeout(() => setCopied(null), 2000);
        }, () => setError('复制失败：浏览器没有允许写入剪贴板。'));
    };

    /** 连上 agent 时替换原来的生成按钮。 */
    const copyButton = (task: Task, disabled: boolean, variant?: 'primary') => (
        <Button className="w-full" variant={variant} disabled={disabled} onClick={() => copyInstruction(task)}>
            {copied === task ? <Check size={14} /> : <Copy size={14} />} {copied === task ? '已复制，粘贴给 agent' : '复制指令'}
        </Button>
    );

    const run = async (task: Task, work: (signal: AbortSignal) => Promise<string>) => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setBusy(task);
        setError(null);
        try {
            log(await work(controller.signal));
        } catch (reason) {
            if (controller.signal.aborted) return;
            const message = (reason as Error).message;
            setError(message);
            log(`AI：${message}`, 'error');
        } finally {
            if (abort.current === controller) setBusy(null);
        }
    };

    const aiDirected = project.paragraphDirections.filter(item => item.source === 'ai').length;
    const available = provider !== null;
    const current = project.theme.dual[project.theme.variant];

    return (
        <>
            {bridged && (
                <div className="mx-4 mt-3 mb-1 flex gap-2 rounded-md border border-sky-800/60 bg-sky-950/40 px-2.5 py-2 text-xs text-sky-100">
                    <Bot size={14} className="mt-0.5 shrink-0 text-sky-300" />
                    <div>
                        已连接 agent（MCP）。下面的按钮改为<span className="text-sky-300">复制指令</span>：粘贴给当前连接的模型，
                        它会取到与内置 AI 相同的提示词，生成后直接写回工程（可撤销），不需要 AI 密钥。
                    </div>
                </div>
            )}
            <AiProviderSettings />
            {!bridged && (
                <div className="px-4 pt-1 pb-1 text-xs text-zinc-400">
                    {provider === null
                        ? '选择 AI 提供方并填写密钥后，下面的功能才可用；也可以在「Agent」面板连上自己的 agent。'
                        : `使用 ${AI_PROVIDER_LABELS[provider]}：请求从这个浏览器直接发出，不经过 lumisynth 的服务器。`}
                </div>
            )}
            {error && <div className="mx-4 my-2 rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200">{error}</div>}

            <Section title="主题配色">
                <div className="text-[11px] text-zinc-500">按歌词的情绪生成一套深色 + 浅色主题，替换当前主题（可撤销）。</div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                        {[current.backgroundColor, current.primaryColor, current.accentColor, current.secondaryColor].map((color, index) => (
                            <span key={index} className="h-5 w-5 rounded-sm ring-1 ring-zinc-700" style={{ backgroundColor: color }} />
                        ))}
                    </div>
                    <span className="truncate text-xs text-zinc-300">{current.name}</span>
                </div>
                {project.theme.source === 'ai' && current.description && <div className="text-xs text-zinc-400">「{current.description}」</div>}
                {bridged ? copyButton('theme', false) : <Button
                    className="w-full"
                    disabled={!available || busy !== null}
                    onClick={() => void run('theme', async signal => {
                        const dual = await generateAiTheme(program, project, signal);
                        return `AI 主题：${dual.dark.name} / ${dual.light.name}`;
                    })}
                >
                    <Palette size={14} /> {busy === 'theme' ? '生成中…' : '生成主题'}
                </Button>}
            </Section>

            <Section title="分词">
                <div className="text-[11px] text-zinc-500">让 AI 按语义切词（影响字号层级与镜头切块）。每行拼起来必须与原文一致，否则那一行保持自动分词。</div>
                <Toggle label="保留手动改过的行" checked={keepManual} onChange={setKeepManual} />
                {bridged ? copyButton('segment', program.lines.length === 0) : <Button
                    className="w-full"
                    disabled={!available || busy !== null || program.lines.length === 0}
                    onClick={() => void run('segment', async signal => {
                        const count = await generateAiSegmentation(program, { keepManual }, project, signal);
                        return `AI 分词：更新了 ${count} 行`;
                    })}
                >
                    <Scissors size={14} /> {busy === 'segment' ? '分词中…' : 'AI 分词'}
                </Button>}
            </Section>

            <Section
                title="场景编排"
                actions={aiDirected > 0 ? (
                    <button type="button" onClick={() => { clearSceneDirection(); setDirection(null); }} className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200">
                        <Trash2 size={12} /> 清除 AI 编排
                    </button>
                ) : undefined}
            >
                <div className="text-[11px] text-zinc-500">
                    AI 为每段选风格包、能量、构图族与出场转场。手动设置过的段落与转场不会被覆盖；结果可以在检查器里逐段修改。
                </div>
                {bridged ? copyButton('direct', program.paragraphs.length === 0, 'primary') : <Button
                    className="w-full"
                    variant="primary"
                    disabled={!available || busy !== null || program.paragraphs.length === 0}
                    onClick={() => void run('direct', async signal => {
                        const result = await generateSceneDirection(program, project, analysis, signal);
                        setDirection(result);
                        return `AI 编排：${result.paragraphs.length} 段。${result.summary}`;
                    })}
                >
                    <Sparkles size={14} /> {busy === 'direct' ? '编排中…' : 'AI 编排全曲'}
                </Button>}
                {direction && (
                    <div className="space-y-1.5">
                        {direction.summary && <div className="text-xs text-zinc-300">{direction.summary}</div>}
                        <ul className="space-y-1 text-[11px]">
                            {direction.paragraphs.map(item => {
                                const paragraph = program.paragraphs.find(p => p.index === item.index);
                                return (
                                    <li key={item.index} className="flex items-baseline gap-1.5">
                                        <span className="w-12 shrink-0 text-zinc-500">#{item.index + 1} {paragraph ? KIND_LABELS[paragraph.kind] : ''}</span>
                                        <span className="shrink-0 text-zinc-200">{packShortLabel(item.pack)}</span>
                                        <span className="shrink-0 text-zinc-500 tabular-nums">{item.energy.toFixed(2)}</span>
                                        <span className="truncate text-zinc-400">{item.reason}</span>
                                    </li>
                                );
                            })}
                        </ul>
                        <Button size="sm" variant="ghost" onClick={() => applySceneDirection(program, direction)}>重新应用这份编排</Button>
                    </div>
                )}
            </Section>
        </>
    );
}
