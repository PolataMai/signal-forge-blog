# Signal Forge

一个偏未来感的个人知识博客模板，适合记录 Codex 使用教程、skill 创作经验、部署手册和其他可复用的学习沉淀。现在文章内容由 Markdown 驱动，页面层与内容层已经拆开。

## 特点

- 纯静态站点，无需 `npm install`
- 文章内容存放在 `content/posts/*.md`
- `node scripts/sync-posts.mjs` 会自动生成文章清单和兼容跳转页
- `node scripts/publish-post.mjs` 可直接写入 Markdown 并自动同步
- `admin.html` + `server.mjs` 提供登录、研究草稿生成和直接发布能力
- 首页自带筛选、搜索、滚动进度和轻量动效
- 通用文章页会动态渲染 Markdown、目录导航和代码块复制
- 目录结构简单，适合直接上传到服务器

## 本地预览

纯前台预览可以直接起静态文件服务：

```bash
cd /path/to/person-blog
python3 -m http.server 4173
```

然后访问 `http://localhost:4173`。

如果要使用后台发布功能，可以直接从 `.env` 启动，也可以先导出环境变量：

```bash
cp .env.example .env
```

然后修改 `.env` 里的密码和密钥，再启动：

```bash
node server.mjs
```

然后访问 `http://localhost:3000/admin.html`。

## 目录结构

```text
person-blog/
├── index.html
├── 404.html
├── admin.html
├── assets/
│   ├── app.js
│   ├── admin.js
│   ├── favicon.svg
│   └── styles.css
├── content/
│   └── posts/
│       ├── index.json
│       ├── codex-quickstart.md
│       ├── deploy-playbook.md
│       └── skill-authoring.md
├── deploy/
│   └── nginx.conf.example
├── scripts/
│   ├── publish-post.mjs
│   └── sync-posts.mjs
├── server.mjs
├── posts/
│   ├── codex-quickstart.html
│   ├── deploy-playbook.html
│   └── skill-authoring.html
├── post.html
└── README.md
```

## 如何新增文章

1. 在 `content/posts/` 下新增一个 Markdown 文件，例如 `your-post-slug.md`。
2. 文件头部写 front matter，正文直接写 Markdown：

```md
---
title: 文章标题
excerpt: 文章摘要
category: 分类名称
date: 2026-04-12
readingTime: 7 min
tags: tag-1, tag-2
accent: cyan
featured: false
---

## 一级小节

这里开始写正文。
```

3. 运行同步脚本：

```bash
node scripts/sync-posts.mjs
```

这个脚本会自动：

- 重建 `content/posts/index.json`
- 生成或更新 `posts/*.html` 兼容跳转页
- 按日期倒序整理首页文章顺序

如果你想直接通过命令发布一篇文章，也可以用：

```bash
printf '## 正文\n\n这里是内容。\n' | node scripts/publish-post.mjs \
  --project-root . \
  --title '文章标题' \
  --slug 'article-slug' \
  --excerpt '文章摘要' \
  --category '技术研究' \
  --tags 'tag-1,tag-2' \
  --accent 'cyan'
```

最终文章链接会是 `post.html?slug=your-post-slug`，同时也会自动生成 `posts/your-post-slug.html`。

## 服务器部署

上传整个目录到服务器静态站点根目录，例如：

```bash
rsync -av --delete ./ user@your-server:/var/www/signal-forge/
```

如果你使用 Nginx，可参考 [deploy/nginx.conf.example](deploy/nginx.conf.example)。

典型步骤：

1. 把文件同步到服务器目录。
2. 上传前先执行 `node scripts/sync-posts.mjs`。
3. 设置服务端环境变量并启动 `node server.mjs`。
4. 修改 `server_name`，让 Nginx 反向代理到 `127.0.0.1:3000`。
5. `sudo nginx -t`
6. `sudo systemctl reload nginx`

注意：

- 由于文章页通过 `fetch` 读取 Markdown，不能直接双击 HTML 文件预览。
- 本地预览和线上部署都需要通过 HTTP 服务访问。
- 如果你只想跑前台静态站，可以不启动 `server.mjs`；但这样 `admin.html` 和发布 API 不会工作。

## 后续可扩展方向

- 加入更多文章与分类
- 接入你自己的域名和 HTTPS
- 替换首页示例内容为你的真实知识体系
- 后续如果需要，我也可以把它升级成带 Markdown 内容源或 CMS 的版本

## 本地 Skill

项目里已经新增了一个本地 skill：

- 路径：`.codex/skills/blog-research-publisher/SKILL.md`
- 用途：给一个 URL 或技术名词，搜索资料，整理成中文博客文章并发布到当前博客

它会把文章写入 `content/posts/*.md`，然后自动执行：

```bash
node scripts/sync-posts.mjs
```

你后续如果想直接触发它，可以明确说：

```text
用 blog-research-publisher skill，把某个 URL 或技术主题写成博客并发布到这个项目
```

## 发布后台

后台页面路径是 `admin.html`。

能力包括：

- 密码登录
- 输入 URL 生成研究草稿
- 输入技术名词搜索资料并生成草稿
- 在线编辑 Markdown 后直接发布
- 自动同步 `content/posts/index.json` 和 `posts/*.html`

需要的环境变量：

- `BLOG_ADMIN_PASSWORD`
- `BLOG_SESSION_SECRET`
- 可选：`BLOG_PORT`，默认 `3000`
- 可选：`BLOG_SECURE_COOKIE=true`，在 HTTPS 反向代理场景下建议开启

## Git 与服务器安装

为了避免把密钥和本地状态传到远程仓库，仓库已经补了：

- `.gitignore`
- `.env.example`
- `deploy/install-server.sh`
- `deploy/signal-forge.service.example`

服务器上一键安装的典型方式：

```bash
sudo bash deploy/install-server.sh \
  --repo-url <your-git-url> \
  --branch main \
  --domain your-domain.com \
  --admin-password 'your-admin-password'
```

安装脚本会：

- clone 或更新仓库
- 生成 `.env`
- 执行 `node scripts/sync-posts.mjs`
- 注册并启动 systemd 服务
- 可选配置 Nginx 反向代理

### CentOS 说明

如果你的服务器是 CentOS，这份安装脚本已经按 CentOS 场景补过：

- 自动识别 `dnf` 或 `yum`
- 使用 NodeSource 安装 Node.js 20
- Nginx 配置写入 `/etc/nginx/conf.d/`
- 如果启用了 SELinux，会自动执行 `setsebool -P httpd_can_network_connect 1`
- 如果启用了 `firewalld`，会自动放行 `http`

CentOS 上推荐直接执行：

```bash
sudo bash deploy/install-server.sh \
  --repo-url https://github.com/PolataMai/signal-forge-blog.git \
  --branch main \
  --domain your-domain.com \
  --admin-password 'your-admin-password'
```

安装完成后，后台入口通常是：

```text
http://your-domain.com/admin.html
```
