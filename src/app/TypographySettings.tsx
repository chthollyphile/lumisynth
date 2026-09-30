// src/app/TypographySettings.tsx
// 「画面与编排 › 字体」：歌词与字幕的字体族（CSS font-family，可排序）、兜底字体风格、字重、字号；
// 本机字体（支持 Local Font Access 的浏览器）与上传的字体文件。
import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, FolderOpen, Search, Upload, X } from 'lucide-react';
import { normalizeFontFamilyStack, resolveThemeFontStack } from '@/engine/shared/fontStacks';
import { FONT_FILE_ACCEPT, importFontFile, listLocalFontFamilies, removeUploadedFont, supportsLocalFonts } from '@/project/fonts';
import { updateProject, useProjectStore } from '@/project/store';
import { LYRICS_SCALE_RANGE, type FontSettings, type ProjectTypography } from '@/project/typography';
import { log } from './output';
import { Button, cx, Field, FileButton, inputClass, Segmented, Slider, Toggle } from './ui';

type Target = 'lyrics' | 'subtitles';

const patchFont = (target: Target, patch: Partial<ProjectTypography['lyrics']> & { inherit?: boolean }, coalesce?: string) => updateProject(project => ({
    ...project,
    typography: { ...project.typography, [target]: { ...project.typography[target], ...patch } },
}), coalesce ? { coalesce: `typography:${target}:${coalesce}` } : undefined);

function FamilyList({ target, font }: { target: Target; font: FontSettings }) {
    const [draft, setDraft] = useState('');
    const add = (names: string[]) => {
        const families = normalizeFontFamilyStack([...font.families, ...names]);
        patchFont(target, { families });
        setDraft('');
    };
    const move = (index: number) => {
        if (index === 0) return;
        const families = [...font.families];
        [families[index - 1], families[index]] = [families[index], families[index - 1]];
        patchFont(target, { families });
    };
    return (
        <Field label="字体族" hint="按顺序回退，最后是上面选的基础字体。写系统里已安装的字体名，或上传字体文件。">
            {font.families.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                    {font.families.map((family, index) => (
                        <li key={family} className="flex items-center gap-1 rounded bg-zinc-800/70 px-1.5 py-1 text-xs text-zinc-200">
                            <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `"${family}"` }} title={family}>{family}</span>
                            <button type="button" aria-label={`上移 ${family}`} disabled={index === 0} onClick={() => move(index)} className="rounded p-0.5 text-zinc-500 hover:text-zinc-100 disabled:opacity-30"><ArrowUp size={12} /></button>
                            <button type="button" aria-label={`移除 ${family}`} onClick={() => patchFont(target, { families: font.families.filter(item => item !== family) })} className="rounded p-0.5 text-zinc-500 hover:text-zinc-100"><X size={12} /></button>
                        </li>
                    ))}
                </ul>
            )}
            <input
                aria-label="添加字体族"
                spellCheck={false}
                placeholder="输入字体名，回车添加（可用逗号分隔多个）"
                value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => {
                    if (event.key === 'Enter' && draft.trim()) add(draft.split(/[,，\n]/));
                }}
                onBlur={() => { if (draft.trim()) add(draft.split(/[,，\n]/)); }}
                className={`${inputClass} select-text`}
            />
            {supportsLocalFonts() && <LocalFontPicker onPick={family => add([family])} />}
        </Field>
    );
}

function LocalFontPicker({ onPick }: { onPick: (family: string) => void }) {
    const [families, setFamilies] = useState<string[] | null>(null);
    const [query, setQuery] = useState('');
    const [error, setError] = useState<string | null>(null);
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (families ?? []).filter(family => !needle || family.toLowerCase().includes(needle)).slice(0, 200);
    }, [families, query]);

    if (!families) {
        return (
            <div className="mt-1.5">
                <Button size="sm" variant="ghost" onClick={() => {
                    listLocalFontFamilies().then(setFamilies, reason => setError((reason as Error).message));
                }}>
                    <FolderOpen size={12} /> 从本机字体选择…
                </Button>
                {error && <div className="mt-1 text-[11px] text-red-300">{error}</div>}
            </div>
        );
    }
    return (
        <div className="mt-1.5 rounded-md border border-zinc-700 bg-zinc-900">
            <div className="flex items-center gap-1 border-b border-zinc-800 px-2">
                <Search size={12} className="text-zinc-500" />
                <input
                    autoFocus
                    aria-label="搜索本机字体"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={`搜索 ${families.length} 个本机字体`}
                    className="h-7 min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none select-text"
                />
                <button type="button" aria-label="关闭本机字体列表" onClick={() => setFamilies(null)} className="p-0.5 text-zinc-500 hover:text-zinc-100"><X size={12} /></button>
            </div>
            <ul className="max-h-48 overflow-y-auto py-1">
                {filtered.map(family => (
                    <li key={family}>
                        <button
                            type="button"
                            onClick={() => onPick(family)}
                            className="block w-full truncate px-2 py-0.5 text-left text-xs text-zinc-300 hover:bg-zinc-800"
                            style={{ fontFamily: `"${family}"` }}
                        >
                            {family}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function FontEditor({ target, font, scale }: { target: Target; font: FontSettings; scale?: number }) {
    const stack = resolveThemeFontStack({ fontStyle: font.style, fontFamilyStack: font.families });
    return (
        <>
            <Field label="基础字体">
                <Segmented<FontSettings['style']>
                    value={font.style}
                    onChange={style => patchFont(target, { style })}
                    options={[{ value: 'sans', label: '黑体' }, { value: 'serif', label: '宋体' }, { value: 'mono', label: '等宽' }]}
                />
            </Field>
            <FamilyList target={target} font={font} />
            <Toggle checked={font.weight === null} onChange={auto => patchFont(target, { weight: auto ? null : 500 })} label="字重按风格自动" />
            {font.weight !== null && (
                <Field label="字重" hint="字体本身没有这个字重时，浏览器只能合成粗体或退回最近的字重。">
                    <Slider value={font.weight} min={100} max={900} step={100} onChange={weight => patchFont(target, { weight }, 'weight')} />
                </Field>
            )}
            {scale !== undefined && (
                <Field label="字号">
                    <Slider
                        value={scale}
                        min={LYRICS_SCALE_RANGE[0]}
                        max={LYRICS_SCALE_RANGE[1]}
                        step={0.05}
                        onChange={value => patchFont('lyrics', { scale: value }, 'scale')}
                        format={value => `${Math.round(value * 100)}%`}
                    />
                </Field>
            )}
            <div
                className="truncate rounded bg-zinc-800/60 px-2 py-1.5 text-lg text-zinc-100"
                style={{ fontFamily: stack, fontWeight: font.weight ?? 500 }}
                title={stack}
            >
                光と影のあいだで Aa 光合
            </div>
        </>
    );
}

export function TypographySettings() {
    const typography = useProjectStore(state => state.project.typography);
    const [uploading, setUploading] = useState(false);
    const [, setFontsVersion] = useState(0);
    // 本机字体列表里的名字在样例里要等字体加载后才显示正确。
    useEffect(() => {
        if (typeof document === 'undefined' || !document.fonts) return;
        const bump = () => setFontsVersion(value => value + 1);
        document.fonts.addEventListener('loadingdone', bump);
        return () => document.fonts.removeEventListener('loadingdone', bump);
    }, []);

    return (
        <>
            <div className="text-[11px] font-medium text-zinc-400">歌词</div>
            <FontEditor target="lyrics" font={typography.lyrics} scale={typography.lyrics.scale} />
            <div className="pt-1 text-[11px] font-medium text-zinc-400">字幕（译文 / 罗马音）</div>
            <Toggle checked={typography.subtitles.inherit} onChange={inherit => patchFont('subtitles', { inherit })} label="沿用歌词字体" />
            {!typography.subtitles.inherit && <FontEditor target="subtitles" font={typography.subtitles} />}
            <div className="pt-1 text-[11px] font-medium text-zinc-400">上传的字体</div>
            {typography.fonts.length > 0 && (
                <ul className="space-y-1">
                    {typography.fonts.map(font => (
                        <li key={font.family} className="flex items-center gap-1 text-xs text-zinc-300">
                            <span className="min-w-0 flex-1 truncate" style={{ fontFamily: `"${font.family}"` }} title={font.asset.name}>{font.family}</span>
                            <button type="button" aria-label={`删除字体 ${font.family}`} onClick={() => removeUploadedFont(font.family)} className="rounded p-0.5 text-zinc-500 hover:text-zinc-100"><X size={12} /></button>
                        </li>
                    ))}
                </ul>
            )}
            <FileButton
                size="sm"
                accept={FONT_FILE_ACCEPT}
                className={cx(uploading && 'opacity-50')}
                onFile={file => {
                    setUploading(true);
                    importFontFile(file)
                        .then(family => log(`已添加字体：${family}`))
                        .catch(reason => log((reason as Error).message, 'error'))
                        .finally(() => setUploading(false));
                }}
            >
                <Upload size={12} /> 上传字体文件（ttf / otf / woff2）
            </FileButton>
            <div className="text-[11px] text-zinc-500">上传的字体会存进工程（也会打包进 .lumi），换一台电脑打开也能用。</div>
        </>
    );
}
