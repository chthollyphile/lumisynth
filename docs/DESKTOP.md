# 桌面版（Electron）

桌面版就是把网页版装进一个窗口：功能相同，不需要联网也能编辑与导出（AI 仍然直连各提供方）。
安装包在 GitHub Releases 下载，支持 Windows（x64）、macOS（Apple Silicon / Intel）与 Linux（x64，deb / rpm / tar.gz）。

## 和网页版的区别

- **工程存在本机**：保存在应用自己的数据目录里，与浏览器里的网页版互不相通。要搬工程，用「文件 → 另存为 .lumi」导出，再在另一边导入。
- **本机字体**直接可用，不会再弹浏览器的权限询问。
- **MCP 本地桥**照常使用（「Agent」面板下载 `lumisynth-mcp.mjs`，或用仓库里的 `public/lumisynth-mcp.mjs`），不会有浏览器「访问本机网络」的询问。用 `--origin` 限制来源时，桌面版的来源是 `app://lumisynth`。
- **AI 直连**：请求的来源是 `app://lumisynth`。允许任意来源跨域的服务不受影响；Ollama 需要把 `OLLAMA_ORIGINS` 设为 `app://lumisynth`（或 `*`）。
- **F12** 打开开发者工具（macOS 在「显示」菜单里）。

## 更新

- **Windows**：启动后会在后台检查并下载新版本，下完提示重启安装；选「稍后」会在退出时安装。
- **macOS / Linux**：安装包没有签名，不能自动安装更新。启动时发现新版本会提示「前往下载」，下载新安装包覆盖安装即可，工程数据会保留。macOS 也可以在应用菜单里点「检查更新…」。

## macOS：提示「已损坏」或「无法验证开发者」

安装包没有做 Apple 签名与公证，Gatekeeper 会拦下第一次打开；这不是安装包真的坏了。

1. 先把 `lumisynth.app` 从 dmg 拖进「应用程序」，不要直接在 dmg 里运行。
2. 在「应用程序」里按住 Control 点 `lumisynth.app`，选「打开」，在弹窗里再点「打开」。
3. 还是被拦的话：「系统设置 → 隐私与安全性」，拉到底部，找到关于 lumisynth 的提示，点「仍要打开」。
4. 仍然提示「已损坏」时，在终端执行：

   ```bash
   xattr -dr com.apple.quarantine /Applications/lumisynth.app
   ```

## Windows：SmartScreen 提示

安装包没有签名，SmartScreen 可能提示「Windows 已保护你的电脑」。点「更多信息 → 仍要运行」即可。

## 开发与打包

```bash
npm run dev:electron    # 起 vite 开发服务器并在 Electron 窗口里打开，改代码热更新；关窗口一起退出
                        # （3100 被占用时 vite 自动换端口，窗口跟着加载那个地址）
npm run electron:start  # 构建后用 electron 直接运行（与安装包加载方式相同）
npm run electron:pack   # 打一个免安装的目录版到 release/，检查打包结果用
npm run electron:dist   # 按当前平台打安装包到 release/
```

主进程在 `electron/`：`main.cjs`（协议、窗口、权限、菜单）与 `updates.cjs`（检查更新）。页面通过自定义协议
`app://lumisynth/` 加载 `dist/`，工程数据跟着这个来源保存，**协议名与主机名不能改**，改了用户就看不到原来的工程了。

图标源文件是 `build/icon.svg`（与 `public/favicon.svg` 相同）；`build/icon.png` 用于 Windows / Linux，
`build/icon-mac.png` 按 macOS 的规范四周留了边。改图标后两张 PNG 都要重新导出（1024×1024，透明背景）。

## 发布

推 `v*` tag 触发 `.github/workflows/desktop-release.yml`：三个平台各打一份，汇总成一个 **draft** release。

1. 把 `package.json` 的 `version` 改成新版本号（A.B.C）并提交。
2. `git tag v<版本号>`，`git push origin v<版本号>`。tag 与 `package.json` 的版本不一致时构建会失败。
3. 构建完成后，在 GitHub Releases 里补上更新说明，然后发布。发布之后，已安装的桌面版才会检查到这个版本。

在 Actions 里手动运行这个 workflow 只打包、不建 release，打出来的文件在运行记录的 artifacts 里。
