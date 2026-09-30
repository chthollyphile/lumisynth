# LumiScript v2 语法参考

LumiScript 是 lumisynth 工程的**场景编排**写成的文字：全曲的编排方式、每一段歌词怎么分段、每段用哪个风格包、每个镜头用什么风格与组件、段落之间的转场、背景轨、画面上的素材片段。生成的剧本就是自动编排的结果，直接在上面改：改了的值固定下来，没改的保持自动。也可以手写、让 agent 写、从别的工程复制过来导入。

主题、字体、画幅、风格库偏好、编排参数、各种 tuning 不在剧本里，在「设置」（一份 JSON，见文末）。

代码：生成 `src/script/print.ts`，解析 `src/script/cst.ts` + `parse.ts`，检查 `check.ts`，应用 `apply.ts`，诊断 `diagnostics.ts`，设置 `settings.ts`；编辑器支持 `src/app/script/lumiscript.ts`。

## 词法

- 一行一条语句，词之间用空白分开。行尾是 `{` 的语句带一个块，块以单独一行的 `}` 结束。
- 字符串用 JSON 的写法：`"大正浪漫"`、`"a \"b\""`。
- 注释：`# ` 开头（井号后面是空格或行尾），可以占一整行，也可以跟在语句后面。`#1e1b4b` 这样紧跟十六进制的是颜色，不是注释。
- 时间：`m:ss.cc`（`1:05.46`），也可以只写秒（`65.46`）；时间段：`m:ss.cc-m:ss.cc`。
- 行号、段落号、镜头号都从 1 起（间奏占位行 `......` 也占行号）。注意 agent 直接调用的 MCP 工具（`get_lyrics`、`get_arrangement`、`edit_structure`……）从 0 起：剧本里的第 n 行 / 第 n 段是工具里的 n-1。
- 片段与素材的 id 只写前几位，能唯一确定就行。素材也可以写文件名：`asset "猫.png"`。

## 改编排结果：自动、改过、locked

生成的剧本把编排的结果都写成指令：每段的性质、包、energy、族、出场转场，每个镜头的风格与组件（排版、点缀……）。自动选出的值后面有注释 `# 自动`。

- **改了值**（比如把 `pack tempera` 改成 `pack sonnet`，把镜头的风格换一个）：这个值固定下来，应用后重新载入时标着 `locked`。换 seed、换编排方式也不会变。
- **没改的值**保持自动：换 seed、改编排方式之后会重新选。
- **`locked`**：固定下来。想把当前自动选出的值原样固定，就在后面加 `locked`；去掉 `locked` 就交回自动。
- **`@ai`**：固定下来，并且标明这条来自 AI 编排（「清除 AI 编排」会清掉它）；手写的不用加。
- **`auto`**，或者整行删掉：交回自动。

「没改」是和当前工程的编排比的：值和它一样、又没标 `locked` / `@ai` 的，就当作自动。所以手写剧本时，写的值碰巧和当前自动结果一样就不会被固定——想确定固定就写 `locked`。

改不了的编译结果写在 `# ` 注释里：段落编号与时间、镜头的时间、余韵、分段原因、每个镜头唱的歌词。改注释没有任何作用。生成的剧本原样应用回去什么都不变。

## 应用的规则：写了的部分整体替换，没写的部分不动

| 剧本里出现了 | 效果 |
|---|---|
| `seed`、`direction`、`shot-mixing`、`lyric-offset` | 各自设成写的值 |
| 任意一条 `mix` | 混用分配 = 默认分配 + 写了的这几条 |
| 任意一个 `paragraph` 块 | **整个场景编排**按剧本来：分段、段落性质、段落的包 / energy / 族、出场转场、镜头的风格与组件（按上一节的规则固定或保持自动）。块里没写的都是自动 |
| `paragraphs auto` | 分段、段落编排、转场、镜头修改全部交回自动（不能和段落块一起写） |
| `line` 语句 | 这一行歌词设成写的样子（文字、时间、分词、逐字时间）；没写的行不动 |
| 已有背景片段的块（带 id），或 `backgrounds none` | 背景轨就是写的这些（没写的背景片段删除；`none` 先清空），块的先后就是叠放顺序 |
| 已有素材片段的块（带 id），或 `clips none` | 素材片段就是写的这些（没写的删除；`none` 先清空） |
| 只有新片段的块（不带 id） | 加上这些片段，原来的不动 |

所以只写一个 `clip { … }` 的剧本只会加一个素材片段，只写 `seed "x"` 的剧本只换种子。整个应用是一步撤销；有错误时什么都不改；只有提示时照常应用。

剧本表达不了的东西原样保留：锚点已经失效的修改（歌词改了之后找不到的锁定、转场、编排）在剧本末尾的注释里列出来，在「问题」面板里处理。

编辑器里剧本生成之后工程在别处被改过，剧本就「过期」了：可以重新载入，或者仍然应用（剧本里写到的部分会盖掉别处的改动）。agent 用 `get_script` 附带的版本号，过期时 `apply_script` 报错，除非传 `force: true`。

## 顶层

```
lumiscript 2                    # 版本，可以不写
seed "42fe22fc"                 # 随机种子：改了会重新自动选风格、转场
direction single tempera        # 全曲一个包；direction mix：按段落性质分配包
mix chorus lumiere              # 混用时副歌用绘光（只写和默认不同的）
shot-mixing off                 # on：段内可以出现别的包的镜头（锁定别的包的风格时需要）
lyric-offset 0.00               # 歌词整体偏移（秒，正值推迟）
```

默认的混用分配：副歌用 `tempera`，上扬、间奏用 `lumiere`，主歌、换气、尾声用 `sonnet`。段落性质：`verse` 主歌、`lift` 上扬、`chorus` 副歌、`breath` 换气、`break` 间奏、`outro` 尾声。

## 段落块

```
paragraph chorus locked {               # 性质（<性质>|auto）写在块头；这里是手动指定的
  pack sonnet locked                    # <包>|auto
  energy auto                           # 0..1|auto（auto：由包按性质、字数决定）
  families all  # 自动                  # <族…>|all|auto（all：不限）
  line 12 0:45.20-0:47.90 "歌词"
  line 13 0:47.90-0:50.10 "歌词" {
    translation "译文"                  # 译文（字幕）；none 不显示；不写用歌词文件里的
    parts "歌" "词"                     # 手动分词：拼起来要等于这一行的文字
    word 0:47.90-0:48.60 "歌"           # 逐字时间：按顺序、不重叠、在行的时间内
    word 0:48.60-0:50.10 "词"
  }
  shot 1 sonnet/type-impact {  # 0:45.20-0:47.90 · 自动 · "歌词"
    typography stack                    # <组件槽> <取值>|auto [locked]
    accent none locked                  # 这个组件手动换过
  }
  shot 2 sonnet/slab-scroll locked      # 风格锁定
  transition sonnet/wipe-up  # 自动 · 1:01.50-1:02.10   # <转场>|none|auto：出场转场（最后一段没有）
}
```

- **分段**：一段包含哪些歌词行，由块里的 `line` 语句决定（要一行接一行）；不想写歌词时用 `lines a..b`。所有段落块要按顺序、首尾相接地覆盖全部歌词行。拆段就是把 `line` 分到两个块里，合并就是把两个块的 `line` 放进一个块。和自动分段一样的地方不算手动。
- **镜头**：`shot N <风格>` 指这一段的第 N 个镜头——分段没变时就是生成剧本时的那个镜头；分段改了的段落，改过的镜头按新的划分编号套上去（给出提示）。镜头由编排生成，删掉 `shot` 行不会删掉镜头，只是交回自动。换风格就是锁定；锁定成别的包的风格要 `shot-mixing on`。
- **组件**写在镜头的块里，一行一个组件槽（凝彩：`typography`、`accent`；商籁、绘光各有自己的），可选值见编辑器的补全或 agent 的 `list_styles`（`optionDetails` 里有每个选项的说明；`list_styles` 的 `style: "包/风格"` 给出单个风格的描述与它能借的排版）。排版槽可以写 `<别的包>/<排版>` 借用别的包的排版。改了的组件逐镜头替换，标 `locked`。把镜头换成别的包的风格时，块里留着的原来那个包的组件（值没改过的）自动去掉并给出提示（LS903），组件由新包自动选。
- **歌词行** `line 行号 时间 "文字"`：行号是歌词文件里的行号；时间是歌词文件的时间（不含 `lyric-offset`）。改字时没变的字保留原来的时间，新写的字均分被替换掉的那一段；写了 `word` 就用写的逐字时间（改字后 `word` 要跟着改，删掉 `word` 行就按改字规则重新分配）。写回原文与原来的时间就是恢复原样。没写 `parts` 就用自动分词。`translation "…"` 改这一行的译文（字幕），`translation none` 不显示（比如歌词文件把「翻译由……提供」、`//` 之类的占位放进了译文）；没写就用歌词文件里的译文，生成的剧本只写改过的。纯音乐（没有歌词文件）的段落只能写 `lines a..b`。

## 背景片段

```
background 3f2a1b4c {                   # 已有片段写 id 的前几位；新片段不写 id
  source gradient #1e1b4b #115e59 40    # theme | cover | gradient 颜色 颜色 角度 | image <素材> | video <素材> [offset 秒] [loop]
  at song                               # 挂载点，见下
  fit cover                             # cover|contain
  ken-burns 0.06
  blur 0.0
  dim 0.25
  fade 0.60 0.60                        # 淡入 淡出
}
```

`source` 与 `at` 必须写，其余不写取默认值（上面就是默认值）。只有背景可以用视频。

## 素材片段

```
clip 9c0d11aa {
  asset 5e6f7a8b                        # 素材库里的图片：id 的前几位或 "文件名"
  at paragraph 3
  extend 0.00 0.00                      # 提前出现 / 延后消失（秒）
  slot front                            # back 场景之下 | mid 场景之上、歌词之下 | front 歌词之上 | overlay 最上层
  position 0.820 0.700                  # 中心点（画面宽高的比例）
  scale 0.300                           # 高度占画面高度的比例
  rotate 0.0                            # 度
  opacity 1.00
  flip off
  blend normal                          # normal|add|multiply|screen
  follow off                            # 跟随运镜：off | scene 程度 | motion 程度（程度 0..1，默认 1）
  enter fade 0.40                       # none|fade|slide-up|slide-down|slide-left|slide-right|zoom|rush-left|rush-right|pop 秒
  exit fade 0.40
  effect echo #ffffff 0.50 0.60 1.60    # none | echo|glow|shadow [颜色] [幅度] [不透明度] [周期秒]
  motion float 0.50                     # none | float|drift|push|sway [幅度]
}
```

`asset` 与 `at` 必须写。默认值：`slot front`、`position 0.5 0.5`、`scale 0.5`、`enter/exit fade 0.40`、`effect none`、`motion none`，其余为 0 / off / normal。

跟随运镜：`scene` 贴在场景上（随镜头推拉、平移、旋转，切镜头时跟着跳），`motion` 只跟随镜头内的运动（每个镜头从原位开始）。`position`、`scale`、`rotate` 是没有运镜时的值。附加效果是和图片同形状的纯色剪影：`echo` 重影扩张、`glow` 外发光、`shadow` 投影。

## 挂载点 `at`

- `song`：全曲；
- `m:ss.cc-m:ss.cc`：绝对时间；
- `lines a..b`：跟随这几行歌词；
- `paragraph N`：跟随第 N 段（剧本里写了段落块时按剧本的段落数）；
- `shot P.S`：跟随第 P 段的第 S 个镜头；
- `missing`：锚点已失效（生成时写出），保持原来的挂载不变。只能用在已有的片段上。

## 诊断

每条诊断都有编号、位置（行、列）、一句话说明，常带一条提示（「是不是想写 …？」）、相关位置与快速修复（编辑器里是按钮，agent 的 `check_script` 返回替换文字）。

| 编号 | 阶段 | 例子 |
|---|---|---|
| LS101–LS106 | 词法与括号 | 字符串没有结束、`{` 不在行尾、多余的 `}`、块没有结束 |
| LS110–LS120 | 语句 | 不认识的关键字（v1 的写法给迁移提示）、缺参数、多余的参数、数字 / 时间 / 行范围写错、超出范围、枚举值不对、颜色格式、版本 |
| LS201–LS213 | 名称 | 没有这个包 / 风格 / 转场 / 族 / 组件槽 / 组件取值 / 可借的排版 / 素材 / 片段，素材 id 不唯一，图片与视频用错地方 |
| LS301–LS319 | 结构 | 有歌词行不在任何段落里、段落重叠、行号越界、同一行写了两遍、段落没写行、`line` 不连续、片段重复、缺少必填字段、挂载点越界、逐字时间拼不出文字 / 越界 / 重叠、分词拼不出文字、纯音乐不能写 `line`、`paragraphs auto` 与段落块同时写、镜头号越界、最后一段写了转场 |
| LS401–LS406 | 编译 | 没法按写的分段、锁不上风格（包不对，要 `shot-mixing on`）、组件用不上、镜头在应用后的编排里不存在、转场或段落编排没生效 |
| LS901–LS903 | 提示 | 分段改了、镜头按新划分编号；同一条指令写了两遍（以后面的为准）；镜头换了包，原来那个包的组件去掉了 |
| LS501–LS507 | 设置（JSON） | JSON 写法、不认识的键、类型不对、取值不对、没有这个包、超出范围被夹住、风格库里的风格不存在 |

编译阶段的问题是按「这次应用之后的编排」查的：写了但做不到的指令是错误；原来就有、这次被别的修改（换 seed、改歌词）弄得对不上的修改只是提示，照常保留。

## 例子

把第 2 段交给商籁、第 3 段第 1 个镜头换一个风格、把第 3 段第 2 个镜头当前的风格固定下来、把一张图挂到第 4 段（在生成的剧本上改）：

```diff
 paragraph verse {  # 第 2 段 · 主歌（自动）· …
-  pack tempera  # 自动
+  pack sonnet
 …
 paragraph chorus {  # 第 3 段 · 副歌（自动）· …
 …
-  shot 1 tempera/louvre-slats {  # 0:03.00-0:04.10 · 自动 · …
+  shot 1 tempera/duo-split {
 …
-  shot 2 tempera/ring-eye {  # 0:04.10-0:06.00 · 自动 · …
+  shot 2 tempera/ring-eye locked {
 …
+clip {
+  asset "猫.png"
+  at paragraph 4
+  position 0.8 0.3
+}
```

从零手写的整曲编排（40 行歌词）：

```
lumiscript 2
seed "night-drive"
direction single sonnet
paragraph verse locked {
  lines 1..8
}
paragraph chorus locked {
  lines 9..16
  pack tempera locked
  energy 0.9 locked
  transition none locked
}
paragraph verse locked {
  lines 17..40
}
```

手写时每个想固定的值都加上 `locked`（不加的话，碰巧和当前自动结果一样的值不会被固定）。

只改设置、不动编排：用「设置」（下一节）。

## 设置（sidecar）

编辑区「剧本」标签页的「设置」视图、agent 的 `get_settings` / `apply_settings`：一份 JSON，顶层是

- `name`、`meta`（`title` / `artist` / `album`）、`aspect`（`16:9` / `9:16` / `1:1` / `4:3`）；
- `theme`：`variant`（当前用 `dark` 还是 `light`）、`source`、`dark` 与 `light` 两套主题（四个颜色 `#rrggbb`、`animationIntensity`、`wordColors` 关键字着色、`lyricsIcons` 图标……）；
- `typography`：`lyrics`、`subtitles` 的字体（上传的字体文件不在这里）；
- `library`：收藏 / 屏蔽的风格；
- `engineParams`：分段参数（`paragraph`）与各包的编译参数（`packs`）；
- `tuning`：内核（`kernel`：背景、后处理、字幕、运动倍率……）与各包（`packs`）的观感设置。

「设置」视图（与导入的 `.json`）的规则与剧本相同：写了的顶层部分整体替换（部分里缺的字段取默认值），没写的不动，比如 `{ "aspect": "9:16" }` 只改画幅。agent 的 `apply_settings` 默认是合并方式（`mode: "merge"`）：只改写到的字段，比如 `{ "tuning": { "kernel": { "subtitles": { "opacity": 0.9 } } } }` 只改字幕的不透明度，同一部分里的其他设置不动；数组（`wordColors`、`library.favorites`……）整个替换。要按整体替换的规则来就传 `mode: "replace"`。字段的类型按默认值检查；不认识的键、类型不对是错误（带拼写建议），超出范围被夹住的值给提示。
