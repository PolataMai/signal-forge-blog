import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const postsDir = path.join(cwd, "content", "posts");
const wrappersDir = path.join(cwd, "posts");
const manifestPath = path.join(postsDir, "index.json");

function normalizeListValue(value) {
  if (!value) {
    return [];
  }

  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function parseFrontMatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!match) {
    return { meta: {}, body: source.trim() };
  }

  const [, rawMeta, body] = match;
  const meta = {};

  rawMeta.split(/\r?\n/).forEach((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (value === "true") {
      meta[key] = true;
      return;
    }

    if (value === "false") {
      meta[key] = false;
      return;
    }

    if (key === "tags") {
      meta[key] = normalizeListValue(value);
      return;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  });

  return {
    meta,
    body: body.trim()
  };
}

function estimateReadingTime(text) {
  const clean = text.replace(/[`#>*_[\]\-()|]/g, " ").trim();
  const cjkChars = (clean.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = clean
    .replace(/[\u4e00-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const units = cjkChars + latinWords;
  const minutes = Math.max(1, Math.ceil(units / 320));

  return `${minutes} min`;
}

function stripMarkdown(source) {
  return source
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, " $1 ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparePosts(a, b) {
  const left = a.date || "";
  const right = b.date || "";

  if (left !== right) {
    return right.localeCompare(left);
  }

  return a.slug.localeCompare(b.slug);
}

function createRedirectHtml(slug) {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=../post.html?slug=${slug}" />
    <title>跳转中 | Signal Forge</title>
    <script>
      window.location.replace("../post.html?slug=${slug}");
    </script>
  </head>
  <body></body>
</html>
`;
}

async function main() {
  await mkdir(wrappersDir, { recursive: true });

  const entries = await readdir(postsDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);

  const posts = [];

  for (const fileName of markdownFiles) {
    const slug = path.basename(fileName, ".md");
    const sourcePath = path.join(postsDir, fileName);
    const markdown = await readFile(sourcePath, "utf8");
    const { meta, body } = parseFrontMatter(markdown);

    posts.push({
      slug,
      title: meta.title || slug,
      excerpt: meta.excerpt || "",
      category: meta.category || "未分类",
      date: meta.date || "",
      readingTime: meta.readingTime || estimateReadingTime(body),
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      accent: meta.accent || "cyan",
      featured: Boolean(meta.featured),
      source: `content/posts/${fileName}`,
      searchText: stripMarkdown(body)
    });
  }

  posts.sort(comparePosts);

  const manifest = {
    generatedAt: new Date().toISOString(),
    posts
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const activeSlugs = new Set(posts.map((post) => post.slug));

  for (const post of posts) {
    const redirectPath = path.join(wrappersDir, `${post.slug}.html`);
    await writeFile(redirectPath, createRedirectHtml(post.slug), "utf8");
  }

  const wrapperEntries = await readdir(wrappersDir, { withFileTypes: true });

  for (const entry of wrapperEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".html")) {
      continue;
    }

    const slug = path.basename(entry.name, ".html");
    if (activeSlugs.has(slug)) {
      continue;
    }

    await rm(path.join(wrappersDir, entry.name), { force: true });
  }

  console.log(`Synced ${posts.length} posts.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
