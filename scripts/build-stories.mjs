import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storyMetadata } from "../src/data/story-metadata.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(projectRoot, "..");
const pageHeadingPattern = /^### Page (\d+)(?:\s+[—-].*)?\s*$/gm;
const storyFiles = Array.from({ length: 10 }, (_, index) =>
  `story-${String(index + 1).padStart(2, "0")}-manuscript.md`,
);

function extractScene(promptText, localPage) {
  const headings = [...promptText.matchAll(pageHeadingPattern)];
  const heading = headings.find((match) => Number(match[1]) === localPage);
  if (!heading) return "a moment from the story";

  const end = headings.find((match) => match.index > heading.index)?.index ?? promptText.length;
  const section = promptText.slice(heading.index + heading[0].length, end);
  const scene = section.match(/\*\*Scene:\*\*\s*([\s\S]*?)(?=\*\*Characters?:)/i)?.[1];
  if (!scene) return "a moment from the story";
  return scene.split(/\.\s|\n/)[0].replace(/\s+/g, " ").trim();
}

const stories = [];
for (let id = 1; id <= 10; id += 1) {
  const fileName = storyFiles[id - 1];
  const raw = await readFile(path.join(sourceRoot, fileName), "utf8");
  const title = raw.match(/^# Story \d+\s*[—-]\s*(.+)$/m)?.[1]?.trim();
  if (!title) throw new Error(`Story title missing in ${fileName}`);

  const headings = [...raw.matchAll(pageHeadingPattern)];
  if (headings.length !== 10) throw new Error(`${fileName} has ${headings.length} pages; expected 10.`);
  const promptText = await readFile(
    path.join(sourceRoot, `story-${String(id).padStart(2, "0")}-illustration-prompts.md`),
    "utf8",
  );

  const pages = headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? raw.length;
    const body = raw.slice(heading.index + heading[0].length, end);
    const text = body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== `**${title}**`)
      .join(" ")
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const globalPage = Number(heading[1]);
    const localPage = globalPage - (id - 1) * 10;
    if (localPage < 1 || localPage > 10) {
      throw new Error(`${fileName} has an out-of-range book page ${globalPage}.`);
    }
    if (!text) throw new Error(`Empty narrative in ${fileName}, page ${localPage}.`);

    return {
      number: localPage,
      bookPage: globalPage,
      text,
      artUrl: `/images/pages/page-${String(globalPage).padStart(3, "0")}.webp`,
      alt: `${title}: ${extractScene(promptText, globalPage)}.`,
    };
  });

  stories.push({
    id,
    title,
    theme: storyMetadata[id].theme,
    summary: storyMetadata[id].summary,
    coverUrl: `/images/thumbnails/story-${String(id).padStart(2, "0")}.webp`,
    pages,
  });
}

await writeFile(
  path.join(projectRoot, "src/data/stories.json"),
  `${JSON.stringify(stories, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote ${stories.length} stories and ${stories.reduce((sum, story) => sum + story.pages.length, 0)} pages.`);
