import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import path from "node:path";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }

  let data = "";

  for await (const chunk of process.stdin) {
    data += chunk;
  }

  return data;
}

async function runSync(projectRoot) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/sync-posts.mjs"], {
      cwd: projectRoot,
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`sync-posts.mjs exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

function buildFrontMatter({
  title,
  excerpt,
  category,
  date,
  readingTime,
  tags,
  accent,
  featured
}) {
  const lines = [
    "---",
    `title: ${title}`,
    `excerpt: ${excerpt}`,
    `category: ${category}`,
    `date: ${date}`
  ];

  if (readingTime) {
    lines.push(`readingTime: ${readingTime}`);
  }

  if (tags) {
    lines.push(`tags: ${tags}`);
  }

  lines.push(`accent: ${accent}`);
  lines.push(`featured: ${featured ? "true" : "false"}`);
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(options["project-root"] || process.cwd());
  const title = options.title?.trim();
  const slug = (options.slug || (title ? slugify(title) : "")).trim();
  const excerpt = options.excerpt?.trim() || "";
  const category = options.category?.trim() || "技术研究";
  const date = options.date?.trim() || today();
  const readingTime = options["reading-time"]?.trim() || "";
  const tags = options.tags?.trim() || "";
  const accent = options.accent?.trim() || "cyan";
  const featured = options.featured === "true";
  const dryRun = options["dry-run"] === "true";
  const bodyFile = options["body-file"];

  if (!title) {
    throw new Error("Missing required --title");
  }

  if (!slug) {
    throw new Error("Unable to derive slug; provide --slug");
  }

  let body = "";

  if (bodyFile) {
    body = await readFile(path.resolve(bodyFile), "utf8");
  } else {
    body = await readStdin();
  }

  body = body.trim();

  if (!body) {
    throw new Error("Post body is empty. Provide --body-file or pipe Markdown through stdin.");
  }

  const content = `${buildFrontMatter({
    title,
    excerpt,
    category,
    date,
    readingTime,
    tags,
    accent,
    featured
  })}${body}\n`;
  const targetDir = path.join(projectRoot, "content", "posts");
  const targetPath = path.join(targetDir, `${slug}.md`);

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          projectRoot,
          targetPath,
          slug,
          title,
          category,
          accent
        },
        null,
        2
      )
    );
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, content, "utf8");
  await runSync(projectRoot);

  console.log(`Published ${targetPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
