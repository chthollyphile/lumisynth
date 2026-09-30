---
name: lumiscript
description: Write or edit LumiScript v2, the declarative scene-arrangement language of lumisynth (lyric-video editor) — paragraphs, style packs, locked shots, transitions, lyric lines, backgrounds and image clips — plus its JSON settings sidecar (theme, fonts, tuning). Use when asked to arrange, direct, restyle or script a lumisynth project, or to produce a .lumiscript file.
---

# LumiScript（lumisynth 剧本）

LumiScript 把 lumisynth 工程的场景编排写成文字：怎么分段、每段用哪个风格包、每个镜头的风格与组件、转场、歌词行、背景轨、画面上的素材片段。生成的剧本就是自动编排的结果，直接在上面改：改了的值固定下来（标 `locked`），没改的保持自动。主题、字体、画幅、tuning 在另一份 JSON「设置」里。完整语法见同目录的 `reference.md`（连着 lumisynth 时也可以调用 MCP 工具 `script_reference`）。

## 工作流程

### 连着 lumisynth（MCP 工具可用，名字可能带 `lumisynth_` 前缀）

1. `get_project` 看全貌：`lineCounts`（总行数 / 演唱行 / 间奏占位行 `......`，间奏行也占行号）、`timeline`（音频时长、最后一句歌词结束、编排结束、`uncoveredTail` 尾部没有编排的范围）。`list_styles` 看有哪些包、风格、族、转场、组件槽（写名字前先查，别猜）。全目录很大：先 `brief: true` 浏览（每个风格只有 id / 名字 / 族 / mood / 描述），用 `pack`、`family`、`mood`、`keyword`（匹配风格名、描述、关键词）缩小范围，再用 `style: "包/风格"` 看单个风格的完整说明与组件槽。
2. `get_script` 取当前剧本（末尾是版本号，结构化结果里是 `version` 字段）。每段的性质、包、energy、族、转场，每个镜头的风格与组件都写成了指令（自动的标 `# 自动`）；注释里有改不了的结果：编号、时间、每个镜头唱的歌词——据此决定改什么。
3. 在剧本上直接改值（改了就固定下来），或者只写要设的部分（见「部分剧本」）。
4. `check_script` 试一遍：看 `diagnostics`（行、列、编号、说明、`hint`、`fixes`）与 `wouldChange`。有错误就按提示改，直到没有错误、`wouldChange` 正是想要的。
5. `apply_script`（改的是 `get_script` 的输出时带上 `version`）。整个修改是一步撤销。
6. `render_frame` 看某个时刻的画面，确认效果（`times` 一次最多截 6 帧；截完播放头回到用户原来的位置）；不满意就回到 2。
7. 主题、字体、画幅、tuning：`get_settings` 看有哪些字段 → `apply_settings` 只写要改的字段（默认合并进当前设置，比如 `{ "tuning": { "kernel": { "subtitles": { "opacity": 0.9 } } } }`，其余不动）。

直接改工程的 MCP 工具（`get_lyrics`、`get_arrangement`、`set_paragraph_direction`、`edit_structure`、`set_shot_style`……）里的行号、段落号、镜头号**从 0 起**（`get_project` 的 `indexBase: 0`）；剧本和编辑器界面从 1 起，换算时别差一。`apply_scene_direction` 只改已有段落的包 / energy / 族 / 转场：**不改分段、不改段落性质**，也不碰用户手动设过的段落（结果里 `skippedManual` 列出跳过的段）；要重新分段用剧本的 `paragraph` 块或 `edit_structure`，改性质用 `set_paragraph_kind`。工具的 JSON 结果同时放在 MCP 的 `structuredContent` 里。

### 没有连着（只写文件）

写一个 `.lumiscript` 文件交给用户，用户在编辑区「剧本」标签页点「导入」，检查无误后按 Ctrl+S 应用。

- 行号、段落数、素材 id 都要和用户的工程对得上。最好先请用户在「剧本」标签页「下载」当前剧本发给你，在它上面改。
- 拿不到当前剧本时，只写不依赖工程细节的部分：`seed`、`direction`、`mix`、`shot-mixing`，或用 `lines a..b` 写分段（要覆盖全部歌词行），素材用 `"文件名"` 引用。
- 设置写成 `.json` 文件，同样导入（「设置」视图）。

## 要点

- 改了的值固定下来；没改的保持自动（换 seed 会重新选）；`locked` 把当前值原样固定，去掉 `locked` 或写 `auto` 交回自动。「没改」是和当前编排比的，所以**从零手写时想固定的值都加 `locked`**。
- 注释（`# ` 开头）改了没有作用。生成的剧本原样应用什么都不变。
- **部分剧本**：写了的部分整体替换，没写的不动。只要写了一个 `paragraph` 块，所有段落都按剧本来（块要按顺序覆盖全部歌词行，块里没写的指令就是自动）；不写段落块就不动编排。只写新的 `clip { … }` / `background { … }`（不带 id）是加片段；写了已有片段就是完整列表。
- 镜头：`shot N <包/风格> {` 改风格就是锁定（别的包的风格要 `shot-mixing on`）；块里一行一个组件 `<槽> <值>`，改了就逐镜头替换，排版槽可以借别的包的排版 `<包>/<排版>`。换成别的包的风格时，块里原来那个包的组件会自动去掉（提示 LS903），不用手动删。
- 改歌词：改 `line` 的文字或时间（时间是歌词文件的时间，不含 `lyric-offset`）。写了 `word` / `parts` 的行改字后要跟着改，或者删掉它们。译文（字幕）在 `line` 的块里写 `translation "…"`，`translation none` 不显示——片头的「翻译由……提供」、`//` 之类混进译文的内容这样去掉（MCP：`set_line_text` 的 `translation`，`""` 不显示）。
- `@ai` 只用来保留 AI 生成的编排的出处，自己写的不用加。
- 错误编号：1xx 语法，2xx 名称，3xx 结构，4xx 编译（写了但编排里做不到），5xx 设置。每条都有提示，照着改。

## 例子

在生成的剧本上：第 2 段交给商籁、第 3 段第 1 个镜头锁定、把「猫.png」挂在第 4 段右上角。

```
paragraph verse {  # 第 2 段 · …
  pack sonnet                  # 原来是 pack tempera  # 自动
  …
}
paragraph chorus {  # 第 3 段 · …
  …
  shot 1 tempera/louvre-slats locked {   # 原来的自动风格，加 locked 固定
    typography collage
    accent none                # 改了组件
  }
  …
}
…
clip {
  asset "猫.png"
  at paragraph 4
  position 0.8 0.3
  scale 0.35
}
```

只换编排方式与种子的部分剧本：

```
seed "night-drive"
direction mix
mix chorus lumiere
```
