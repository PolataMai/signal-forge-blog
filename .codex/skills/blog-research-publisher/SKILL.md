---
name: blog-research-publisher
description: Researches a provided URL or technical term and publishes a new Chinese Markdown post into this person-blog project. Use when the user wants to turn a webpage, documentation link, library name, framework, tool, command topic, or other technical keyword into a blog article added to content/posts/*.md, then sync the generated blog manifest and redirect pages.
---

# Blog Research Publisher

Use this skill inside the `person-blog` repo when the task is "给一个地址或技术名词，搜索内容并发到博客里".

Read [references/person-blog.md](references/person-blog.md) before writing the post so the output matches this blog's format and publishing flow.

## Workflow

1. Resolve the input type.
- If the user gives a URL, open that page first and treat it as the primary source.
- If the user gives a technical term, search the web. Prefer official docs, standards, vendor docs, and other primary sources.
- For current products, libraries, APIs, or tools, verify with up-to-date sources before writing.

2. Distill the material into a practical article.
- Write in Chinese.
- Do not paste long quotes. Summarize in your own words.
- Optimize for usefulness, not fluff: what it is, when to use it, quick start, core commands or APIs, common pitfalls, and a short sources section.
- If you infer something from the sources, say so explicitly in the article.

3. Choose metadata.
- `slug`: English kebab-case. Derive from the topic unless the user gives one.
- `category`: pick the closest bucket such as `Codex 实战`, `Skill 工坊`, `部署手册`, `技术研究`, `AI 工具`.
- `tags`: 3-6 short tags.
- `accent`: one of `cyan`, `lime`, `orange`, `rose`.

4. Publish into the local blog.
- Use the repo-level `scripts/publish-post.mjs` to write the Markdown file into `content/posts/`.
- The helper script also runs the repo's `scripts/sync-posts.mjs`, so the homepage manifest and `posts/*.html` redirect pages stay in sync.
- Pass the article body either with `--body-file` or through stdin.

Example:

```bash
node scripts/publish-post.mjs \
  --project-root /path/to/person-blog \
  --title "OpenAI Responses API 实战笔记" \
  --slug "openai-responses-api-notes" \
  --excerpt "把 Responses API 的核心能力、适用场景和接入方式整理成一篇实用笔记。" \
  --category "技术研究" \
  --tags "openai,responses-api,api" \
  --accent "cyan" \
  --body-file /tmp/post-body.md
```

5. Validate.
- Confirm the target Markdown file was written to `content/posts/<slug>.md`.
- Confirm `content/posts/index.json` was regenerated.
- If needed, preview through a local HTTP server because the article page loads Markdown through `fetch`.

6. Remote deployment is separate.
- This skill publishes into the local blog repo.
- If the user also wants the remote server updated, follow the repo's existing deploy flow after the post is generated. Do not invent server credentials or deployment commands.
