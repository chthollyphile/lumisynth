import { useEffect, useState } from 'react';
import { Bot, FolderOpen, Images, LayoutGrid, ListTree, Palette, Sparkles, TriangleAlert } from 'lucide-react';
import { APP_MENUS, registerAppCommands } from '@/app/appCommands';
import { AssetsPanel } from '@/app/AssetsPanel';
import { useEffectiveLyrics } from '@/app/DerivedProvider';
import { clock, syncPlaying, usePlayback } from '@/app/playback';
import { Preview } from '@/app/Preview';
import { packLabel, StylePanel } from '@/app/StylePanel';
import { formatTime } from '@/app/Transport';
import { OutputView } from '@/app/views/OutputView';
import { AgentPanel } from '@/app/views/AgentPanel';
import { OutlineView } from '@/app/views/OutlineView';
import { LibraryView } from '@/app/views/LibraryView';
import { EditorArea } from '@/app/EditorArea';
import { MobileShell } from '@/app/mobile/MobileShell';
import { useIsMobileLayout } from '@/app/mobile/uiMode';
import { AiPanel } from '@/app/views/AiPanel';
import { installAgent } from '@/agent/install';
import { ExportDialog } from '@/app/export/ExportDialog';
import { Wizard } from '@/app/wizard/Wizard';
import { ProblemsList, useProblems } from '@/app/views/ProblemsView';
import { Timeline } from '@/app/timeline/Timeline';
import { Inspector } from '@/app/inspector/Inspector';
import { StyleLibrary } from '@/app/library/StyleLibrary';
import { installKeybindings } from '@/app/workbench/commands';
import type { StatusItem } from '@/app/workbench/StatusBar';
import { Workbench } from '@/app/workbench/Workbench';
import { bootstrapProject } from '@/project/actions';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';

registerAppCommands();

function useStatusItems(): StatusItem[] {
    const project = useProjectStore(state => state.project);
    const status = useSession(state => state.status);
    const progress = useSession(state => state.analysisProgress);
    const time = usePlayback(state => state.time);
    const { format } = useEffectiveLyrics();
    const problems = useProblems();
    const items: StatusItem[] = [
        { id: 'project', side: 'left', content: project.name, command: 'project.open', title: '打开工程' },
        {
            id: 'problems',
            side: 'left',
            content: <><TriangleAlert size={12} /> {problems.length}</>,
            command: 'view.problems',
            title: '问题',
        },
    ];
    if (progress !== null) items.push({ id: 'analysis', side: 'left', content: `分析音频 ${Math.round(progress * 100)}%` });
    else if (status) items.push({ id: 'status', side: 'left', content: status });
    items.push(
        { id: 'time', side: 'right', content: formatTime(time) },
        { id: 'format', side: 'right', content: format ? format.toUpperCase() : '纯音乐', command: 'view.assets' },
        { id: 'pack', side: 'right', content: project.direction.mode === 'mix' ? '按段落混用' : packLabel(project.direction.pack), command: 'view.look' },
        { id: 'aspect', side: 'right', content: project.aspect, command: 'view.look' },
        { id: 'seed', side: 'right', content: `seed ${project.seed}`, command: 'arrange.reseed', title: '换一个 seed' },
    );
    return items;
}

function ProblemsPanel() {
    return <ProblemsList problems={useProblems()} />;
}

export function App() {
    const audioUrl = useSession(state => state.audioUrl);
    const [ready, setReady] = useState(false);
    const problems = useProblems();
    const statusItems = useStatusItems();

    useEffect(() => {
        void bootstrapProject().finally(() => {
            setReady(true);
            installAgent();
        });
        return installKeybindings();
    }, []);

    const mobile = useIsMobileLayout();
    const preview = ready ? <Preview /> : <div className="flex-1" />;

    return (
        <>
            {mobile ? <MobileShell preview={preview} /> : <Workbench
                menus={APP_MENUS}
                sideViews={[
                    { id: 'assets', title: '歌曲', icon: FolderOpen, component: () => <AssetsPanel /> },
                    { id: 'outline', title: '大纲', icon: ListTree, component: () => <OutlineView /> },
                    { id: 'look', title: '画面与编排', icon: Palette, component: () => <StylePanel /> },
                    { id: 'library', title: '风格库', icon: LayoutGrid, component: () => <StyleLibrary /> },
                    { id: 'assetLibrary', title: '素材库', icon: Images, component: () => <LibraryView /> },
                    { id: 'ai', title: 'AI', icon: Sparkles, component: () => <AiPanel /> },
                    { id: 'agent', title: 'Agent', icon: Bot, component: () => <AgentPanel /> },
                ]}
                panelViews={[
                    { id: 'timeline', title: '时间轴', component: () => <Timeline /> },
                    { id: 'problems', title: '问题', badge: () => problems.length || null, component: () => <ProblemsPanel /> },
                    { id: 'output', title: '输出', component: () => <OutputView /> },
                ]}
                auxTitle="检查器"
                auxBar={<Inspector />}
                editor={<EditorArea preview={preview} />}
                statusItems={statusItems}
            />}
            <ExportDialog />
            <Wizard />
            <audio
                ref={element => clock.attachAudio(element)}
                src={audioUrl ?? undefined}
                onPlay={syncPlaying}
                onPause={syncPlaying}
                onEnded={syncPlaying}
            />
        </>
    );
}
