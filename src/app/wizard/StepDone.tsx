// src/app/wizard/StepDone.tsx
// 向导第 4 步：完成。汇总这次的选择；从头播放预览、导出视频，或者关掉向导继续精修。
import { Download, Play, SlidersHorizontal } from 'lucide-react';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useEffectiveLyrics, useProgram } from '../DerivedProvider';
import { openExportDialog } from '../export/ExportDialog';
import { play, seek } from '../playback';
import { packLabel } from '../StylePanel';
import { formatTime, useProjectDuration } from '../Transport';
import { Button } from '../ui';
import { useAutoClipCount } from '../autoArrange/autoArrangeActions';
import { closeWizard } from './wizardStore';

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/80 py-2 last:border-b-0">
            <span className="shrink-0 text-xs text-zinc-500">{label}</span>
            <span className="truncate text-right text-sm text-zinc-200">{value}</span>
        </div>
    );
}

export function StepDone() {
    const project = useProjectStore(state => state.project);
    const audioBuffer = useSession(state => state.audioBuffer);
    const program = useProgram();
    const effective = useEffectiveLyrics();
    const duration = useProjectDuration();
    const lineCount = effective.data?.lines.filter(line => line.fullText !== '......').length ?? 0;
    const theme = project.theme.dual[project.theme.variant];
    const style = project.direction.mode === 'mix' ? '按段落混用' : packLabel(project.direction.pack);
    const imageCount = project.assets.filter(asset => asset.kind === 'image').length;
    const autoCount = useAutoClipCount();

    return (
        <div className="space-y-5">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3">
                <Row label="歌曲" value={[project.meta.title || '（未命名）', project.meta.artist].filter(Boolean).join(' · ')} />
                <Row label="音频" value={audioBuffer ? formatTime(audioBuffer.duration) : project.audio ? '解码中…' : '没有（按歌词时长预览）'} />
                <Row label="歌词" value={lineCount > 0 ? `${lineCount} 行 · ${program.paragraphs.length} 段 · ${program.paragraphs.reduce((sum, p) => sum + p.shots.length, 0)} 个镜头` : '纯音乐'} />
                <Row label="风格" value={style} />
                <Row label="画幅" value={project.aspect} />
                <Row label="素材" value={imageCount === 0 ? '没有' : autoCount > 0 ? `${imageCount} 张图 · 放进了 ${autoCount} 个镜头` : `${imageCount} 张图（没有自动编排）`} />
                <Row label="配色" value={/[深浅]色/.test(theme.name) ? theme.name : `${theme.name}（${project.theme.variant === 'dark' ? '深色' : '浅色'}）`} />
                <Row label="时长" value={formatTime(duration)} />
            </div>

            <div className="space-y-2">
                <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                        closeWizard();
                        seek(0);
                        play();
                    }}
                >
                    <Play size={14} /> 从头播放预览
                </Button>
                <Button className="w-full" onClick={() => { closeWizard(); openExportDialog(); }}>
                    <Download size={14} /> 导出视频…
                </Button>
                <Button variant="ghost" className="w-full" onClick={closeWizard}>
                    <SlidersHorizontal size={14} /> 继续精修
                </Button>
            </div>

            <ul className="space-y-1.5 text-[11px] leading-relaxed text-zinc-500">
                <li>· 时间轴上右键段落或镜头，可以换风格、换转场、拆分合并段落。</li>
                <li>· 同一份歌词和 seed 总是编出同一个 PV；在「画面与编排」里换个 seed，就是另一种编排。</li>
                <li>· 所有改动都能撤销（Ctrl+Z），工程会自动保存。</li>
            </ul>
        </div>
    );
}
