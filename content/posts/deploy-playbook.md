---
title: 静态博客部署清单：一台服务器就够了
excerpt: 用 Nginx 或 Caddy 部署纯静态站点，配置缓存、HTTPS、回滚和内容更新流程。
category: 部署手册
date: 2026-04-08
readingTime: 6 min
tags: deploy, nginx, server
accent: orange
featured: false
---

## 准备站点文件

这套博客本身就是最终产物，没有额外构建步骤。你需要上传的是整个项目目录，至少包括首页、文章页、`assets/` 和 `content/` 目录。

```text
person-blog/
├── index.html
├── post.html
├── assets/
├── content/
├── deploy/
└── README.md
```

上传可以直接用 `scp` 或 `rsync`：

```bash
rsync -av --delete ./ user@your-server:/var/www/signal-forge/
```

## 配置 Nginx

对于这种纯静态站，Nginx 配置不需要复杂。关键点是：正确设置 `root`、默认首页、404 页和静态资源缓存策略。

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/signal-forge;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    error_page 404 /404.html;

    location ~* \.(css|js|svg|json|md)$ {
        expires 1h;
        add_header Cache-Control "public, max-age=3600";
    }
}
```

我已经把一份可直接改域名和目录的示例放在 `deploy/nginx.conf.example`。

## 发布与回滚

发布纯静态站最简单的方法，是把每次更新都上传到一个独立版本目录，然后用软链接或 `root` 切换当前版本。这样回滚几乎是秒级的。

- 每次发布都保留上一个版本目录。
- 静态资源做短期缓存，HTML 不要长期缓存。
- 上线前用本地 HTTP 服务先快速过一遍页面和链接。

> 对个人博客而言，最实用的发布策略不是最花哨的 CI/CD，而是“手动也足够稳”的路径。

## 后续更新内容

未来你新增一篇文章，只需要做两件事：

1. 在 `content/posts/` 下新增一个带 front matter 的 `.md` 文件。
2. 运行 `node scripts/sync-posts.mjs`，自动重建文章清单和兼容跳转页。

完成后重新上传站点目录即可，不需要跑构建命令，也不需要数据库迁移。这种维护方式对个人知识站很友好，尤其适合频繁补充学习笔记。
