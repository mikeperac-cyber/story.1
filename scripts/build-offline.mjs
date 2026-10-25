import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(projectRoot, "dist");
const publicDirectory = path.join(projectRoot, "public");

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(absolutePath) : [absolutePath];
  }));
  return nested.flat();
}

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".svg": return "image/svg+xml";
    case ".mp3": return "audio/mpeg";
    default: throw new Error(`Unsupported offline asset type: ${filePath}`);
  }
}

function replaceEverywhere(source, replacements) {
  let result = source;
  for (const [localPath, dataUrl] of replacements) result = result.replaceAll(localPath, dataUrl);
  return result;
}

const indexPath = path.join(distDirectory, "index.html");
let html = await readFile(indexPath, "utf8");
const bundleFiles = (await readdir(path.join(distDirectory, "assets")))
  .map((name) => path.join(distDirectory, "assets", name));
const scripts = bundleFiles.filter((name) => name.endsWith(".js"));
const stylesheets = bundleFiles.filter((name) => name.endsWith(".css"));

if (scripts.length !== 1) throw new Error(`Expected one JavaScript bundle, found ${scripts.length}.`);
if (stylesheets.length !== 1) throw new Error(`Expected one CSS bundle, found ${stylesheets.length}.`);

let javascript = await readFile(scripts[0], "utf8");
let css = await readFile(stylesheets[0], "utf8");
const replacements = [];

for (const assetPath of await filesIn(publicDirectory)) {
  const relativePath = path.relative(publicDirectory, assetPath).split(path.sep).join("/");
  const publicPath = `/${relativePath}`;
  const asset = await readFile(assetPath);
  replacements.push([
    publicPath,
    `data:${contentTypeFor(assetPath)};base64,${asset.toString("base64")}`,
  ]);
}

javascript = replaceEverywhere(javascript, replacements);
css = replaceEverywhere(css, replacements);
html = replaceEverywhere(html, replacements);

for (const [publicPath] of replacements) {
  if (javascript.includes(publicPath) || css.includes(publicPath) || html.includes(publicPath)) {
    throw new Error(`Offline bundle still references a separate asset: ${publicPath}`);
  }
}

const scriptTag = html.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/i);
if (!scriptTag) throw new Error("Could not find the Vite JavaScript bundle tag in dist/index.html.");
html = html.replace(scriptTag[0], "");
html = html.replace(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi, "");
html = html.replace("</head>", () => `  <style>${css}</style>\n  </head>`);
html = html.replace("</body>", () => `    <script type="module">${javascript.replace(/<\/script/gi, "<\\/script")}</script>\n  </body>`);

if (/<(?:script|link|img)\b[^>]+\b(?:src|href)=["'](?:https?:)?\/\//i.test(html)) {
  throw new Error("The offline reader contains an external script, stylesheet, or image reference.");
}

const outputPath = path.join(distDirectory, "lanternberry-path-offline.html");
await writeFile(outputPath, html, "utf8");
const sizeMegabytes = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(1);
console.log(`Created ${path.relative(projectRoot, outputPath)} (${sizeMegabytes} MB, ${replacements.length} embedded media assets).`);
