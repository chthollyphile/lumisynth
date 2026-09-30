// src/app/dropImport.ts
// 拖放导入：拖到窗口任意处按文件类型分派；拖到素材卡片、素材库、预览画面上时按那个位置的用途导入。
import { useState, type DragEvent } from 'react';
import { getAgentState } from '@/agent/host';
import { importAudioFile, importCoverFile, importLyricsFile, importProjectFile } from '@/project/actions';
import { importLibraryFile } from '@/project/assets';
import { classifyFile, type FileKind } from '@/project/fileKinds';
import { importFontFile } from '@/project/fonts';
import { useProjectStore } from '@/project/store';
import { addBackgroundAt } from './backgroundActions';
import { log } from './output';
import { insertAssetAtPlayhead } from './views/LibraryView';
import { showQuickPick } from './workbench/QuickPick';

/** 拖放的落点：auto = 窗口任意处；其余是具体的卡片或区域。 */
export type DropTarget = 'auto' | 'audio' | 'lyrics' | 'translation' | 'cover' | 'library' | 'stage';

const KIND_LABELS: Record<FileKind, string> = {
    project: '工程', audio: '音频', lyrics: '歌词', image: '图片', video: '视频', font: '字体', unknown: '不认识的文件',
};

/** 已经有歌词时，再拖进来的歌词文件问一下是替换还是当译文。 */
const askLyricsSlot = async (file: File): Promise<'lyrics' | 'translation' | undefined> => {
    if (!useProjectStore.getState().project.lyrics) return 'lyrics';
    return showQuickPick<'lyrics' | 'translation'>([
        { label: '替换当前歌词', value: 'lyrics' },
        { label: '作为译文', value: 'translation', description: '逐行对应到当前歌词' },
    ], { title: `「${file.name}」`, placeholder: '已经有歌词了，这个文件用来…' });
};

const importToLibrary = async (file: File, place: boolean) => {
    try {
        const asset = await importLibraryFile(file);
        log(`已加入素材库：${asset.name}`);
        if (!place) return;
        // 拖到预览画面上：图片放到播放头处，视频设为播放头所在段落的背景。
        if (asset.kind === 'video') {
            addBackgroundAt({ type: 'video', assetId: asset.id, offset: 0, loop: true }, 'paragraph');
            log(`已把「${asset.name}」设为当前段落的背景`);
        } else {
            insertAssetAtPlayhead(asset, getAgentState().program);
        }
    } catch (error) {
        log(`导入「${file.name}」失败：${(error as Error).message}`, 'error');
    }
};

const importFont = async (file: File) => {
    try {
        log(`已添加字体：${await importFontFile(file)}`);
    } catch (error) {
        log(`导入字体「${file.name}」失败：${(error as Error).message}`, 'error');
    }
};

/**
 * 导入一批拖进来的文件。工程文件会换掉当前打开的工程（导入的是副本，当前工程已自动保存），
 * 所以同时拖了工程时只导入工程。歌词先于音频导入：音频自带的内嵌歌词只在没有歌词时才用。
 */
export const importDroppedFiles = async (files: File[], target: DropTarget = 'auto') => {
    if (files.length === 0) return;
    const byKind = (kind: FileKind) => files.filter(file => classifyFile(file) === kind);

    const project = byKind('project');
    if (project.length > 0) {
        if (files.length > 1) log(`同时拖入了工程文件，只打开「${project[0].name}」，其余 ${files.length - 1} 个文件没有导入`, 'warn');
        await importProjectFile(project[0]);
        return;
    }

    const audio = byKind('audio');
    const lyrics = byKind('lyrics');
    const images = byKind('image');
    const videos = byKind('video');

    if (target === 'cover' && images.length > 0) {
        await importCoverFile(images.shift()!);
    }
    for (const [index, file] of lyrics.entries()) {
        const slot = target === 'translation' || target === 'lyrics'
            ? (index === 0 ? target : await askLyricsSlot(file))
            : await askLyricsSlot(file);
        if (slot) await importLyricsFile(file, slot);
    }
    if (audio.length > 0) {
        if (audio.length > 1) log(`一次只能用一首歌：导入了「${audio[0].name}」，其余 ${audio.length - 1} 个音频没有导入`, 'warn');
        await importAudioFile(audio[0]);
    }
    for (const file of [...images, ...videos]) await importToLibrary(file, target === 'stage');
    for (const file of byKind('font')) await importFont(file);
    byKind('unknown').forEach(file => log(`不认识「${file.name}」，没有导入（支持音频、歌词、图片、视频、字体与 .lumi 工程）`, 'warn'));
};

export const describeDroppedKinds = (files: File[]) => {
    const kinds = [...new Set(files.map(classifyFile))];
    return kinds.map(kind => KIND_LABELS[kind]).join('、');
};

/** 拖动的是不是文件（拖页面里的元素、选中的文字不算）。 */
export const isFileDrag = (event: { dataTransfer: DataTransfer | null }) => Boolean(event.dataTransfer?.types.includes('Files'));

/**
 * 让一个区域接收拖放。区域处理过的 drop 会 preventDefault，窗口级的兜底处理就跳过它。
 * 返回 over（拖到上方时为 true，用来高亮）与要展开到元素上的事件处理。
 */
export const useFileDrop = (target: DropTarget) => {
    const [over, setOver] = useState(false);
    const props = {
        onDragOver: (event: DragEvent) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            if (!over) setOver(true);
        },
        onDragLeave: (event: DragEvent) => {
            // 移到子元素上也会触发 dragleave：只有真正离开这个区域才取消高亮。
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setOver(false);
        },
        onDrop: (event: DragEvent) => {
            setOver(false);
            if (!isFileDrag(event)) return;
            event.preventDefault();
            void importDroppedFiles([...event.dataTransfer.files], target);
        },
    };
    return { over, props };
};
