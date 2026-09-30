# lumisynth

[简体中文](README.md) | **English**

Turn a song into a lyric video, right in your browser: import the audio and lyrics, let it lay out the shots automatically, fine-tune what you like, and export a video.

**Try it online: <https://lumisynth.cielaniska.top/>**

[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)

The interface is available in Chinese and English (switch it in the language selector).

![Workbench](docs/images/workbench.png)

## Features

- **Automatic direction**: lyrics are split into sections and shots, each shot picked from a style pack's presets — it looks good out of the box.
- **Four style packs**: Tempera, Sonnet, Lumiere and Hanabi. Use one for the whole song or mix them per section.
- **Manual editing**: edit sections, shots, transitions and lyric timing on the timeline; restyle, lock or decorate any shot.
- **Lyric formats**: LRC / YRC / QRC / KRC / TTML / VTT / SRT / ASS and more, with translation and romanization lines.
- **Assets and backgrounds**: layer images and videos into the frame, or use them as a background track.
- **Video export**: frame-accurate MP4 / WebM up to 4K, or export separate transparent layers.
- **AI (optional)**: bring your own API key for theme colors, word segmentation and direction; everything also works with local rules only.
- **Agent integration**: via MCP, agents such as Claude Code can read and edit the open project directly.
- **Local projects**: projects live in your browser (or on disk in the desktop app); export / import them as `.lumi` files.

## Style packs

| Tempera | Sonnet |
|---|---|
| ![Tempera](docs/images/pack-tempera.png) | ![Sonnet](docs/images/pack-sonnet.png) |
| Halftone and geometric motion graphics | Kinetic typography with wireframe layouts |
| **Lumiere** | **Hanabi** |
| ![Lumiere](docs/images/pack-lumiere.png) | ![Hanabi](docs/images/pack-hanabi.png) |
| Volumetric light, haze and glowing text in the dark | Japanese lyric-video style: color-block text, fireworks, an ever-rising camera |

To write your own style pack, see [docs/PACKS.md](docs/PACKS.md) (Chinese).

## Getting started

- **Web**: just open <https://lumisynth.cielaniska.top/> — nothing to install.
- **Desktop**: installers for Windows / macOS / Linux are on the [Releases](../../releases) page; works offline. See [docs/DESKTOP.md](docs/DESKTOP.md) (Chinese).

Basic flow: choose audio → import lyrics → preview the automatic direction → adjust on the timeline → export.

## AI and agents

AI is optional. In the AI side bar, pick a provider (Google Gemini, any OpenAI-compatible API, or Anthropic Claude) and enter your own key. Requests go straight from your browser to the provider, and the key is stored only in your browser.

To let an agent direct the video: download the local bridge `lumisynth-mcp.mjs` from the Agent panel, add it to your agent (e.g. `claude mcp add lumisynth -- node /path/to/lumisynth-mcp.mjs`), then pair following the panel's instructions. The script language and agent workflow are described in [docs/SCRIPT.md](docs/SCRIPT.md) (Chinese).

## Deployment

The build output `dist/` is plain static files and runs on any static host (fall back unknown paths to `index.html`). Configs for Cloudflare Workers (`npm run cf:deploy`) and Vercel (import the repo) are included.

Deploy your own copy to Cloudflare in one click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/lumisynth)

## Development

```bash
npm install
npm run dev          # dev server
npm test             # unit tests
npm run build        # build the web app
npm run dev:electron # desktop app in development
```

## License

Copyright © 2023–2026 chthollyphile.
Licensed under the GNU Affero General Public License v3.0 only. See [LICENSE](LICENSE).

The style pack and lyric processing code is ported from folia (also AGPL-3.0).
