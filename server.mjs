import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(__filename);
const publicRoot = projectRoot;
const sessionCookieName = "signal_forge_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

async function loadDotEnv() {
  const envPath = path.join(projectRoot, ".env");

  try {
    const content = await readFile(envPath, "utf8");

    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }

      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        return;
      }

      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    });
  } catch {
    // Optional file.
  }
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((accumulator, item) => {
      const separator = item.indexOf("=");
      if (separator === -1) {
        return accumulator;
      }

      const key = item.slice(0, separator);
      const value = item.slice(separator + 1);
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function signToken(token) {
  return createHmac("sha256", sessionSecret).update(token).digest("hex");
}

function createSessionToken() {
  const raw = randomBytes(24).toString("base64url");
  return `${raw}.${signToken(raw)}`;
}

function verifySessionToken(token) {
  if (!token || !sessionSecret) {
    return false;
  }

  const separator = token.lastIndexOf(".");
  if (separator === -1) {
    return false;
  }

  const raw = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  return safeCompare(signature, signToken(raw));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function setSessionCookie(token) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`
  ];

  if (secureCookie) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function clearSessionCookie() {
  const parts = [
    `${sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0"
  ];

  if (secureCookie) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function getSession(req) {
  cleanupSessions();
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[sessionCookieName];

  if (!verifySessionToken(token)) {
    return null;
  }

  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return token;
}

function requireAuth(req, res) {
  if (!adminPassword || !sessionSecret) {
    json(res, 503, {
      error: "Admin API is disabled. Set BLOG_ADMIN_PASSWORD and BLOG_SESSION_SECRET."
    });
    return false;
  }

  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: "Unauthorized" });
    return false;
  }

  return true;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1_500_000) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function stripHtml(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function pickFirst(...values) {
  return values.find((item) => item && item.trim()) || "";
}

function truncate(text, maxLength) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function deriveExcerpt(text) {
  return truncate(text.replace(/\s+/g, " ").trim(), 92);
}

function sanitizeSlug(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

async function fetchRemoteText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SignalForgeBot/1.0 (+https://example.com)"
    },
    signal: AbortSignal.timeout(15_000)
  });

  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${url}`);
  }

  return response.text();
}

function unwrapDuckDuckGoLink(url) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : parsed.toString();
  } catch {
    return url;
  }
}

async function searchDuckDuckGo(query) {
  const html = await fetchRemoteText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  );
  const results = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html)) && results.length < 5) {
    const url = unwrapDuckDuckGoLink(match[1]);
    const title = stripHtml(match[2]);

    if (!/^https?:\/\//.test(url)) {
      continue;
    }

    if (results.some((item) => item.url === url)) {
      continue;
    }

    results.push({ title, url });
  }

  return results;
}

function extractSummaryFromHtml(html, sourceUrl) {
  const title = pickFirst(
    html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1],
    html.match(/<meta[^>]+name="twitter:title"[^>]+content="([^"]+)"/i)?.[1],
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  );
  const description = pickFirst(
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1],
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1]
  );
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const blocks = [];
  const blockPattern = /<(h1|h2|h3|p|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockPattern.exec(cleaned)) && blocks.length < 18) {
    const text = stripHtml(match[2]);
    if (text.length < 30) {
      continue;
    }
    if (blocks.includes(text)) {
      continue;
    }
    blocks.push(truncate(text, 220));
  }

  return {
    title: stripHtml(title) || sourceUrl,
    description: stripHtml(description) || blocks[0] || "",
    blocks
  };
}

async function summarizeUrl(url) {
  const html = await fetchRemoteText(url);
  return {
    url,
    ...extractSummaryFromHtml(html, url)
  };
}

function chooseAccent(category) {
  if (category.includes("部署")) {
    return "orange";
  }
  if (category.includes("Skill")) {
    return "lime";
  }
  if (category.includes("AI")) {
    return "rose";
  }
  return "cyan";
}

function inferTags(input, summaries) {
  const seed = `${input} ${summaries.map((item) => item.title).join(" ")}`;
  const tags = seed
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff+#.-]+/)
    .filter((token) => token.length >= 2 && token.length <= 24)
    .filter((token) => !["https", "http", "www", "com", "docs"].includes(token));

  return Array.from(new Set(tags)).slice(0, 5);
}

function buildSourceLines(sources) {
  return sources.map((source) => `- [${source.title}](${source.url})`).join("\n");
}

function buildDraftFromUrl(summary, notes) {
  const highlightLines = summary.blocks.slice(0, 5).map((item) => `- ${item}`).join("\n");
  const noteSection = notes ? `\n## 补充要求\n\n${notes}\n` : "";

  return `## 这篇资料在讲什么

这次记录的核心来源是 **${summary.title}**。从页面内容来看，它主要围绕以下主题展开：

- ${summary.description || "建议你在发布前补一段概述。"}

## 值得先记住的要点

${highlightLines || "- 需要手动补充这一部分。"}

## 快速上手

结合这页资料，建议优先关注：

- 页面中的核心概念定义
- 官方给出的最短接入路径
- 版本、限制条件和兼容性说明

## 注意点

- 如果这页资料面向特定版本，请在正文里写明版本号。
- 如果页面包含示例命令，发布前最好手动验证一遍。
- 如果是官方文档，建议再补一段“适合什么场景，不适合什么场景”。
${noteSection}
## Sources

${buildSourceLines([summary])}
`;
}

function buildDraftFromTopic(topic, summaries, notes) {
  const sections = summaries
    .map((summary) => {
      const bullets = summary.blocks.slice(0, 3).map((item) => `- ${item}`).join("\n");
      return `### ${summary.title}\n\n${bullets || "- 这一节建议手动补充。"}\n`;
    })
    .join("\n");
  const noteSection = notes ? `\n## 补充要求\n\n${notes}\n` : "";

  return `## ${topic} 是什么

围绕 **${topic}** 检索到的资料显示，它通常会和以下能力或场景一起出现：

- ${summaries[0]?.description || "建议补一段主题概述。"}
- ${summaries[1]?.description || "建议补一段使用背景。"}

## 为什么值得记录

- 它在当前技术栈中的定位是什么
- 它解决了什么问题
- 它与相近方案相比的差异点在哪里

## 关键信息

${sections || "### 待补充\n\n- 暂无检索结果，请手动补充。\n"}

## 快速上手

- 先看官方文档或标准定义
- 再看最短 demo 或 quick start
- 最后补一段你自己的使用建议或踩坑记录

## 常见注意点

- 注意版本差异、生态兼容性和平台限制。
- 如果搜索结果来自多家厂商，要分清规范、实现和教程的区别。
- 如果某些结论是根据多篇资料推断出来的，发布时请明确写成“推断”。
${noteSection}
## Sources

${buildSourceLines(summaries)}
`;
}

function estimateReadingTime(text) {
  const cjkChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = text
    .replace(/[\u4e00-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const total = cjkChars + latinWords;
  return `${Math.max(1, Math.ceil(total / 320))} min`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function createDraft(mode, input, notes, category) {
  if (mode === "url") {
    const url = new URL(input).toString();
    const summary = await summarizeUrl(url);
    const body = buildDraftFromUrl(summary, notes);
    const title = summary.title;
    const slug = sanitizeSlug(title) || `post-${Date.now()}`;
    const excerpt = deriveExcerpt(summary.description || summary.blocks[0] || title);
    const tags = inferTags(title, [summary]);

    return {
      post: {
        title,
        slug,
        excerpt,
        category,
        tags,
        accent: chooseAccent(category),
        featured: false,
        date: today(),
        readingTime: estimateReadingTime(body),
        body
      },
      sources: [{ title: summary.title, url: summary.url }],
      warnings: []
    };
  }

  const results = await searchDuckDuckGo(input);
  if (!results.length) {
    throw new Error("没有检索到可用结果。");
  }

  const fetched = [];
  const warnings = [];

  for (const result of results.slice(0, 3)) {
    try {
      fetched.push(await summarizeUrl(result.url));
    } catch {
      warnings.push(`无法抓取 ${result.url}`);
    }
  }

  if (!fetched.length) {
    throw new Error("检索到了结果，但无法抓取具体页面内容。");
  }

  const body = buildDraftFromTopic(input, fetched, notes);
  const title = `${input} 实用研究笔记`;
  const slug = sanitizeSlug(input) || `topic-${Date.now()}`;
  const excerpt = deriveExcerpt(fetched[0].description || input);
  const tags = inferTags(input, fetched);

  return {
    post: {
      title,
      slug,
      excerpt,
      category,
      tags,
      accent: chooseAccent(category),
      featured: false,
      date: today(),
      readingTime: estimateReadingTime(body),
      body
    },
    sources: fetched.map((item) => ({ title: item.title, url: item.url })),
    warnings
  };
}

async function publishPost(payload) {
  const args = [
    "scripts/publish-post.mjs",
    "--project-root",
    projectRoot,
    "--title",
    payload.title,
    "--slug",
    payload.slug,
    "--excerpt",
    payload.excerpt,
    "--category",
    payload.category,
    "--tags",
    payload.tags,
    "--accent",
    payload.accent,
    "--date",
    payload.date
  ];

  if (payload.readingTime) {
    args.push("--reading-time", payload.readingTime);
  }

  if (payload.featured) {
    args.push("--featured", "true");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";

    child.stdin.write(payload.body);
    child.stdin.end();

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `publish-post.mjs exited with ${code}`));
    });

    child.on("error", reject);
  });
}

function contentTypeFor(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const resolved = path.resolve(publicRoot, `.${pathname}`);

  if (!resolved.startsWith(publicRoot)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    await access(resolved);
    res.writeHead(200, { "Content-Type": contentTypeFor(resolved) });
    createReadStream(resolved).pipe(res);
  } catch {
    const fallback = path.join(publicRoot, "404.html");
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(fallback).pipe(res);
  }
}

await loadDotEnv();

const port = Number(process.env.BLOG_PORT || 3000);
const adminPassword = process.env.BLOG_ADMIN_PASSWORD || "";
const sessionSecret = process.env.BLOG_SESSION_SECRET || "";
const secureCookie = process.env.BLOG_SECURE_COOKIE === "true";

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/session") {
      const authenticated = Boolean(getSession(req));
      json(res, 200, {
        authenticated,
        adminEnabled: Boolean(adminPassword && sessionSecret)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      if (!adminPassword || !sessionSecret) {
        json(res, 503, {
          error: "Admin API is disabled. Set BLOG_ADMIN_PASSWORD and BLOG_SESSION_SECRET."
        });
        return;
      }

      const body = await readJsonBody(req);
      if (!safeCompare(body.password || "", adminPassword)) {
        json(res, 401, { error: "密码错误。" });
        return;
      }

      const token = createSessionToken();
      sessions.set(token, Date.now() + sessionTtlMs);
      json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": setSessionCookie(token)
        }
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/logout") {
      const session = getSession(req);
      if (session) {
        sessions.delete(session);
      }
      json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie": clearSessionCookie()
        }
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/draft") {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const mode = body.mode === "topic" ? "topic" : "url";
      const input = String(body.input || "").trim();
      const notes = String(body.notes || "").trim();
      const category = String(body.category || "技术研究").trim();

      if (!input) {
        json(res, 400, { error: "请输入 URL 或主题。" });
        return;
      }

      const draft = await createDraft(mode, input, notes, category);
      json(res, 200, draft);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await readJsonBody(req);
      const title = String(body.title || "").trim();
      const slug = sanitizeSlug(String(body.slug || body.title || ""));
      const excerpt = String(body.excerpt || "").trim();
      const category = String(body.category || "技术研究").trim();
      const tags = String(body.tags || "").trim();
      const accent = ["cyan", "lime", "orange", "rose"].includes(body.accent)
        ? body.accent
        : "cyan";
      const date = String(body.date || today()).trim();
      const readingTime = String(body.readingTime || "").trim();
      const featured = Boolean(body.featured);
      const markdownBody = String(body.body || "").trim();

      if (!title || !slug || !excerpt || !markdownBody) {
        json(res, 400, { error: "标题、摘要、slug 和正文都是必填项。" });
        return;
      }

      await publishPost({
        title,
        slug,
        excerpt,
        category,
        tags,
        accent,
        date,
        readingTime,
        featured,
        body: markdownBody
      });

      json(res, 200, {
        ok: true,
        slug,
        url: `/post.html?slug=${slug}`
      });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(port, () => {
  console.log(`Signal Forge server listening on http://127.0.0.1:${port}`);
});
