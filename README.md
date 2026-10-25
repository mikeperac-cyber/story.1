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

## Free model narration

The finished reader includes locally generated Kokoro narration for all 100 story pages. The audio is MP3, embedded in the offline HTML, and plays without an account, subscription, API key, or internet connection. Kokoro is open-weight under Apache 2.0; the model itself is only needed on the computer that generates or regenerates the clips.

To regenerate the voice clips after editing the story text, use Python 3.12 and install the free local requirements:

```sh
python -m pip install -r requirements-narration.txt
python scripts/generate-narration.py
pnpm build
```

The first generation downloads the Kokoro model and voice files once. It uses the local computer to render the audio. The generated clips use the `af_heart` English voice at a gentle story pace; readers can change playback speed or choose an English voice supplied by their browser.

## Reader features

- Search all stories and filter by theme.
- Save reading progress, bookmarks, text size, and panel opacity in the browser.
- Navigate by buttons, page dots, arrow keys, or touch swipes.
- Read pages aloud with consistent, model-generated Kokoro narration or another English voice available on the device. Kokoro audio is included in both the web build and the portable offline file. Adjust the reading pace from 0.75× to 1.15×.
- Adjust text size and the parchment panel opacity. The panel remains at least 72% opaque for contrast and scrolls when a reader chooses a larger text size than fits on one screen.

Reading data stays in this browser; the site has no account or server-side storage. Browsers may limit saved progress when an HTML file is opened from Downloads, but reading and the reader controls work in that session. Kokoro narration is bundled with the book and works offline; optional browser voices vary by device, and voices marked “online” may need a connection.
