const posts = [];
const postsBySlug = new Map();
const rootPath = document.body.dataset.root || "./";
const currentPage = document.body.dataset.page || "home";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function buildPostUrl(slug) {
  return `${rootPath}post.html?slug=${encodeURIComponent(slug)}`;
}

function getSlugFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get("slug");
}

async function fetchJson(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Request failed: ${path} (${response.status})`);
  }

  return response.json();
}

async function fetchText(path) {
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Request failed: ${path} (${response.status})`);
  }

  return response.text();
}

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

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(text) {
  const codeTokens = [];

  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, value) => {
    const token = `%%CODE_${codeTokens.length}%%`;
    codeTokens.push(`<code>${value}</code>`);
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safeUrl = escapeHtml(url);
    const isExternal = /^https?:\/\//.test(url);
    const attrs = isExternal ? ' target="_blank" rel="noreferrer"' : "";
    return `<a href="${safeUrl}"${attrs}>${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html.replace(/%%CODE_(\d+)%%/g, (_, index) => codeTokens[Number(index)]);
}

function slugifyHeading(text, index) {
  const normalized = text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `section-${index + 1}`;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isOrderedList(line) {
  return /^\d+\.\s+/.test(line);
}

function isUnorderedList(line) {
  return /^[-*]\s+/.test(line);
}

function isBlockStart(line, nextLine) {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^```/.test(line) ||
    /^>\s?/.test(line) ||
    isUnorderedList(line) ||
    isOrderedList(line) ||
    (line.includes("|") && Boolean(nextLine) && isTableSeparator(nextLine))
  );
}

function renderMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  const headings = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const codeLines = [];
      index += 1;

      while (index < lines.length && !/^```/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
      html.push(
        `<pre><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const id = slugifyHeading(text, headings.length);
      html.push(`<h${level} id="${id}">${applyInlineMarkdown(text)}</h${level}>`);

      if (level === 2 || level === 3) {
        headings.push({ level, text, id });
      }

      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];

      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }

      html.push(`<blockquote><p>${applyInlineMarkdown(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];

      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      const headHtml = headers.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join("");
      const bodyHtml = rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join("")}</tr>`
        )
        .join("");

      html.push(
        `<table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`
      );
      continue;
    }

    if (isUnorderedList(line) || isOrderedList(line)) {
      const ordered = isOrderedList(line);
      const items = [];

      while (index < lines.length) {
        const current = lines[index];
        if (!current.trim()) {
          index += 1;
          break;
        }

        if (ordered && !isOrderedList(current)) {
          break;
        }

        if (!ordered && !isUnorderedList(current)) {
          break;
        }

        items.push(current.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
        index += 1;
      }

      const tag = ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${items.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("")}</${tag}>`
      );
      continue;
    }

    const paragraphLines = [line];
    index += 1;

    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], lines[index + 1])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    html.push(`<p>${applyInlineMarkdown(paragraphLines.join(" "))}</p>`);
  }

  return {
    html: html.join(""),
    headings
  };
}

function createPostObject(slug, markdown, baseMeta = {}) {
  const { meta, body } = parseFrontMatter(markdown);
  const merged = { ...baseMeta, ...meta };
  const tags = Array.isArray(merged.tags)
    ? merged.tags
    : normalizeListValue(typeof merged.tags === "string" ? merged.tags : "");

  return {
    slug,
    title: merged.title || slug,
    excerpt: merged.excerpt || "",
    category: merged.category || "未分类",
    date: merged.date || "",
    readingTime: merged.readingTime || estimateReadingTime(body),
    tags,
    accent: merged.accent || "cyan",
    featured: Boolean(merged.featured),
    body,
    source: merged.source || `content/posts/${slug}.md`,
    searchText: String(merged.searchText || body).toLowerCase()
  };
}

function createManifestPost(entry) {
  return {
    slug: entry.slug,
    title: entry.title || entry.slug,
    excerpt: entry.excerpt || "",
    category: entry.category || "未分类",
    date: entry.date || "",
    readingTime: entry.readingTime || "1 min",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    accent: entry.accent || "cyan",
    featured: Boolean(entry.featured),
    source: entry.source || `content/posts/${entry.slug}.md`,
    searchText: String(entry.searchText || "").toLowerCase()
  };
}

async function loadPosts() {
  const manifest = await fetchJson(`${rootPath}content/posts/index.json`);
  const manifestPosts = Array.isArray(manifest.posts) ? manifest.posts : [];
  const loadedPosts = manifestPosts.map(createManifestPost);

  posts.splice(0, posts.length, ...loadedPosts);
  postsBySlug.clear();
  loadedPosts.forEach((post) => {
    postsBySlug.set(post.slug, post);
  });
}

async function loadPostBySlug(slug) {
  const existing = postsBySlug.get(slug) || {
    slug,
    source: `content/posts/${slug}.md`
  };
  const markdown = await fetchText(`${rootPath}${existing.source}`);
  const post = createPostObject(slug, markdown, existing);
  postsBySlug.set(slug, post);
  return post;
}

function createChrome() {
  const navSlot = document.querySelector("[data-site-nav]");
  const footerSlot = document.querySelector("[data-site-footer]");
  const homeLink = `${rootPath}index.html`;
  const adminLink = `${rootPath}admin.html`;
  const libraryLink = currentPage === "home" ? "#library" : `${homeLink}#library`;
  const deployLink = currentPage === "home" ? "#deploy" : `${homeLink}#deploy`;
  const primaryPost = posts[0];
  const footerPosts = posts.slice(0, 3);

  if (navSlot) {
    navSlot.innerHTML = `
      <header class="site-header" data-header>
        <div class="shell">
          <div class="header-inner">
            <a class="logo" href="${homeLink}">
              <span class="logo-mark"></span>
              <span>Signal Forge</span>
            </a>
            <nav class="nav-links" aria-label="主导航">
              <a href="${libraryLink}">知识库</a>
              <a href="${deployLink}">部署</a>
              <a href="${adminLink}">发布后台</a>
              <a href="${primaryPost ? buildPostUrl(primaryPost.slug) : homeLink}">最新文章</a>
            </nav>
            <div class="nav-actions">
              <button class="search-trigger" type="button" data-open-search>
                Search
                <span>/</span>
              </button>
              <button class="mobile-toggle" type="button" aria-label="切换导航" data-mobile-toggle>
                <span></span>
                <span></span>
              </button>
            </div>
          </div>
          <div class="mobile-nav" data-mobile-nav>
            <a href="${libraryLink}">知识库</a>
            <a href="${deployLink}">部署</a>
            <a href="${adminLink}">发布后台</a>
            <a href="${posts[1] ? buildPostUrl(posts[1].slug) : homeLink}">Skill 工坊</a>
          </div>
        </div>
      </header>
    `;
  }

  if (footerSlot) {
    footerSlot.innerHTML = `
      <footer class="site-footer">
        <div class="shell footer-inner">
          <div>
            <p class="section-kicker">Signal Forge</p>
            <p class="footer-copy">
              为个人学习、AI 编程和部署方法论持续积累可复用资产。
            </p>
          </div>
          <div class="footer-links">
            ${footerPosts
              .map((post) => `<a href="${buildPostUrl(post.slug)}">${post.category}</a>`)
              .join("")}
            <a href="${adminLink}">发布后台</a>
          </div>
          <p class="footer-meta">
            <span data-year></span> / Static site / Direct deploy
          </p>
        </div>
      </footer>
    `;
  }

  document.querySelectorAll("[data-year]").forEach((node) => {
    node.textContent = new Date().getFullYear();
  });
}

function createSearch() {
  if (document.querySelector("[data-search-overlay]")) {
    return;
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    `
      <div class="search-overlay" data-search-overlay hidden>
        <button class="search-backdrop" type="button" aria-label="关闭搜索" data-close-search></button>
        <div class="search-panel panel-card">
          <div class="search-head">
            <p class="section-kicker">Quick Search</p>
            <button class="search-close" type="button" aria-label="关闭搜索" data-close-search>
              Close
            </button>
          </div>
          <label class="search-box">
            <span>Find</span>
            <input
              data-search-input
              type="search"
              placeholder="搜索文章标题、标签、分类"
              autocomplete="off"
            />
          </label>
          <div class="search-results" data-search-results></div>
        </div>
      </div>
    `
  );

  renderSearchResults("");
}

function renderSearchResults(query) {
  const resultsNode = document.querySelector("[data-search-results]");

  if (!resultsNode) {
    return;
  }

  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? posts.filter((post) => {
        const source = [
          post.title,
          post.excerpt,
          post.category,
          ...(post.tags || []),
          post.searchText || ""
        ]
          .join(" ")
          .toLowerCase();
        return source.includes(normalized);
      })
    : posts.slice(0, 3);

  resultsNode.innerHTML = matches.length
    ? matches
        .map(
          (post) => `
            <a class="search-item" href="${buildPostUrl(post.slug)}">
              <div>
                <p>${post.category}</p>
                <strong>${post.title}</strong>
              </div>
              <span>${post.readingTime}</span>
            </a>
          `
        )
        .join("")
    : `<p class="search-empty">没有匹配结果，换一个关键字试试。</p>`;
}

function toggleSearch(open) {
  const overlay = document.querySelector("[data-search-overlay]");
  const input = document.querySelector("[data-search-input]");

  if (!overlay) {
    return;
  }

  overlay.hidden = !open;
  document.body.classList.toggle("search-open", open);

  if (open && input) {
    input.value = "";
    renderSearchResults("");
    window.setTimeout(() => input.focus(), 60);
  }
}

function initSearchEvents() {
  document.addEventListener("click", (event) => {
    const openTrigger = event.target.closest("[data-open-search]");
    const closeTrigger = event.target.closest("[data-close-search]");

    if (openTrigger) {
      toggleSearch(true);
    }

    if (closeTrigger) {
      toggleSearch(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      toggleSearch(false);
    }

    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
        event.preventDefault();
        toggleSearch(true);
      }
    }
  });

  const searchInput = document.querySelector("[data-search-input]");
  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      renderSearchResults(event.target.value);
    });
  }
}

function postCardTemplate(post) {
  const tags = (post.tags || []).map((tag) => `<li>${tag}</li>`).join("");

  return `
    <a class="post-card panel-card accent-${post.accent}" href="${buildPostUrl(post.slug)}" data-tilt>
      <div class="post-card-top">
        <span>${post.category}</span>
        <span>${post.readingTime}</span>
      </div>
      <h3>${post.title}</h3>
      <p>${post.excerpt}</p>
      <ul class="tag-list">${tags}</ul>
      <div class="post-card-bottom">
        <span>${post.date}</span>
        <strong>Open</strong>
      </div>
    </a>
  `;
}

function initPostGrid() {
  const grid = document.querySelector("#post-grid");
  const chips = document.querySelector("[data-filter-chips]");

  if (!grid || !chips) {
    return;
  }

  if (!posts.length) {
    grid.innerHTML = `<article class="panel-card">文章清单暂时为空。</article>`;
    return;
  }

  const categories = ["全部", ...new Set(posts.map((post) => post.category))];
  let activeCategory = "全部";

  const renderCards = () => {
    const filtered =
      activeCategory === "全部"
        ? posts
        : posts.filter((post) => post.category === activeCategory);

    grid.innerHTML = filtered.map(postCardTemplate).join("");
    initTilt();
  };

  chips.innerHTML = categories
    .map(
      (category) => `
        <button
          class="chip ${category === activeCategory ? "is-active" : ""}"
          type="button"
          data-category="${category}"
        >
          ${category}
        </button>
      `
    )
    .join("");

  chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) {
      return;
    }

    activeCategory = button.dataset.category;
    chips.querySelectorAll(".chip").forEach((node) => {
      node.classList.toggle("is-active", node === button);
    });
    renderCards();
  });

  renderCards();
}

function initScrollEffects() {
  const progress = document.querySelector("[data-progress]");
  const header = document.querySelector("[data-header]");

  const update = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = maxScroll > 0 ? window.scrollY / maxScroll : 0;

    if (progress) {
      progress.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
    }

    if (header) {
      header.classList.toggle("is-scrolled", window.scrollY > 24);
    }
  };

  update();
  window.addEventListener("scroll", update, { passive: true });
}

function initReveal() {
  const items = document.querySelectorAll("[data-reveal]");

  if (!items.length || prefersReducedMotion) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  items.forEach((item) => observer.observe(item));
}

function initTilt() {
  if (prefersReducedMotion) {
    return;
  }

  document.querySelectorAll("[data-tilt]").forEach((card) => {
    if (card.dataset.tiltReady) {
      return;
    }

    card.dataset.tiltReady = "true";

    card.addEventListener("mousemove", (event) => {
      const rect = card.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      const rotateY = ((offsetX / rect.width) - 0.5) * 10;
      const rotateX = (0.5 - (offsetY / rect.height)) * 10;

      card.style.setProperty("--tilt-x", `${rotateX.toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${rotateY.toFixed(2)}deg`);
    });

    card.addEventListener("mouseleave", () => {
      card.style.removeProperty("--tilt-x");
      card.style.removeProperty("--tilt-y");
    });
  });
}

function initPointerGlow() {
  if (prefersReducedMotion) {
    return;
  }

  window.addEventListener("pointermove", (event) => {
    document.documentElement.style.setProperty("--pointer-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--pointer-y", `${event.clientY}px`);
  });
}

function initMobileNav() {
  const toggle = document.querySelector("[data-mobile-toggle]");
  const nav = document.querySelector("[data-mobile-nav]");

  if (!toggle || !nav) {
    return;
  }

  toggle.addEventListener("click", () => {
    nav.classList.toggle("is-open");
    toggle.classList.toggle("is-open");
  });
}

function initCodeCopy() {
  document.querySelectorAll("pre code").forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.querySelector(".copy-button")) {
      return;
    }

    const button = document.createElement("button");
    button.className = "copy-button";
    button.type = "button";
    button.textContent = "复制";
    pre.appendChild(button);

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent || "");
        button.textContent = "已复制";
        window.setTimeout(() => {
          button.textContent = "复制";
        }, 1200);
      } catch (error) {
        button.textContent = "失败";
      }
    });
  });
}

function initTocSpy() {
  const tocLinks = Array.from(document.querySelectorAll(".article-nav a[href^='#']"));
  const headings = tocLinks
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (!tocLinks.length || !headings.length) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        tocLinks.forEach((link) => {
          link.classList.toggle(
            "is-active",
            link.getAttribute("href") === `#${entry.target.id}`
          );
        });
      });
    },
    {
      rootMargin: "-20% 0px -55% 0px",
      threshold: 0
    }
  );

  headings.forEach((heading) => observer.observe(heading));
}

function setDocumentDescription(description) {
  const meta = document.querySelector('meta[name="description"]');

  if (meta) {
    meta.setAttribute("content", description);
  }
}

function renderArticlePage(post) {
  const root = document.querySelector("[data-article-root]");

  if (!root) {
    return;
  }

  const { html, headings } = renderMarkdown(post.body);
  const toc = headings.length
    ? headings
        .map(
          (heading) =>
            `<a class="toc-level-${heading.level}" href="#${heading.id}">${heading.text}</a>`
        )
        .join("")
    : `<p class="article-empty-toc">这篇文章没有目录分节。</p>`;
  const tags = post.tags.map((tag) => `<li>${tag}</li>`).join("");

  root.innerHTML = `
    <section class="article-hero" data-reveal>
      <p class="eyebrow">${post.category} / Markdown Driven</p>
      <h1 class="article-title">${post.title}</h1>
      <p class="article-meta">${post.date} · ${post.readingTime} · 内容来自 Markdown</p>
      <ul class="article-tags">${tags}</ul>
      <p class="article-intro">${post.excerpt}</p>
    </section>

    <div class="article-layout">
      <aside class="article-nav panel-card" data-reveal>
        <h2>目录</h2>
        ${toc}
      </aside>
      <article class="article-main panel-card prose" data-reveal>
        ${html}
      </article>
    </div>
  `;

  document.title = `${post.title} | Signal Forge`;
  setDocumentDescription(post.excerpt || post.title);
}

function renderArticleError(message) {
  const root = document.querySelector("[data-article-root]");

  if (!root) {
    return;
  }

  root.innerHTML = `
    <section class="not-found-card panel-card" data-reveal>
      <p class="eyebrow">Article Error</p>
      <h1 class="display">文章加载失败</h1>
      <p class="lead">${message}</p>
      <div class="hero-actions">
        <a class="button button-primary" href="${rootPath}index.html">返回首页</a>
      </div>
    </section>
  `;
}

async function initArticlePage() {
  if (currentPage !== "article") {
    return;
  }

  const slug = getSlugFromLocation();

  if (!slug) {
    renderArticleError("当前链接缺少 slug 参数。");
    return;
  }

  try {
    const post = await loadPostBySlug(slug);
    renderArticlePage(post);
  } catch (error) {
    renderArticleError(`没有找到 slug 为 "${slug}" 的文章。`);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadPosts();
  } catch (error) {
    console.error(error);
  }

  createChrome();
  createSearch();
  initSearchEvents();
  initPostGrid();
  await initArticlePage();
  initScrollEffects();
  initReveal();
  initTilt();
  initPointerGlow();
  initMobileNav();
  initCodeCopy();
  initTocSpy();
});
