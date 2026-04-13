# Person Blog Publishing Notes

## Target paths

- Article source: `content/posts/<slug>.md`
- Generated manifest: `content/posts/index.json`
- Generated compatibility redirect: `posts/<slug>.html`
- Article page template: `post.html`

## Front matter fields

Use these keys at the top of each Markdown post:

```md
---
title: 文章标题
excerpt: 文章摘要
category: 技术研究
date: 2026-04-12
readingTime: 7 min
tags: tag-1, tag-2, tag-3
accent: cyan
featured: false
---
```

Notes:

- `tags` is a comma-separated line.
- `accent` must be one of `cyan`, `lime`, `orange`, `rose`.
- `readingTime` can be omitted; the blog sync script can derive it later.

## Recommended article shape

For a URL-driven article:

1. What this page or tool is
2. Why it matters
3. Key points or key APIs
4. Quick start or usage flow
5. Pitfalls / caveats
6. Sources

For a technical-term article:

1. What it is
2. When to use it
3. Core concepts
4. Quick start
5. Example commands / code
6. Common mistakes
7. Sources

## Quality bar

- Use Chinese.
- Keep the tone direct and practical.
- Prefer official docs and primary sources for technical terms.
- Do not copy long passages from sources.
- Include a short `## Sources` section with Markdown links at the end.

## Publishing command

Use this helper after drafting the article body:

```bash
node scripts/publish-post.mjs --project-root /path/to/person-blog ...
```

The helper writes the Markdown file and runs:

```bash
node scripts/sync-posts.mjs
```

## Preview

Because articles are loaded with `fetch`, preview through HTTP instead of opening files directly:

```bash
python3 -m http.server 4173
```
