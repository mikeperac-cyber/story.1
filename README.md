# The Lanternberry Path reader

A responsive, static storybook reader for the ten illustrated stories in the parent project.

## Run locally

Requires Node.js 20.19+ or 22.12+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. `pnpm build` generates the deployable website in `dist/` and a portable `dist/lanternberry-path-offline.html` file. The offline file contains all ten stories and their illustrations, so it can be downloaded or copied and opened directly in a current browser without an internet connection or installation. `pnpm build:web` generates only the website files.

## Deploy on Vercel

Import `mikeperac-cyber/story.1` from GitHub. The included `vercel.json` sets the build command to `pnpm run build:web` and the output directory to `dist`; dependencies install from the committed pnpm lockfile. No environment variables or server functions are required. The web deployment includes the story illustrations and narration audio as static files. The separate, self-contained offline HTML download is generated locally with `pnpm build` and is not included in the Vercel web build.

## Story content and artwork

`pnpm sync-content` refreshes the reader data from the parent folder's ten manuscript and illustration-prompt Markdown files. It normalizes the manuscripts' continuous book-page numbers into ten local pages per story and uses those same numbers to pair narrative text with the right illustration.

`python scripts/prepare-assets.py` creates the compact WebP covers, thumbnails, and page images under `public/images/`. It requires Pillow and reads source illustrations from the parent folder's `assets/` directory.

## Free, expressive narration

The reader includes locally generated Qwen narration for all 100 story pages. One warm English narrator carries the book, while each page has its own line-aware delivery direction for emotion, gentle pitch movement, dialogue, pauses, and pace. The audio is MP3, embedded in the offline HTML, and plays without an account, subscription, API key, or internet connection. Qwen3-TTS is open-weight under Apache 2.0; the model is only needed on the computer that generates or regenerates the clips. See the [Qwen3-TTS model](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) and [project documentation](https://github.com/QwenLM/Qwen3-TTS).

To regenerate narration after editing the story text, use Python 3.12 and install the free local requirements:

```sh
python -m pip install -r requirements-narration.txt
pnpm narrate
pnpm build
```

The first run downloads the model once. Generation runs locally with CUDA when available and otherwise uses the CPU; it can be resumed after an interruption. A CUDA-capable PyTorch install can make local generation much faster; use the official [PyTorch install selector](https://pytorch.org/get-started/locally/) for the computer's driver and GPU. The computer-voice fallback remains available for readers and gently varies pitch, pace, and pauses sentence by sentence. Browser voices vary by device.

The former Kokoro generator remains available as `pnpm narrate:kokoro` with `requirements-narration-kokoro.txt` for anyone who wants to reproduce the earlier neutral clips.

## Reader features

- Search all stories and filter by theme.
- Save reading progress, bookmarks, text size, and panel opacity in the browser.
- Navigate by buttons, page dots, arrow keys, or touch swipes.
- Read pages aloud with consistent, locally generated Aiden narration that follows each page's emotions, or use an expressive English voice available on the device. The device voice gently changes pace and pitch for curious, worried, joyful, brave, and tender lines. Slow narration down to 0.5×, use the one-tap Slow control at 0.6×, or adjust up to 1.15×.
- Adjust text size and the parchment panel opacity. The panel remains at least 72% opaque for contrast and scrolls when a reader chooses a larger text size than fits on one screen.

Reading data stays in this browser; the site has no account or server-side storage. Browsers may limit saved progress when an HTML file is opened from Downloads, but reading and the reader controls work in that session. Aiden narration is bundled with the book and works offline; optional browser voices vary by device, and voices marked “online” may need a connection.
