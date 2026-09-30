// src/app/theme-park/ThemeParkAiPanel.tsx
// 「AI」页：用已配置的 AI 直接生成到草稿；或者手动往返——复制提示词到别的 AI 工具、把它的 JSON 贴回来、
// 复制当前草稿的 JSON。生成与导入的结果都只进草稿，在预览里看过、改过再应用。
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Sparkles } from 'lucide-react';
import type { DualTheme } from '@/core/types';
import { requestTheme } from '@/ai/client';
import { resolveAiProvider, useAiSettings } from '@/ai/settings';
import { buildThemeSourcePrompt, parseAiThemeJsonInput, THEME_GENERATION_PROMPT_PREFIX } from '@/ai/themePrompt';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { log } from '../output';
import { Button } from '../ui';

const isLyricLine = (text: string) => text.trim().length > 0 && text !== '......' && text !== '♪';

/** 与「AI → 主题配色」相同的输入：全部歌词；纯音乐时用歌名。 */
const useThemeSource = () => {
    const program = useProgram();
    const title = useProjectStore(state => state.project.meta.title || state.project.name);
    const lines = program.lines.map(line => line.line.fullText).filter(isLyricLine);
    const isPureMusic = lines.length === 0;
    return { text: isPureMusic ? title : lines.join('\n'), isPureMusic, title };
};

const useCopied = () => {
    const [copied, setCopied] = useState(false);
    const timer = useRef<number>(0);
    useEffect(() => () => window.clearTimeout(timer.current), []);
    return [copied, () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 2000);
    }] as const;
};

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2.5 rounded-md border border-zinc-800 p-3">
            <div>
                <div className="text-sm text-zinc-100">{title}</div>
                {hint && <div className="text-[11px] text-zinc-500">{hint}</div>}
            </div>
            {children}
        </div>
    );
}

export function ThemeParkAiPanel({ buildTheme, onImport }: { buildTheme: () => DualTheme; onImport: (theme: DualTheme) => void }) {
    const source = useThemeSource();
    const available = useAiSettings(state => resolveAiProvider(state) !== null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [json, setJson] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [promptCopied, markPromptCopied] = useCopied();
    const [jsonCopied, markJsonCopied] = useCopied();
    const abort = useRef<AbortController | null>(null);
    useEffect(() => () => abort.current?.abort(), []);

    const generate = async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setBusy(true);
        setError(null);
        try {
            const dual = await requestTheme(source.text, source.isPureMusic, source.title, controller.signal);
            onImport(dual);
            log(`AI 主题已放进草稿：${dual.dark.name} / ${dual.light.name}（还没有应用）`);
        } catch (reason) {
            if (!controller.signal.aborted) setError((reason as Error).message);
        } finally {
            if (abort.current === controller) setBusy(false);
        }
    };

    const copy = async (text: string, done: () => void) => {
        try {
            await navigator.clipboard.writeText(text);
            done();
        } catch (reason) {
            log(`复制失败：${(reason as Error).message}`, 'error');
        }
    };

    const importJson = () => {
        setImportError(null);
        if (!json.trim()) return;
        try {
            onImport(parseAiThemeJsonInput(json) as DualTheme);
            setJson('');
        } catch {
            setImportError('不是有效的主题 JSON（需要包含 light 与 dark 两个对象）');
        }
    };

    return (
        <div className="space-y-4">
            <Card title="用 AI 生成到草稿" hint={available ? '按整首歌词生成一对深色 / 浅色主题，放进草稿，预览里看过再应用。' : '还没有配置 AI：在主侧栏「AI」里选择提供方并填写密钥。'}>
                <Button variant="primary" className="w-full" disabled={!available || busy} onClick={() => void generate()}>
                    <Sparkles size={14} /> {busy ? '生成中…' : '生成'}
                </Button>
                {error && <div className="text-xs text-red-400">{error}</div>}
            </Card>

            <Card title="复制提示词" hint="贴到任意 AI 对话里，让它按同样的格式输出主题 JSON。">
                <Button className="w-full" onClick={() => void copy(`${THEME_GENERATION_PROMPT_PREFIX}\n\n${buildThemeSourcePrompt(source.text, source.isPureMusic, source.title)}`, markPromptCopied)}>
                    {promptCopied ? <Check size={14} /> : <Copy size={14} />} {promptCopied ? '已复制' : '复制提示词'}
                </Button>
            </Card>

            <Card title="导入 JSON 到草稿" hint="支持纯 JSON、```json 代码块，或夹在说明文字里的输出。">
                <textarea
                    aria-label="主题 JSON"
                    value={json}
                    rows={6}
                    placeholder="把 AI 返回的 JSON 贴在这里"
                    onChange={event => {
                        setJson(event.target.value);
                        setImportError(null);
                    }}
                    spellCheck={false}
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none select-text focus:border-amber-400/70"
                />
                {importError && <div className="text-xs text-red-400">{importError}</div>}
                <Button className="w-full" disabled={!json.trim()} onClick={importJson}>
                    <Download size={14} /> 导入到草稿
                </Button>
            </Card>

            <Card title="导出当前草稿">
                <Button className="w-full" onClick={() => void copy(JSON.stringify(buildTheme(), null, 2), markJsonCopied)}>
                    {jsonCopied ? <Check size={14} /> : <Copy size={14} />} {jsonCopied ? '已复制' : '复制主题 JSON'}
                </Button>
            </Card>
        </div>
    );
}
