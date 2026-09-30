# LumiScript（剧本语言）

剧本是工程的场景编排写成的文字（LumiScript v2，声明式）：全曲的编排方式、分段、每段的包与转场、镜头的锁定与组件、歌词行、背景轨、素材片段。编辑区「剧本」标签页可以直接改、导入 `.lumiscript` 文件，`Ctrl+S` 应用；主题、字体、画幅、tuning 在同一标签页的「设置」视图（JSON sidecar）。agent 通过 `get_script` / `check_script` / `apply_script` 与 `get_settings` / `apply_settings` 读写同样的内容。

完整的语法参考与写剧本的 agent skill 在 [`skills/lumiscript/`](../skills/lumiscript/)：

- [`reference.md`](../skills/lumiscript/reference.md)：语法、应用规则、诊断编号、例子、设置的结构；
- [`SKILL.md`](../skills/lumiscript/SKILL.md)：给 agent 的工作流程（连着 MCP 时与只写文件时）。

两份文件打进页面：MCP 工具 `script_reference` 返回它们，「Agent」面板可以打包下载（解压到 agent 的 skills 目录，例如 Claude Code 的 `~/.claude/skills/`）。
