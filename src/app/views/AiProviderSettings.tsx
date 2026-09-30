// src/app/views/AiProviderSettings.tsx
// 「AI」侧栏顶部：用户自己的 AI 提供方与密钥（浏览器直连，密钥只存在本机）。
import { useRef, useState } from 'react';
import { KeyRound, PlugZap } from 'lucide-react';
import { testAiConnection } from '@/ai/client';
import {
    AI_PROVIDER_LABELS,
    DEFAULT_MODELS,
    forgetAiKeys,
    patchAiConfig,
    setAiKey,
    setAiProvider,
    setRememberKeys,
    useAiSettings,
    type AiProviderKind,
    type AiSettings,
} from '@/ai/settings';
import { log } from '../output';
import { Button, Field, inputClass, Section, Toggle } from '../ui';

const HINTS: Record<AiProviderKind, string> = {
    gemini: '在 Google AI Studio 创建密钥。',
    openai: 'OpenAI、DeepSeek、OpenRouter 或本地的 Ollama / LM Studio。服务必须允许浏览器跨域访问（Ollama 需设置 OLLAMA_ORIGINS）。',
    anthropic: '在 Anthropic Console 创建密钥。',
};

export function AiProviderSettings({ onChanged }: { onChanged?: () => void }) {
    const settings = useAiSettings();
    const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
    const abort = useRef<AbortController | null>(null);
    const kind = settings.provider === 'none' ? null : settings.provider;
    const config = kind ? settings.configs[kind] : null;

    const test = async () => {
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setStatus({ kind: 'busy', text: '正在测试…' });
        try {
            const name = await testAiConnection(controller.signal);
            setStatus({ kind: 'ok', text: `${name} 连接正常` });
            log(`AI：${name} 连接正常`);
        } catch (reason) {
            if (controller.signal.aborted) return;
            setStatus({ kind: 'error', text: (reason as Error).message });
        }
    };

    const changed = () => {
        setStatus(null);
        onChanged?.();
    };

    return (
        <Section title="AI 提供方">
            <select
                aria-label="AI 提供方"
                value={settings.provider}
                onChange={event => {
                    setAiProvider(event.target.value as AiSettings['provider']);
                    changed();
                }}
                className={inputClass}
            >
                <option value="none">不使用 AI</option>
                {(Object.keys(AI_PROVIDER_LABELS) as AiProviderKind[]).map(item => (
                    <option key={item} value={item}>{AI_PROVIDER_LABELS[item]}</option>
                ))}
            </select>
            {kind && config && (
                <>
                    <div className="text-[11px] text-zinc-500">{HINTS[kind]}</div>
                    <Field label="API 密钥" hint={settings.rememberKeys ? '保存在这个浏览器里，不会进入工程文件。' : '只在本次会话有效，关掉标签页就会忘记。'}>
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={kind === 'openai' ? '本地服务可以留空' : ''}
                            value={settings.keys[kind] ?? ''}
                            onChange={event => {
                                setAiKey(kind, event.target.value);
                                changed();
                            }}
                            className={`${inputClass} select-text`}
                        />
                    </Field>
                    {kind !== 'gemini' && (
                        <Field label={kind === 'openai' ? '接口地址' : '接口地址（可选）'}>
                            <input
                                type="url"
                                spellCheck={false}
                                placeholder={kind === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1/messages'}
                                value={config.baseUrl}
                                onChange={event => {
                                    patchAiConfig(kind, { baseUrl: event.target.value });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                    )}
                    <div className="grid grid-cols-[1fr_5rem] gap-2">
                        <Field label="模型">
                            <input
                                spellCheck={false}
                                placeholder={DEFAULT_MODELS[kind]}
                                value={config.model}
                                onChange={event => {
                                    patchAiConfig(kind, { model: event.target.value });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                        <Field label="温度">
                            <input
                                type="number"
                                min={0}
                                max={2}
                                step={0.1}
                                placeholder="默认"
                                value={config.temperature ?? ''}
                                onChange={event => {
                                    const value = Number.parseFloat(event.target.value);
                                    patchAiConfig(kind, { temperature: Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : null });
                                    changed();
                                }}
                                className={`${inputClass} select-text`}
                            />
                        </Field>
                    </div>
                    <Toggle checked={settings.rememberKeys} onChange={setRememberKeys} label="在这个浏览器里记住密钥" />
                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => void test()} disabled={status?.kind === 'busy'}>
                            <PlugZap size={12} /> 测试连接
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => { forgetAiKeys(); changed(); }}>
                            <KeyRound size={12} /> 清除所有密钥
                        </Button>
                    </div>
                    {status && (
                        <div className={status.kind === 'error'
                            ? 'rounded-md bg-red-950/60 px-2 py-1.5 text-xs text-red-200 select-text'
                            : status.kind === 'ok' ? 'text-xs text-emerald-300' : 'text-xs text-zinc-400'}
                        >
                            {status.text}
                        </div>
                    )}
                </>
            )}
        </Section>
    );
}
